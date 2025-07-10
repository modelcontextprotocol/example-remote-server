import { jest } from '@jest/globals';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MockRedisClient, setRedisClient } from '../redis.js';
import { 
  ServerRedisTransport,
  redisRelayToMcpServer,
  shutdownSession
} from './redisTransport.js';
import { createMcpServer } from './mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

describe('Redis Transport Integration', () => {
  let mockRedis: MockRedisClient;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    jest.resetAllMocks();
  });

  afterEach(() => {
    mockRedis.clear();
  });

  describe('MCP Initialization Flow', () => {
    const sessionId = 'test-init-session';

    it('should relay initialization request from client to server through Redis', async () => {
      // 1. Start the server listening to Redis
      const { server, cleanup: serverCleanup } = createMcpServer();
      const serverTransport = new ServerRedisTransport(sessionId);
      serverTransport.onclose = serverCleanup;
      await server.connect(serverTransport);

      // 2. Create a mock client transport (simulating the streamable HTTP client side)
      const mockClientTransport: Transport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };

      // 3. Set up the Redis relay (this is what happens in the HTTP handler)
      const cleanup = await redisRelayToMcpServer(sessionId, mockClientTransport);

      // Track messages received by server
      const serverReceivedMessages: JSONRPCMessage[] = [];
      const originalServerOnMessage = serverTransport.onmessage;
      serverTransport.onmessage = (message, extra) => {
        serverReceivedMessages.push(message);
        originalServerOnMessage?.(message, extra);
      };

      // 4. Simulate client sending initialization request
      const initMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      // Trigger the client transport onmessage (simulates HTTP request)
      mockClientTransport.onmessage?.(initMessage);

      // Wait for message to be relayed through Redis
      await new Promise(resolve => setTimeout(resolve, 50));

      // 5. Verify server received the init message
      expect(serverReceivedMessages).toHaveLength(1);
      expect(serverReceivedMessages[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize'
      });

      // 6. Simulate server responding (this should get relayed back to client)
      const initResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            prompts: {},
            resources: {}
          },
          serverInfo: {
            name: 'example-server',
            version: '1.0.0'
          }
        }
      };

      await serverTransport.send(initResponse, { relatedRequestId: 'init-1' });

      // Wait for response to be relayed back
      await new Promise(resolve => setTimeout(resolve, 50));

      // 7. Verify client transport received the response
      expect(mockClientTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 'init-1',
          result: expect.objectContaining({
            protocolVersion: '2024-11-05',
            serverInfo: expect.objectContaining({
              name: 'example-server'
            })
          })
        }),
        { relatedRequestId: 'init-1' }
      );

      // Cleanup
      await cleanup();
      await shutdownSession(sessionId);
      serverCleanup(); // Clean up MCP server intervals
      
      // Ensure server transport is closed
      await serverTransport.close();
      
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should handle tools/list request through Redis relay', async () => {
      // Set up server and mock client
      const { server, cleanup: serverCleanup } = createMcpServer();
      const serverTransport = new ServerRedisTransport(sessionId);
      serverTransport.onclose = serverCleanup;
      await server.connect(serverTransport);
      
      const mockClientTransport: Transport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };

      const cleanup = await redisRelayToMcpServer(sessionId, mockClientTransport);

      // Send tools/list request
      const toolsListMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'tools-1',
        method: 'tools/list',
        params: {}
      };

      mockClientTransport.onmessage?.(toolsListMessage);

      // Wait for processing and response
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify client received a response with tools
      expect(mockClientTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 'tools-1',
          result: expect.objectContaining({
            tools: expect.any(Array)
          })
        }),
        undefined
      );

      // Cleanup
      await cleanup();
      await shutdownSession(sessionId);
      serverCleanup(); // Clean up MCP server intervals
      
      // Ensure server transport is closed
      await serverTransport.close();
      
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should handle notifications through Redis relay', async () => {
      // Set up server and mock client
      const { server, cleanup: serverCleanup } = createMcpServer();
      const serverTransport = new ServerRedisTransport(sessionId);
      serverTransport.onclose = serverCleanup;
      await server.connect(serverTransport);
      
      const mockClientTransport: Transport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };

      const cleanup = await redisRelayToMcpServer(sessionId, mockClientTransport);

      // Set up notification subscription manually since notifications don't have an id
      const notificationChannel = `mcp:shttp:toclient:${sessionId}:__GET_stream`;
      const notificationCleanup = await mockRedis.createSubscription(notificationChannel, async (redisMessageJson) => {
        const redisMessage = JSON.parse(redisMessageJson);
        if (redisMessage.type === 'mcp') {
          await mockClientTransport.send(redisMessage.message, redisMessage.options);
        }
      }, (error) => {
        mockClientTransport.onerror?.(error);
      });

      // Send a notification from server (notifications don't have an id)
      const notification: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'test',
          data: 'Test notification'
        }
      };

      await serverTransport.send(notification);

      // Wait for notification to be delivered
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify client received the notification
      expect(mockClientTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'notifications/message',
          params: expect.objectContaining({
            level: 'info',
            data: 'Test notification'
          })
        }),
        undefined
      );

      // Cleanup notification subscription
      await notificationCleanup();

      // Cleanup
      await cleanup();
      await shutdownSession(sessionId);
      serverCleanup(); // Clean up MCP server intervals
      
      // Ensure server transport is closed
      await serverTransport.close();
      
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should not create response subscriptions for notifications', async () => {
      const mockClientTransport: Transport = {
        onmessage: undefined,
        onclose: undefined,
        onerror: undefined,
        send: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        start: jest.fn(() => Promise.resolve())
      };

      const cleanup = await redisRelayToMcpServer(sessionId, mockClientTransport);

      // Send a notification (no id field)
      const notification: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      };

      mockClientTransport.onmessage?.(notification);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not create any response channel subscriptions for notifications
      // (we can't easily test this directly, but we can ensure no errors occur)
      expect(mockClientTransport.send).not.toHaveBeenCalled();

      await cleanup();
    });
  });
});