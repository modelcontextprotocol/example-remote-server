import { MockRedisClient } from "../redis.js";
import { SessionManager } from "./sessionManager.js";

describe("SessionManager", () => {
  let mockRedis: MockRedisClient;
  let sessionManager: SessionManager;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    sessionManager = new SessionManager(mockRedis);
  });

  afterEach(() => {
    mockRedis.clear();
  });

  describe("createSession", () => {
    it("should create a new session with metadata", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);

      const metadata = await sessionManager.getSessionMetadata(sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata!.sessionId).toBe(sessionId);
      expect(metadata!.clientId).toBe(clientId);
      expect(metadata!.createdAt).toBeGreaterThan(0);
      expect(metadata!.lastActivity).toBeGreaterThan(0);
    });

    it("should initialize connection state as disconnected", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);

      const isConnected = await sessionManager.isConnected(sessionId);
      expect(isConnected).toBe(false);
    });
  });

  describe("refreshSession", () => {
    it("should refresh an existing session", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);
      const originalMetadata = await sessionManager.getSessionMetadata(sessionId);

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const refreshed = await sessionManager.refreshSession(sessionId);
      expect(refreshed).toBe(true);

      const newMetadata = await sessionManager.getSessionMetadata(sessionId);
      expect(newMetadata!.lastActivity).toBeGreaterThan(originalMetadata!.lastActivity);
    });

    it("should return false for non-existent session", async () => {
      const refreshed = await sessionManager.refreshSession("non-existent");
      expect(refreshed).toBe(false);
    });
  });

  describe("deleteSession", () => {
    it("should delete a session and all associated data", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);
      await sessionManager.bufferMessage(sessionId, JSON.stringify({ test: "message" }));

      // Verify session exists
      expect(await sessionManager.sessionExists(sessionId)).toBe(true);

      await sessionManager.deleteSession(sessionId);

      // Verify session is gone
      expect(await sessionManager.sessionExists(sessionId)).toBe(false);
      const messages = await sessionManager.getBufferedMessages(sessionId);
      expect(messages).toHaveLength(0);
    });
  });

  describe("connection state management", () => {
    it("should track connection state", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);

      // Initially disconnected
      expect(await sessionManager.isConnected(sessionId)).toBe(false);

      // Set to connected
      await sessionManager.setConnectionState(sessionId, true);
      expect(await sessionManager.isConnected(sessionId)).toBe(true);

      // Set back to disconnected
      await sessionManager.setConnectionState(sessionId, false);
      expect(await sessionManager.isConnected(sessionId)).toBe(false);
    });
  });

  describe("message buffering", () => {
    it("should buffer and retrieve messages", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);

      const message1 = JSON.stringify({ type: "request", id: 1 });
      const message2 = JSON.stringify({ type: "request", id: 2 });

      await sessionManager.bufferMessage(sessionId, message1);
      await sessionManager.bufferMessage(sessionId, message2);

      const bufferedMessages = await sessionManager.getBufferedMessages(sessionId);
      expect(bufferedMessages).toHaveLength(2);
      // Messages are returned in reverse order due to lpush
      expect(bufferedMessages[0]).toBe(message2);
      expect(bufferedMessages[1]).toBe(message1);
    });

    it("should clear buffered messages", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);
      await sessionManager.bufferMessage(sessionId, JSON.stringify({ test: "message" }));

      // Verify message is buffered
      const messages = await sessionManager.getBufferedMessages(sessionId);
      expect(messages).toHaveLength(1);

      // Clear messages
      await sessionManager.clearBufferedMessages(sessionId);

      // Verify messages are cleared
      const clearedMessages = await sessionManager.getBufferedMessages(sessionId);
      expect(clearedMessages).toHaveLength(0);
    });
  });

  describe("sessionExists", () => {
    it("should return true for existing session", async () => {
      const sessionId = "test-session-123";
      const clientId = "test-client";

      await sessionManager.createSession(sessionId, clientId);
      expect(await sessionManager.sessionExists(sessionId)).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      expect(await sessionManager.sessionExists("non-existent")).toBe(false);
    });
  });
});