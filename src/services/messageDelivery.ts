import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RedisClient } from "../redis.js";
import { SessionManager } from "./sessionManager.js";

/**
 * Handles message delivery with buffering support for disconnected clients
 */
export class MessageDelivery {
  constructor(
    private redisClient: RedisClient,
    private sessionManager: SessionManager
  ) {}

  /**
   * Deliver a message to a session, either directly or via buffering
   */
  async deliverMessage(sessionId: string, message: JSONRPCMessage): Promise<void> {
    const isConnected = await this.sessionManager.isConnected(sessionId);

    if (isConnected) {
      // Direct delivery via existing Redis pub/sub
      const redisChannel = this.getRedisChannel(sessionId);
      await this.redisClient.publish(redisChannel, JSON.stringify(message));
      console.log(`Message delivered directly to session ${sessionId}`);
    } else {
      // Buffer the message for later delivery
      await this.sessionManager.bufferMessage(sessionId, JSON.stringify(message));
      console.log(`Message buffered for disconnected session ${sessionId}`);
    }
  }

  /**
   * Deliver all buffered messages to a transport and clear the buffer
   */
  async deliverBufferedMessages(sessionId: string, transport: StreamableHTTPServerTransport): Promise<void> {
    // Get all buffered messages
    const bufferedMessages = await this.sessionManager.getBufferedMessages(sessionId);

    if (bufferedMessages.length === 0) {
      console.log(`No buffered messages for session ${sessionId}`);
      return;
    }

    console.log(`Delivering ${bufferedMessages.length} buffered messages to session ${sessionId}`);

    // Deliver buffered messages in order (reverse because lpush adds to front)
    for (let i = bufferedMessages.length - 1; i >= 0; i--) {
      const message = JSON.parse(bufferedMessages[i]);
      try {
        await transport.send(message);
      } catch (error) {
        console.error(`Failed to deliver buffered message to session ${sessionId}:`, error);
        // Don't rethrow - continue with other messages
      }
    }

    // Clear the buffer after successful delivery
    await this.sessionManager.clearBufferedMessages(sessionId);
    console.log(`Cleared buffered messages for session ${sessionId}`);
  }

  /**
   * Set up Redis subscription for a session's SSE connection
   */
  async setupRedisSubscription(
    sessionId: string, 
    transport: StreamableHTTPServerTransport
  ): Promise<() => Promise<void>> {
    const redisChannel = this.getRedisChannel(sessionId);

    console.log(`Setting up Redis subscription for session ${sessionId} on channel ${redisChannel}`);

    const redisCleanup = await this.redisClient.createSubscription(
      redisChannel,
      async (message) => {
        const jsonMessage = JSON.parse(message);
        try {
          await transport.send(jsonMessage);
          console.log(`Message sent via SSE for session ${sessionId}`);
        } catch (error) {
          console.error(`Failed to send message via SSE for session ${sessionId}:`, error);
          // Mark connection as disconnected so future messages get buffered
          await this.sessionManager.setConnectionState(sessionId, false);
        }
      },
      async (error) => {
        console.error(`Redis subscription error for session ${sessionId}:`, error);
        await this.sessionManager.setConnectionState(sessionId, false);
      }
    );

    return redisCleanup;
  }

  /**
   * Get the Redis channel name for a session (matches existing SSE pattern)
   */
  private getRedisChannel(sessionId: string): string {
    return `mcp:${sessionId}`;
  }
}