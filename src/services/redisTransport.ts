import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { redisClient } from "../redis.js";
import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

let redisTransportCounter = 0;

function getToServerChannel(sessionId: string): string {
  return `mcp:shttp:toserver:${sessionId}`;
}

function getToClientChannel(sessionId: string): string {
  return `mcp:shttp:toclient:${sessionId}`;
}

export async function isLive(sessionId: string): Promise<boolean> {
  // Check if the session is live by checking if the key exists in Redis
  const numSubs = await redisClient.numsub(getToServerChannel(sessionId));
  console.log(`[isLive] Session ${sessionId}: Redis subscribers on ${getToServerChannel(sessionId)} = ${numSubs}`);
  return numSubs > 0;
}


export class RedisTransport implements Transport {
  private redisCleanup: (() => Promise<void>) | undefined;
  private counter: number;

  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: ((message: JSONRPCMessage, extra?: { authInfo?: AuthInfo; }) => void) | undefined;

  constructor(
    private sendChannel: string,
    private recvChannel: string,
    private isLiveKey: string | undefined = undefined
  ) {
    this.counter = redisTransportCounter++;
    this.sendChannel = sendChannel;
    this.recvChannel = recvChannel;
    this.isLiveKey = isLiveKey;
  }

  

  async start(): Promise<void> {
    console.log(`[RedisTransport.${this.counter}.start] Starting transport - send: ${this.sendChannel}, recv: ${this.recvChannel}`);
    if (this.redisCleanup) {
      throw new Error(`Redis transport already started for channels ${this.sendChannel} and ${this.recvChannel}`);
    }

    // Log when onmessage is set
    console.log(`[RedisTransport.${this.counter}.start] onmessage handler is ${this.onmessage ? 'SET' : 'NOT SET'}`);

    this.redisCleanup = await redisClient.createSubscription(
      this.recvChannel,
      (json) => {
        console.log(`[RedisTransport.${this.counter}] Received message on ${this.recvChannel}:`, json.substring(0, 100));
        const message = JSON.parse(json);
        const extra = popExtra(message);
        if (this.onmessage) {
          console.log(`[RedisTransport.${this.counter}] Calling onmessage handler for ${this.recvChannel}`);
          this.onmessage(message, extra)
        } else {
          console.log(`[RedisTransport.${this.counter}] WARNING: No onmessage handler for ${this.recvChannel}!`);
        }
      },
      (error) => {
        console.error(
          `[Redis transport] Disconnecting due to error in Redis subscriber:`,
          error,
        );
        this.close()
      },
    );
    console.log(`[RedisTransport.${this.counter}.start] Successfully subscribed to ${this.recvChannel}`);
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    if (options) {
      setOptions(message, options);
    }
    const messageStr = JSON.stringify(message);
    console.log(`[RedisTransport.${this.counter}.send] Publishing to ${this.sendChannel}:`, messageStr.substring(0, 100));
    console.log(`[RedisTransport.${this.counter}.send] Full message:`, messageStr);
    await redisClient.publish(this.sendChannel, messageStr);
    console.log(`[RedisTransport.${this.counter}.send] Published successfully to ${this.sendChannel}`);
  }


  async cleanup(): Promise<void> {
    if (this.redisCleanup) {
      console.log(`[RedisTransport.${this.counter}.cleanup] Unsubscribing from ${this.recvChannel}`);
      await this.redisCleanup()
      this.redisCleanup = undefined;
      console.log(`[RedisTransport.${this.counter}.cleanup] Successfully unsubscribed from ${this.recvChannel}`);
    }
    if (this.isLiveKey) {
      await redisClient.del(this.isLiveKey);
    }
  }

  async close(): Promise<void> {
    console.log(`[RedisTransport.${this.counter}.close] Closing transport - send: ${this.sendChannel}, recv: ${this.recvChannel}`);
    this.onclose?.();
    await this.cleanup()
  }
}


function setExtra(message: JSONRPCMessage, extra: { authInfo?: AuthInfo; } | undefined): void {
  if (!extra) {
    return;
  }
  if ("result" in message && typeof message.result === 'object') {
    if (!message.result._meta) {
      message.result._meta = {};
    }
    message.result._meta.extra = extra;
  }
  if ("params" in message && typeof message.params === 'object') {
    if (!message.params._meta) {
      message.params._meta = {};
    }
    message.params._meta.extra = extra;
  }
}

function setOptions(message: JSONRPCMessage, options: TransportSendOptions): void {
  if ("result" in message && typeof message.result === 'object') {
    if (!message.result._meta) {
      message.result._meta = {};
    }
    message.result._meta.options = options;
  }
  if ("params" in message && typeof message.params === 'object') {
    if (!message.params._meta) {
      message.params._meta = {};
    }
    message.params._meta.options = options;
  }
}

