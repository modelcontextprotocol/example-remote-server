import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { redisClient } from "../redis.js";
import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

let redisTransportCounter = 0;
const notificationStreamId = "__GET_stream";

interface RedisMessage {
  message: JSONRPCMessage;
  extra?: MessageExtraInfo;
  options?: TransportSendOptions;
}

function sendToMcpServer(sessionId: string, message: JSONRPCMessage, extra?: { authInfo?: AuthInfo; }, options?: TransportSendOptions): Promise<void> {
  const toServerChannel = getToServerChannel(sessionId);
  const redisMessage: RedisMessage = { message, extra, options };
  console.log(`[sendToServerChannel] Publishing to ${toServerChannel}:`, JSON.stringify(redisMessage).substring(0, 100));
  return redisClient.publish(toServerChannel, JSON.stringify(redisMessage));
}

function getToServerChannel(sessionId: string): string {
  return `mcp:shttp:toserver:${sessionId}`;
}

function getToClientChannel(sessionId: string, relatedRequestId: string): string {
  return `mcp:shttp:toclient:${sessionId}:${relatedRequestId}`;
}

export async function isLive(sessionId: string): Promise<boolean> {
  // Check if the session is live by checking if the key exists in Redis
  const numSubs = await redisClient.numsub(getToServerChannel(sessionId));
  console.log(`[isLive] Session ${sessionId}: Redis subscribers on ${getToServerChannel(sessionId)} = ${numSubs}`);
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

  new Promise<JSONRPCMessage>((resolve) => {
    transport.onmessage = async (message, extra) => {
      await sendToMcpServer(sessionId, message, extra);
      resolve(message);
    }
  }).then(async (message) => {
    // check for request id in the message
    if (!("id" in message)) {
      // if no id, it's a notification, so we return
      return cleanup;
    }
    // otherwise we subscribe to the response channel
    const toClientChannel = getToClientChannel(sessionId, message.id.toString());

    console.log(`[redisRelayToMcpServer] Subscribing to ${toClientChannel} for response to request ${message.id}`);

    redisCleanup = await redisClient.createSubscription(toClientChannel, async (redisMessageJson) => {
      const redisMessage = JSON.parse(redisMessageJson) as RedisMessage;
      await transport.send(redisMessage.message, redisMessage.options);
    }, (error) => {
      console.error(`[redisRelayToMcpServer] Error in Redis subscriber for ${toClientChannel}:`, error);
      transport.onerror?.(error);
    });
  }).catch((error) => {
    console.error(`[redisRelayToMcpServer] Error setting up Redis relay for session ${sessionId}:`, error);
    transport.onerror?.(error);
    cleanup();
  });

  return cleanup;
}


// New Redis transport for server->client messages using request-id based channels
export class ServerRedisTransport implements Transport {
  private counter: number;
  private _sessionId: string;

  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage, extra?: { authInfo?: AuthInfo; }) => void) | undefined;

  constructor(sessionId: string) {
    this.counter = redisTransportCounter++;
    this._sessionId = sessionId;
  }

  async start(): Promise<void> {
    console.log(`[ServerRedisTransport.${this.counter}.start] Starting server transport for session: ${this._sessionId}`);
    // Server transport doesn't need to subscribe to anything - it only sends responses
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const relatedRequestId = options?.relatedRequestId?.toString() ?? notificationStreamId;
    const channel = getToClientChannel(this._sessionId, relatedRequestId)

    const redisMessage: RedisMessage = { message, options };
    const messageStr = JSON.stringify(redisMessage);
    console.log(`[ServerRedisTransport.${this.counter}.send] Publishing to ${channel}:`, messageStr.substring(0, 100));
    await redisClient.publish(channel, messageStr);
    console.log(`[ServerRedisTransport.${this.counter}.send] Published successfully to ${channel}`);
  }

  async close(): Promise<void> {
    console.log(`[ServerRedisTransport.${this.counter}.close] Closing server transport for session: ${this._sessionId}`);
    this.onclose?.();
  }
}

export async function startServerListeningToRedis(server: Server, sessionId: string) {
  console.log(`[startServerListeningToRedis] Starting background server for session ${sessionId}`);
  const serverRedisTransport = new ServerRedisTransport(sessionId);
  
  // The server.connect() will call start() on the transport
  await server.connect(serverRedisTransport)
  console.log(`[startServerListeningToRedis] Background server connected for session ${sessionId}`);
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