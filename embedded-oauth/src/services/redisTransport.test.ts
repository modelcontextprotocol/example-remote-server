import { jest } from '@jest/globals';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MockRedisClient, setRedisClient } from '../redis.js';
import { 
  ServerRedisTransport, 
  redisRelayToMcpServer,
  isLive,
  shutdownSession,
  setSessionOwner,
  getSessionOwner,
  validateSessionOwnership,
  isSessionOwnedBy
} from './redisTransport.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

describe('Redis Transport', () => {
  let mockRedis: MockRedisClient;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    jest.resetAllMocks();
  });

  afterEach(() => {
    // Clear all Redis data and subscriptions
    mockRedis.clear();
  });

  describe('ServerRedisTransport', () => {
    let transport: ServerRedisTransport;
    const sessionId = 'test-session-123';

    beforeEach(() => {
      transport = new ServerRedisTransport(sessionId);
    });

    afterEach(async () => {
      if (transport) {
        await transport.close();
      }
    });

    it('should create transport with session ID', () => {
      expect(transport).toBeInstanceOf(ServerRedisTransport);
    });

    it('should send response messages to request-specific channels', async () => {
      const responseMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 123,
        result: { data: 'test response' }
      };

      const mockSubscriber = jest.fn();
      await mockRedis.createSubscription(
        `mcp:shttp:toclient:${sessionId}:123`, 
        mockSubscriber, 
        jest.fn()
      );

      await transport.send(responseMessage, { relatedRequestId: 123 });

      expect(mockSubscriber).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'mcp',
          message: responseMessage,
          options: { relatedRequestId: 123 }
        })
      );
    });

    it('should send notification messages to notification channel', async () => {
      const notificationMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { message: 'test notification' }
      };

      const mockSubscriber = jest.fn();
      await mockRedis.createSubscription(
        `mcp:shttp:toclient:${sessionId}:__GET_stream`, 
        mockSubscriber, 
        jest.fn()
      );

      await transport.send(notificationMessage);

      expect(mockSubscriber).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'mcp',
          message: notificationMessage,
          options: undefined
        })
      );
    });

    it('should handle close gracefully', async () => {
      const onCloseMock = jest.fn();
      transport.onclose = onCloseMock;

      await transport.close();

      expect(onCloseMock).toHaveBeenCalled();
    });

    it('should respond to shutdown control messages', async () => {
      await transport.start();
      
      const onCloseMock = jest.fn();
      transport.onclose = onCloseMock;

      // Send a shutdown control message
      await shutdownSession(sessionId);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onCloseMock).toHaveBeenCalled();
    });

    it('should receive MCP messages from clients and call onmessage', async () => {
      const onMessageMock = jest.fn();
      transport.onmessage = onMessageMock;

      await transport.start();

      // Simulate client sending a message to server
      const clientMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-req',
        method: 'tools/list',
        params: {}
      };

      await mockRedis.publish(
        `mcp:shttp:toserver:${sessionId}`,
        JSON.stringify({
          type: 'mcp',
          message: clientMessage,
          extra: { authInfo: { token: 'test-token', clientId: 'test-client', scopes: [] } }
        })
      );

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onMessageMock).toHaveBeenCalledWith(
        clientMessage,
        { authInfo: { token: 'test-token', clientId: 'test-client', scopes: [] } }
      );

      await transport.close();
    });
  });


  describe('redisRelayToMcpServer', () => {
    let mockTransport: Transport;
    const sessionId = 'test-session-456';

    beforeEach(() => {
      mockTransport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };
    });

    it('should set up message relay from transport to server', async () => {
      const cleanup = await redisRelayToMcpServer(sessionId, mockTransport);

      // Simulate a message from the transport
      const requestMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'req-123',
        method: 'tools/list',
        params: {}
      };

      // Trigger the onmessage handler
      mockTransport.onmessage?.(requestMessage, { authInfo: { token: 'test-token', clientId: 'test-client', scopes: [] } });

      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check that message was published to server channel
      const serverSubscriber = jest.fn();
      await mockRedis.createSubscription(
        `mcp:shttp:toserver:${sessionId}`,
        serverSubscriber,
        jest.fn()
      );

      // The message should have been published
      expect(mockRedis.numsub(`mcp:shttp:toserver:${sessionId}`)).resolves.toBe(1);

      await cleanup();
    });

    it('should subscribe to response channel for request messages', async () => {
      const cleanup = await redisRelayToMcpServer(sessionId, mockTransport);

      const requestMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'req-456',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hello' } }
      };

      // Trigger the onmessage handler
      mockTransport.onmessage?.(requestMessage, { authInfo: { token: 'test-token', clientId: 'test-client', scopes: [] } });

      // Wait for subscription setup
      await new Promise(resolve => setTimeout(resolve, 10));

      // Now simulate a response from the server
      const responseMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'req-456',
        result: { content: [{ type: 'text', text: 'hello' }] }
      };

      await mockRedis.publish(
        `mcp:shttp:toclient:${sessionId}:req-456`,
        JSON.stringify({
          type: 'mcp',
          message: responseMessage,
          options: undefined
        })
      );

      // Check that the response was sent back to the transport
      expect(mockTransport.send).toHaveBeenCalledWith(responseMessage, undefined);

      await cleanup();
    });

    it('should not subscribe for notification messages (no id)', async () => {
      const cleanup = await redisRelayToMcpServer(sessionId, mockTransport);

      const notificationMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { message: 'test' }
      };

      // Trigger the onmessage handler
      mockTransport.onmessage?.(notificationMessage);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should not create any response channel subscriptions
      expect(await mockRedis.numsub(`mcp:shttp:toclient:${sessionId}:undefined`)).toBe(0);

      await cleanup();
    });
  });

  describe('isLive', () => {
    const sessionId = 'test-session-789';

    it('should return true when session has active subscribers', async () => {
      // Create a subscription to the server channel
      await mockRedis.createSubscription(
        `mcp:shttp:toserver:${sessionId}`,
        jest.fn(),
        jest.fn()
      );

      expect(await isLive(sessionId)).toBe(true);
    });

    it('should return false when session has no subscribers', async () => {
      expect(await isLive(sessionId)).toBe(false);
    });
  });

  describe('Session Ownership', () => {
    const sessionId = 'test-session-ownership';
    const userId = 'test-user-123';

    it('should set and get session owner', async () => {
      await setSessionOwner(sessionId, userId);
      const owner = await getSessionOwner(sessionId);
      expect(owner).toBe(userId);
    });

    it('should validate session ownership correctly', async () => {
      await setSessionOwner(sessionId, userId);
      
      expect(await validateSessionOwnership(sessionId, userId)).toBe(true);
      expect(await validateSessionOwnership(sessionId, 'different-user')).toBe(false);
    });

    it('should check if session is owned by user including liveness', async () => {
      // Session not live yet
      expect(await isSessionOwnedBy(sessionId, userId)).toBe(false);
      
      // Make session live
      await mockRedis.createSubscription(
        `mcp:shttp:toserver:${sessionId}`,
        jest.fn(),
        jest.fn()
      );
      
      // Still false because no owner set
      expect(await isSessionOwnedBy(sessionId, userId)).toBe(false);
      
      // Set owner
      await setSessionOwner(sessionId, userId);
      
      // Now should be true
      expect(await isSessionOwnedBy(sessionId, userId)).toBe(true);
      
      // False for different user
      expect(await isSessionOwnedBy(sessionId, 'different-user')).toBe(false);
    });
  });

  describe('Integration: Redis message flow', () => {
    const sessionId = 'integration-test-session';

    it('should relay messages between client and server through Redis', async () => {
      // Set up client-side transport simulation
      const clientTransport: Transport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };

      const cleanup = await redisRelayToMcpServer(sessionId, clientTransport);

      // Client sends a request
      const listToolsRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'integration-req-1',
        method: 'tools/list',
        params: {}
      };

      // Set up subscription to simulate server receiving the message
      const serverSubscriber = jest.fn();
      await mockRedis.createSubscription(
        `mcp:shttp:toserver:${sessionId}`,
        serverSubscriber,
        jest.fn()
      );

      // Simulate client sending request
      clientTransport.onmessage?.(listToolsRequest);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the message was published to server channel
      expect(serverSubscriber).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'mcp',
          message: listToolsRequest,
          extra: undefined,
          options: undefined
        })
      );

      // Simulate server sending response
      const serverResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'integration-req-1',
        result: { tools: [{ name: 'echo', description: 'Echo tool' }] }
      };

      await mockRedis.publish(
        `mcp:shttp:toclient:${sessionId}:integration-req-1`,
        JSON.stringify({
          type: 'mcp',
          message: serverResponse,
          options: undefined
        })
      );

      // Wait for response processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the response was sent back to client
      expect(clientTransport.send).toHaveBeenCalledWith(serverResponse, undefined);

      await cleanup();
    });
  });

  describe('Control Messages', () => {
    const sessionId = 'test-control-session';

    it('should send shutdown control messages', async () => {
      const controlSubscriber = jest.fn();
      await mockRedis.createSubscription(
        `mcp:control:${sessionId}`,
        controlSubscriber,
        jest.fn()
      );

      await shutdownSession(sessionId);

      const callArgs = controlSubscriber.mock.calls[0][0] as string;
      const message = JSON.parse(callArgs);
      
      expect(message.type).toBe('control');
      expect(message.action).toBe('SHUTDOWN');
      expect(typeof message.timestamp).toBe('number');
    });

    it('should properly shutdown server transport via control message', async () => {
      const transport = new ServerRedisTransport(sessionId);
      const onCloseMock = jest.fn();
      transport.onclose = onCloseMock;

      await transport.start();

      // Send shutdown signal
      await shutdownSession(sessionId);
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  describe('Inactivity Timeout', () => {
    const sessionId = 'test-inactivity-session';

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should shutdown session after 5 minutes of inactivity', async () => {
      const transport = new ServerRedisTransport(sessionId);
      const shutdownSpy = jest.spyOn(mockRedis, 'publish');
      
      await transport.start();

      // Fast-forward time by 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Should have published shutdown control message
      expect(shutdownSpy).toHaveBeenCalledWith(
        `mcp:control:${sessionId}`,
        expect.stringContaining('"action":"SHUTDOWN"')
      );

      await transport.close();
    });

    it('should reset timeout when message is received', async () => {
      const transport = new ServerRedisTransport(sessionId);
      const onMessageMock = jest.fn();
      transport.onmessage = onMessageMock;
      
      await transport.start();

      // Fast-forward 4 minutes
      jest.advanceTimersByTime(4 * 60 * 1000);

      // Manually publish a message to trigger the subscription handler
      const testMessage = { jsonrpc: '2.0', method: 'ping' };
      await mockRedis.publish(
        `mcp:shttp:toserver:${sessionId}`,
        JSON.stringify({
          type: 'mcp',
          message: testMessage
        })
      );

      // Wait for message to be processed
      await new Promise(resolve => setImmediate(resolve));

      // Verify message was received
      expect(onMessageMock).toHaveBeenCalledWith(testMessage, undefined);

      // Clear the publish spy to check only future calls
      const shutdownSpy = jest.spyOn(mockRedis, 'publish');
      shutdownSpy.mockClear();

      // Fast-forward 4 more minutes (total 8, but only 4 since last message)
      jest.advanceTimersByTime(4 * 60 * 1000);

      // Should not have shutdown yet
      expect(shutdownSpy).not.toHaveBeenCalledWith(
        `mcp:control:${sessionId}`,
        expect.stringContaining('"action":"SHUTDOWN"')
      );

      // Fast-forward 2 more minutes to exceed timeout
      jest.advanceTimersByTime(2 * 60 * 1000);

      // Now should have shutdown
      expect(shutdownSpy).toHaveBeenCalledWith(
        `mcp:control:${sessionId}`,
        expect.stringContaining('"action":"SHUTDOWN"')
      );

      await transport.close();
    }, 10000);

    it('should clear timeout on close', async () => {
      const transport = new ServerRedisTransport(sessionId);
      const shutdownSpy = jest.spyOn(mockRedis, 'publish');
      
      await transport.start();

      // Close transport before timeout
      await transport.close();

      // Fast-forward past timeout
      jest.advanceTimersByTime(10 * 60 * 1000);

      // Should not have triggered shutdown
      expect(shutdownSpy).not.toHaveBeenCalledWith(
        `mcp:control:${sessionId}`,
        expect.stringContaining('"action":"SHUTDOWN"')
      );
    });
  });
});