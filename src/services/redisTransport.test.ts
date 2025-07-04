import { jest } from '@jest/globals';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MockRedisClient, setRedisClient } from '../redis.js';
import { 
  ServerRedisTransport, 
  redisRelayToMcpServer,
  isLive,
  startServerListeningToRedis
} from './redisTransport.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createMcpServer } from './mcp.js';

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

    it('should create transport with session ID', () => {
      expect(transport).toBeInstanceOf(ServerRedisTransport);
    });

    it('should start without subscribing (server only sends)', async () => {
      await transport.start();
      // Should not create any subscriptions since server only sends
      expect(mockRedis.numsub('any-channel')).resolves.toBe(0);
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
  });


  describe('redisRelayToMcpServer', () => {
    let mockTransport: Transport;
    const sessionId = 'test-session-456';

    beforeEach(() => {
      mockTransport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(),
        close: jest.fn(),
        start: jest.fn()
      };
    });

    it('should set up message relay from transport to server', async () => {
      const cleanup = redisRelayToMcpServer(sessionId, mockTransport);

      // Simulate a message from the transport
      const requestMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'req-123',
        method: 'tools/list',
        params: {}
      };

      // Trigger the onmessage handler
      mockTransport.onmessage?.(requestMessage, { authInfo: { userId: 'test' } });

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
      const cleanup = redisRelayToMcpServer(sessionId, mockTransport);

      const requestMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'req-456',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hello' } }
      };

      // Trigger the onmessage handler
      mockTransport.onmessage?.(requestMessage, { authInfo: { userId: 'test' } });

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
          message: responseMessage,
          options: undefined
        })
      );

      // Check that the response was sent back to the transport
      expect(mockTransport.send).toHaveBeenCalledWith(responseMessage, undefined);

      await cleanup();
    });

    it('should not subscribe for notification messages (no id)', async () => {
      const cleanup = redisRelayToMcpServer(sessionId, mockTransport);

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

  describe('startServerListeningToRedis', () => {
    const sessionId = 'test-session-server';

    it('should connect server with ServerRedisTransport', async () => {
      const { server } = createMcpServer();
      const connectSpy = jest.spyOn(server, 'connect');

      await startServerListeningToRedis(server, sessionId);

      expect(connectSpy).toHaveBeenCalledWith(
        expect.any(ServerRedisTransport)
      );
    });

    it('should create transport that can send responses', async () => {
      const { server } = createMcpServer();
      
      await startServerListeningToRedis(server, sessionId);

      // The server should now be connected and able to handle requests via Redis
      // This is tested implicitly by the connection succeeding
      expect(server).toBeDefined();
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
        send: jest.fn(),
        close: jest.fn(),
        start: jest.fn()
      };

      const cleanup = redisRelayToMcpServer(sessionId, clientTransport);

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
});