import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { redisClient } from "../redis.js";
import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

let redisTransportCounter = 0;
const notificationStreamId = "__GET_stream";

// Message types for Redis transport
type RedisMessage = 
  | {
      type: 'mcp';
      message: JSONRPCMessage;
      extra?: MessageExtraInfo;
      options?: TransportSendOptions;
    }
  | {
      type: 'control';
      action: 'SHUTDOWN' | 'PING' | 'STATUS';
      timestamp?: number;
    };

function sendToMcpServer(sessionId: string, message: JSONRPCMessage, extra?: { authInfo?: AuthInfo; }, options?: TransportSendOptions): Promise<void> {
  const toServerChannel = getToServerChannel(sessionId);
  const redisMessage: RedisMessage = { type: 'mcp', message, extra, options };
  return redisClient.publish(toServerChannel, JSON.stringify(redisMessage));
}

function getToServerChannel(sessionId: string): string {
  return `mcp:shttp:toserver:${sessionId}`;
}

function getToClientChannel(sessionId: string, relatedRequestId: string): string {
  return `mcp:shttp:toclient:${sessionId}:${relatedRequestId}`;
}

function getControlChannel(sessionId: string): string {
  return `mcp:control:${sessionId}`;
}

function sendControlMessage(sessionId: string, action: 'SHUTDOWN' | 'PING' | 'STATUS'): Promise<void> {
  const controlChannel = getControlChannel(sessionId);
  const redisMessage: RedisMessage = {
    type: 'control',
    action,
    timestamp: Date.now()
  };
  return redisClient.publish(controlChannel, JSON.stringify(redisMessage));
}

export async function shutdownSession(sessionId: string): Promise<void> {
  return sendControlMessage(sessionId, 'SHUTDOWN');
}

export async function isLive(sessionId: string): Promise<boolean> {
  // Check if the session is live by checking if the key exists in Redis
  const numSubs = await redisClient.numsub(getToServerChannel(sessionId));
  return numSubs > 0;
}


export function redisRelayToMcpServer(sessionId: string, transport: Transport): () => Promise<void> {
  let redisCleanup: (() => Promise<void>) | undefined = undefined;
  const cleanup = async () => {
    // TODO: solve race conditions where we call cleanup while the subscription is being created / before it is created
    if (redisCleanup) {
      await redisCleanup();
    }
  }

  const messagePromise = new Promise<JSONRPCMessage>((resolve) => {
    transport.onmessage = async (message, extra) => {
      // First, set up response subscription if needed
      if ("id" in message) {
        const toClientChannel = getToClientChannel(sessionId, message.id.toString());

        redisCleanup = await redisClient.createSubscription(toClientChannel, async (redisMessageJson) => {
          const redisMessage = JSON.parse(redisMessageJson) as RedisMessage;
          if (redisMessage.type === 'mcp') {
            await transport.send(redisMessage.message, redisMessage.options);
          }
        }, (error) => {
          transport.onerror?.(error);
        });
      }
      
      // Now send the message to the MCP server
      await sendToMcpServer(sessionId, message, extra);
      resolve(message);
    }
  });

  messagePromise.catch((error) => {
    transport.onerror?.(error);
    cleanup();
  });

  return cleanup;
}


// New Redis transport for server->client messages using request-id based channels
export class ServerRedisTransport implements Transport {
  private counter: number;
  private _sessionId: string;
  private controlCleanup?: (() => Promise<void>);
  private serverCleanup?: (() => Promise<void>);
  private shouldShutdown = false;

  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage, extra?: { authInfo?: AuthInfo; }) => void) | undefined;

  constructor(sessionId: string) {
    this.counter = redisTransportCounter++;
    this._sessionId = sessionId;
  }

  async start(): Promise<void> {
    
    // Subscribe to MCP messages from clients
    const serverChannel = getToServerChannel(this._sessionId);
    this.serverCleanup = await redisClient.createSubscription(
      serverChannel,
      (messageJson) => {
        const redisMessage = JSON.parse(messageJson) as RedisMessage;
        if (redisMessage.type === 'mcp') {
          this.onmessage?.(redisMessage.message, redisMessage.extra);
        }
      },
      (error) => {
        this.onerror?.(error);
      }
    );
    
    // Subscribe to control messages for shutdown
    const controlChannel = getControlChannel(this._sessionId);
    this.controlCleanup = await redisClient.createSubscription(
      controlChannel,
      (messageJson) => {
        const redisMessage = JSON.parse(messageJson) as RedisMessage;
        if (redisMessage.type === 'control') {
          if (redisMessage.action === 'SHUTDOWN') {
            this.shouldShutdown = true;
            this.close();
          }
        }
      },
      (error) => {
        this.onerror?.(error);
      }
    );
    
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const relatedRequestId = options?.relatedRequestId?.toString() ?? ("id" in message ? message.id?.toString() : notificationStreamId);
    const channel = getToClientChannel(this._sessionId, relatedRequestId)

    const redisMessage: RedisMessage = { type: 'mcp', message, options };
    const messageStr = JSON.stringify(redisMessage);
    await redisClient.publish(channel, messageStr);
  }

  async close(): Promise<void> {
    
    // Clean up server message subscription
    if (this.serverCleanup) {
      await this.serverCleanup();
      this.serverCleanup = undefined;
    }
    
    // Clean up control message subscription
    if (this.controlCleanup) {
      await this.controlCleanup();
      this.controlCleanup = undefined;
    }
    
    this.onclose?.();
  }
}

export async function startServerListeningToRedis(serverWrapper: { server: Server; cleanup: () => void }, sessionId: string): Promise<ServerRedisTransport> {
  const serverRedisTransport = new ServerRedisTransport(sessionId);
  
  // Add cleanup callback to the transport
  const originalClose = serverRedisTransport.close.bind(serverRedisTransport);
  serverRedisTransport.close = async () => {
    serverWrapper.cleanup();
    await originalClose();
  };
  
  // The server.connect() will call start() on the transport
  await serverWrapper.server.connect(serverRedisTransport)
  
  return serverRedisTransport;
}

export async function getFirstShttpTransport(sessionId: string): Promise<{shttpTransport: StreamableHTTPServerTransport, cleanup: () => Promise<void>}> {
  const shttpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    enableJsonResponse: true, // Enable JSON response mode
  });
  
  // Use the new request-id based relay approach
  const cleanup = redisRelayToMcpServer(sessionId, shttpTransport);
  
  return { shttpTransport, cleanup };
}

export async function getShttpTransport(sessionId: string): Promise<{shttpTransport: StreamableHTTPServerTransport, cleanup: () => Promise<void>}> {
  // Giving undefined here and setting the sessionId means the 
  // transport wont try to create a new session.
  const shttpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Use JSON response mode for all requests
  })
  shttpTransport.sessionId = sessionId;

  // Use the new request-id based relay approach
  const cleanup = redisRelayToMcpServer(sessionId, shttpTransport);
  
  return { shttpTransport, cleanup };
}