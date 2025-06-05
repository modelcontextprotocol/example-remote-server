import { RedisClient } from "../redis.js";

export interface SessionMetadata {
  sessionId: string;
  clientId: string;
  createdAt: number;
  lastActivity: number;
}

/**
 * Redis-based session manager for horizontal scaling
 */
export class SessionManager {
  private static SESSION_TTL = 5 * 60; // 5 minutes in seconds

  constructor(private redisClient: RedisClient) {}

  // Redis key generators
  private sessionMetadataKey(sessionId: string): string {
    return `session:${sessionId}:metadata`;
  }

  private sessionMessagesKey(sessionId: string): string {
    return `session:${sessionId}:messages`;
  }

  private sessionConnectionKey(sessionId: string): string {
    return `session:${sessionId}:connection`;
  }

  /**
   * Create a new session in Redis with TTL
   */
  async createSession(sessionId: string, clientId: string): Promise<void> {
    const metadata: SessionMetadata = {
      sessionId,
      clientId,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    // Store session metadata with TTL
    await this.redisClient.set(
      this.sessionMetadataKey(sessionId),
      JSON.stringify(metadata),
      { EX: SessionManager.SESSION_TTL }
    );

    // Initialize empty message buffer
    await this.redisClient.del(this.sessionMessagesKey(sessionId));

    // Mark connection as disconnected initially
    await this.redisClient.set(
      this.sessionConnectionKey(sessionId), 
      'disconnected', 
      { EX: SessionManager.SESSION_TTL }
    );

    console.log(`Session created: ${sessionId} for client: ${clientId}`);
  }

  /**
   * Refresh session TTL and update last activity
   */
  async refreshSession(sessionId: string): Promise<boolean> {
    const metadata = await this.getSessionMetadata(sessionId);
    if (!metadata) {
      return false;
    }

    // Update last activity and refresh TTL
    metadata.lastActivity = Date.now();
    await this.redisClient.set(
      this.sessionMetadataKey(sessionId),
      JSON.stringify(metadata),
      { EX: SessionManager.SESSION_TTL }
    );

    // Refresh other keys too
    await this.redisClient.expire(this.sessionMessagesKey(sessionId), SessionManager.SESSION_TTL);
    await this.redisClient.expire(this.sessionConnectionKey(sessionId), SessionManager.SESSION_TTL);

    console.log(`Session refreshed: ${sessionId}`);
    return true;
  }

  /**
   * Delete session and all associated data
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redisClient.del(this.sessionMetadataKey(sessionId));
    await this.redisClient.del(this.sessionMessagesKey(sessionId));
    await this.redisClient.del(this.sessionConnectionKey(sessionId));

    console.log(`Session deleted: ${sessionId}`);
  }

  /**
   * Get session metadata
   */
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const data = await this.redisClient.get(this.sessionMetadataKey(sessionId));
    return data ? JSON.parse(data) : null;
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const metadata = await this.getSessionMetadata(sessionId);
    return metadata !== null;
  }

  /**
   * Mark SSE connection as connected/disconnected
   */
  async setConnectionState(sessionId: string, connected: boolean): Promise<void> {
    await this.redisClient.set(
      this.sessionConnectionKey(sessionId),
      connected ? 'connected' : 'disconnected',
      { EX: SessionManager.SESSION_TTL }
    );

    console.log(`Session ${sessionId} connection state: ${connected ? 'connected' : 'disconnected'}`);
  }

  /**
   * Check if SSE connection is active
   */
  async isConnected(sessionId: string): Promise<boolean> {
    const state = await this.redisClient.get(this.sessionConnectionKey(sessionId));
    return state === 'connected';
  }

  /**
   * Get buffered messages for a session
   */
  async getBufferedMessages(sessionId: string): Promise<string[]> {
    return await this.redisClient.lrange(this.sessionMessagesKey(sessionId), 0, -1);
  }

  /**
   * Add a message to the buffer
   */
  async bufferMessage(sessionId: string, message: string): Promise<void> {
    await this.redisClient.lpush(this.sessionMessagesKey(sessionId), message);
    // Set TTL on the messages list
    await this.redisClient.expire(this.sessionMessagesKey(sessionId), SessionManager.SESSION_TTL);
  }

  /**
   * Clear buffered messages
   */
  async clearBufferedMessages(sessionId: string): Promise<void> {
    await this.redisClient.del(this.sessionMessagesKey(sessionId));
  }
}