function popExtra(message: JSONRPCMessage): { authInfo?: AuthInfo; } | undefined {
  if ("params" in message && typeof message.params === 'object' && message.params._meta) {
    const extra = message.params._meta.extra as { authInfo?: AuthInfo; } | undefined;
    if (extra) {
      delete message.params._meta.extra;
      return extra;
    }
  }
  if ("result" in message && typeof message.result === 'object' && message.result._meta) {
    const extra = message.result._meta.extra as { authInfo?: AuthInfo; } | undefined;
    if (extra) {
      delete message.result._meta.extra;
      return extra;
    }
  }
  return undefined;
}

function popOptions(message: JSONRPCMessage): TransportSendOptions | undefined {
  if ("params" in message && typeof message.params === 'object' && message.params._meta) {
    const options = message.params._meta.options as TransportSendOptions | undefined;
    if (options) {
      delete message.params._meta.options;
      return options;
    }
  }
  if ("result" in message && typeof message.result === 'object' && message.result._meta) {
    const options = message.result._meta.options as TransportSendOptions | undefined;
    if (options) {
      delete message.result._meta.options;
      return options;
    }
  }
  return undefined;
}


function relayTransports(transport1: Transport, transport2: Transport): void {
  console.log(`[relayTransports] Setting up relay between transports`);
  transport1.onmessage = (message, extra) => {
    console.log(`[relay] transport1 -> transport2:`, JSON.stringify(message).substring(0, 100));
    setExtra(message, extra);
    const options = popOptions(message);
    transport2.send(message, options)
  };
  transport2.onmessage = (message, extra) => {
    console.log(`[relay] transport2 -> transport1:`, JSON.stringify(message).substring(0, 100));
    setExtra(message, extra);
    const options = popOptions(message);
    transport1.send(message, options)
  };

  transport1.onerror = (error) => {
    transport2.onerror?.(error);
  };
  transport2.onerror = (error) => {
    transport1.onerror?.(error);
  };

  // Prevent circular close calls
  let closing = false;
  
  transport1.onclose = () => {
    if (!closing) {
      closing = true;
      transport2.close().catch(console.error);
    }
  };
  transport2.onclose = () => {
    if (!closing) {
      closing = true;
      transport1.close().catch(console.error);
    }
  };
}


export async function startServerListeningToRedis(server: Server, sessionId: string) {
  console.log(`[startServerListeningToRedis] Starting background server for session ${sessionId}`);
  const serverRedisTransport = createBackgroundTaskSideRedisTransport(sessionId)
  
  // Log all messages sent by the server
  const originalSend = serverRedisTransport.send.bind(serverRedisTransport);
  serverRedisTransport.send = async (message, options) => {
    console.log(`[MCP Server -> Redis] Sending response:`, JSON.stringify(message).substring(0, 200));
    return originalSend(message, options);
  };
  
  // The server.connect() will call start() on the transport
  await server.connect(serverRedisTransport)
  console.log(`[startServerListeningToRedis] Background server connected for session ${sessionId}`);
}

function createShttpHandlerSideRedisTransport(sessionId: string): RedisTransport {
  return new RedisTransport(
    getToServerChannel(sessionId),
    getToClientChannel(sessionId),
  );
}

function createBackgroundTaskSideRedisTransport(sessionId: string): RedisTransport {
  return new RedisTransport(
    getToClientChannel(sessionId),
    getToServerChannel(sessionId),
  );
}

export async function getFirstShttpTransport(sessionId: string): Promise<{shttpTransport: StreamableHTTPServerTransport, redisTransport: RedisTransport}> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    enableJsonResponse: true, // Enable JSON response mode
  });
  
  const redisTransport = createShttpHandlerSideRedisTransport(sessionId);
  
  // When shttpTransport closes, so does the redisTransport
  relayTransports(redisTransport, transport);
  await redisTransport.start()
  return { shttpTransport: transport, redisTransport };
}

export async function getShttpTransport(sessionId: string): Promise<{shttpTransport: StreamableHTTPServerTransport, redisTransport: RedisTransport}> {
  // Giving undefined here and setting the sessionId means the 
  // transport wont try to create a new session.
  const shttpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Use JSON response mode for all requests
  })
  shttpTransport.sessionId = sessionId;

  const redisTransport = createShttpHandlerSideRedisTransport(sessionId);
  
  // When shttpTransport closes, so does the redisTransport
  relayTransports(redisTransport, shttpTransport);
  await redisTransport.start()
  return { shttpTransport, redisTransport };
}