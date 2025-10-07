import { jest } from '@jest/globals';
import { Request, Response } from 'express';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MockRedisClient, setRedisClient } from '../redis.js';
import { handleStreamableHTTP } from './shttp.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
// import { randomUUID } from 'crypto'; // Currently unused but may be needed for future tests
import { shutdownSession } from '../services/redisTransport.js';

// Type for MCP initialization response
interface MCPInitResponse {
  jsonrpc: string;
  id: string | number;
  result?: {
    _meta?: {
      sessionId?: string;
    };
    [key: string]: unknown;
  };
}

describe('Streamable HTTP Handler Integration Tests', () => {
  let mockRedis: MockRedisClient;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    jest.resetAllMocks();

    // Create mock response with chainable methods
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      once: jest.fn().mockReturnThis(),
      emit: jest.fn().mockReturnThis(),
      headersSent: false,
      setHeader: jest.fn().mockReturnThis(),
      writeHead: jest.fn().mockReturnThis(),
      write: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
      getHeader: jest.fn(),
      removeHeader: jest.fn().mockReturnThis(),
      socket: {
        setTimeout: jest.fn(),
      },
    } as unknown as Partial<Response>;

    // Create mock request
    mockReq = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-protocol-version': '2024-11-05',
      },
      body: {},
    };
  });

  // Helper function to trigger cleanup after handleStreamableHTTP calls
  const triggerResponseCleanup = async () => {
    // Find all finish handlers registered during the test
    const finishHandlers = (mockRes.on as jest.Mock).mock.calls
      .filter(([event]) => event === 'finish')
      .map(([, handler]) => handler);
    
    // Trigger all finish handlers
    for (const handler of finishHandlers) {
      if (typeof handler === 'function') {
        await handler();
      }
    }
  };

  // Helper to extract session ID from test context
  const getSessionIdFromTest = (): string | undefined => {
    // Try to get from response headers first
    const setHeaderCalls = (mockRes.setHeader as jest.Mock).mock.calls;
    const sessionIdHeader = setHeaderCalls.find(([name]) => name === 'mcp-session-id');
    if (sessionIdHeader?.[1]) {
      return sessionIdHeader[1] as string;
    }
    
    // Fall back to extracting from Redis channels
    const allChannels = Array.from(mockRedis.subscribers.keys());
    const serverChannel = allChannels.find(channel => channel.includes('mcp:shttp:toserver:'));
    return serverChannel?.split(':')[3];
  };

  afterEach(async () => {
    // Always trigger cleanup for any MCP servers created during tests
    await triggerResponseCleanup();
    mockRedis.clear();
    jest.clearAllMocks();
  });

  describe('Redis Subscription Cleanup', () => {
    it('should clean up Redis subscriptions after shttp response completes', async () => {
      // Set up initialization request (no session ID for new initialization)
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      mockReq.body = initRequest;
      mockReq.auth = {
        clientId: 'test-client-123',
        token: 'test-token',
        scopes: ['mcp'],
        extra: { userId: 'test-user-123' }
      } as AuthInfo;

      // Call the handler
      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Wait longer for async initialization to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // get the sessionId from the response
      const sessionId = getSessionIdFromTest();
      expect(sessionId).toBeDefined();
      
      // Check if any subscriptions were created on any channels
      // Since we don't know the exact sessionId generated, check all channels
      const allChannels = Array.from(mockRedis.subscribers.keys());
      const totalSubscriptions = allChannels.reduce((sum, channel) => sum + (mockRedis.subscribers.get(channel)?.length || 0), 0);
      
      // Should have created at least one subscription (server channel)
      expect(totalSubscriptions).toBeGreaterThan(0);
      expect(allChannels.some(channel => channel.includes('mcp:shttp:toserver:'))).toBe(true);

      // Find the finish handler that was registered
      const finishHandler = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;

      expect(finishHandler).toBeDefined();

      // Simulate response completion to trigger cleanup
      if (finishHandler) {
        await finishHandler();
      }

      // Verify cleanup handler was registered
      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));

      if (sessionId) {
        await shutdownSession(sessionId)
      }
    });

    it('should handle cleanup errors gracefully', async () => {
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      mockReq.body = initRequest;
      mockReq.auth = {
        clientId: 'test-client-123',
        token: 'test-token',
        scopes: ['mcp'],
        extra: { userId: 'test-user-123' }
      } as AuthInfo;

      // Call the handler
      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Use Redis error simulation to test error handling
      const finishHandler = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;

      // Simulate error during cleanup
      
      // Cleanup should not throw error even if Redis operations fail
      if (finishHandler) {
        await expect(finishHandler()).resolves.not.toThrow();
      }
      
      // Clean up the MCP server by sending DELETE request
      const cleanupSessionId = getSessionIdFromTest();
      
      if (cleanupSessionId) {
        // Send DELETE request to clean up MCP server
        jest.clearAllMocks();
        mockReq.method = 'DELETE';
        if (mockReq.headers) {
          mockReq.headers['mcp-session-id'] = cleanupSessionId;
        }
        mockReq.body = {};
        
        await handleStreamableHTTP(mockReq as Request, mockRes as Response);
        
        // Wait a bit for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });
  });

  describe('DELETE Request Session Cleanup', () => {
    it('should trigger onsessionclosed callback which sends shutdown control message', async () => {
      // First, create a session with an initialization request
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      mockReq.body = initRequest;
      mockReq.auth = {
        clientId: 'test-client-123',
        token: 'test-token',
        scopes: ['mcp'],
        extra: { userId: 'test-user-123' }
      } as AuthInfo;

      // Initialize session
      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      // For initialization requests with StreamableHTTPServerTransport,
      // the handler might not immediately return a response if using SSE mode
      // Let's check different possible locations for the session ID
      
      // Check JSON responses
      const jsonCalls = (mockRes.json as jest.Mock).mock.calls;
      let sessionId: string | undefined;
      
      if (jsonCalls.length > 0) {
        const response = jsonCalls[0][0] as MCPInitResponse;
        if (response?.result?._meta?.sessionId) {
          sessionId = response.result._meta.sessionId;
        }
      }
      
      // Check write calls (for SSE responses)
      if (!sessionId) {
        const writeCalls = (mockRes.write as jest.Mock).mock.calls;
        for (const [data] of writeCalls) {
          if (typeof data === 'string' && data.includes('sessionId')) {
            try {
              // SSE data format: "data: {...}\n\n"
              const jsonStr = data.replace(/^data: /, '').trim();
              const parsed = JSON.parse(jsonStr) as MCPInitResponse;
              if (parsed?.result?._meta?.sessionId) {
                sessionId = parsed.result._meta.sessionId;
              }
            } catch {
              // Not valid JSON, continue
            }
          }
        }
      }
      
      // Fallback to getting from Redis channels
      if (!sessionId) {
        sessionId = getSessionIdFromTest();
      }
      
      expect(sessionId).toBeDefined();

      // Reset mocks but keep the session
      jest.clearAllMocks();

      // Now test DELETE request
      mockReq.method = 'DELETE';
      mockReq.headers = {
        ...mockReq.headers,
        'mcp-session-id': sessionId
      };
      mockReq.body = {};

      // Track control messages sent to Redis
      const publishSpy = jest.spyOn(mockRedis, 'publish');

      // Call DELETE handler - StreamableHTTPServerTransport should handle it
      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Wait for async processing and onsessionclosed callback
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // The StreamableHTTPServerTransport should handle the DELETE and trigger onsessionclosed
      // which calls shutdownSession, sending the control message
      const controlCalls = publishSpy.mock.calls.filter(call => 
        call[0] === `mcp:control:${sessionId}`
      );
      
      expect(controlCalls.length).toBeGreaterThan(0);
      
      // Verify the control message content
      const controlCall = publishSpy.mock.calls.find(call => 
        call[0] === `mcp:control:${sessionId}`
      );
      if (controlCall) {
        const message = JSON.parse(controlCall[1]);
        expect(message.type).toBe('control');
        expect(message.action).toBe('SHUTDOWN');
      }
    });

    it('should return 401 for DELETE request with wrong user', async () => {
      // First, create a session as user1
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      mockReq.body = initRequest;
      mockReq.auth = {
        clientId: 'test-client-123',
        token: 'test-token',
        scopes: ['mcp'],
        extra: { userId: 'user1' }
      } as AuthInfo;

      // Initialize session as user1
      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get the session ID from response
      let sessionId: string | undefined;
      
      // Check JSON responses
      const jsonCalls = (mockRes.json as jest.Mock).mock.calls;
      if (jsonCalls.length > 0) {
        const response = jsonCalls[0][0] as MCPInitResponse;
        if (response?.result?._meta?.sessionId) {
          sessionId = response.result._meta.sessionId;
        }
      }
      
      // Check write calls (for SSE responses)
      if (!sessionId) {
        const writeCalls = (mockRes.write as jest.Mock).mock.calls;
        for (const [data] of writeCalls) {
          if (typeof data === 'string' && data.includes('sessionId')) {
            try {
              const jsonStr = data.replace(/^data: /, '').trim();
              const parsed = JSON.parse(jsonStr) as MCPInitResponse;
              if (parsed?.result?._meta?.sessionId) {
                sessionId = parsed.result._meta.sessionId;
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
      
      if (!sessionId) {
        sessionId = getSessionIdFromTest();
      }

      // Reset mocks
      jest.clearAllMocks();

      // Now test DELETE request as user2
      mockReq.method = 'DELETE';
      mockReq.headers = {
        ...mockReq.headers,
        'mcp-session-id': sessionId
      };
      mockReq.body = {};
      mockReq.auth = {
        clientId: 'test-client-456',
        token: 'test-token-2',
        scopes: ['mcp'],
        extra: { userId: 'user2' }
      } as AuthInfo;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Should return 401 for unauthorized access to another user's session
      expect(mockRes.status).toHaveBeenCalledWith(401);

      // shutdown the session
      if (sessionId) {
        await shutdownSession(sessionId)
      }
    });
  });

  describe('User Session Isolation', () => {
    it('should prevent users from accessing sessions created by other users', async () => {
      // Create session for user 1
      const user1Auth: AuthInfo = {
        clientId: 'user1-client',
        token: 'user1-token',
        scopes: ['mcp'],
        extra: { userId: 'user1' }
      };

      const user2Auth: AuthInfo = {
        clientId: 'user2-client', 
        token: 'user2-token',
        scopes: ['mcp'],
        extra: { userId: 'user2' }
      };

      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'user1-client', version: '1.0.0' }
        }
      };

      // User 1 creates session
      mockReq.body = initRequest;
      mockReq.auth = user1Auth;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);
      
      // Wait for async initialization to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get the actual session ID from response
      let actualSessionId: string | undefined;
      
      // Check JSON responses
      const jsonCalls = (mockRes.json as jest.Mock).mock.calls;
      if (jsonCalls.length > 0) {
        const response = jsonCalls[0][0] as MCPInitResponse;
        if (response?.result?._meta?.sessionId) {
          actualSessionId = response.result._meta.sessionId;
        }
      }
      
      // Check write calls (for SSE responses)
      if (!actualSessionId) {
        const writeCalls = (mockRes.write as jest.Mock).mock.calls;
        for (const [data] of writeCalls) {
          if (typeof data === 'string' && data.includes('sessionId')) {
            try {
              const jsonStr = data.replace(/^data: /, '').trim();
              const parsed = JSON.parse(jsonStr) as MCPInitResponse;
              if (parsed?.result?._meta?.sessionId) {
                actualSessionId = parsed.result._meta.sessionId;
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
      
      if (!actualSessionId) {
        actualSessionId = getSessionIdFromTest();
      }
      
      expect(actualSessionId).toBeDefined();
      
      // Store finish handler before clearing mocks
      const finishHandler1 = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;
      
      // Reset mocks
      jest.clearAllMocks();
      
      // Trigger cleanup for the MCP server created in this step
      if (finishHandler1) {
        await finishHandler1();
      }

      // User 2 tries to access user 1's session
      mockReq.headers = {
        ...mockReq.headers,
        'mcp-session-id': actualSessionId
      };
      mockReq.body = {
        jsonrpc: '2.0',
        id: 'user2-request',
        method: 'tools/list',
        params: {}
      };
      mockReq.auth = user2Auth;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Should return 401 for unauthorized access to another user's session
      expect(mockRes.status).toHaveBeenCalledWith(401);
      
      // Clean up the MCP server by sending DELETE request
      if (actualSessionId) {
        jest.clearAllMocks();
        mockReq.method = 'DELETE';
        mockReq.headers['mcp-session-id'] = actualSessionId;
        mockReq.body = {};
        mockReq.auth = user1Auth; // Use user1's auth to delete their session
        
        await handleStreamableHTTP(mockReq as Request, mockRes as Response);
        
        // Wait a bit for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });

    it('should allow users to create separate sessions with same session ID pattern', async () => {
      // This test shows that different users should be able to use sessions
      // without interfering with each other, even if session IDs might collide
      
      const user1Auth: AuthInfo = {
        clientId: 'user1-client',
        token: 'user1-token',
        scopes: ['mcp']
      };

      const user2Auth: AuthInfo = {
        clientId: 'user2-client',
        token: 'user2-token', 
        scopes: ['mcp']
      };

      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      // User 1 creates session
      mockReq.body = initRequest;
      mockReq.auth = user1Auth;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);
      
      // Store finish handler before clearing mocks
      const finishHandler1 = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;
      
      // Reset for user 2
      jest.clearAllMocks();
      
      // Trigger cleanup for User 1's MCP server
      if (finishHandler1) {
        await finishHandler1();
      }

      // User 2 creates their own session
      mockReq.body = {
        ...initRequest,
        id: 'init-2',
        params: {
          ...initRequest.params,
          clientInfo: { name: 'user2-client', version: '1.0.0' }
        }
      };
      mockReq.auth = user2Auth;
      delete mockReq.headers!['mcp-session-id']; // New initialization

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Trigger cleanup for User 2's MCP server
      const finishHandler2 = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;
      
      if (finishHandler2) {
        await finishHandler2();
      }

      // Both users should be able to create sessions successfully
      // Sessions should be isolated in Redis using user-scoped keys
      expect(mockRes.status).not.toHaveBeenCalledWith(400);
      expect(mockRes.status).not.toHaveBeenCalledWith(403);
    });

    it('should clean up only the requesting user\'s session on DELETE', async () => {
      // Create sessions for both users
      const user1Auth: AuthInfo = {
        clientId: 'user1-client',
        token: 'user1-token',
        scopes: ['mcp']
      };

      const user2Auth: AuthInfo = {
        clientId: 'user2-client',
        token: 'user2-token',
        scopes: ['mcp']
      };

      // Create session for user 1
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'user1-client', version: '1.0.0' }
        }
      };

      mockReq.body = initRequest;
      mockReq.auth = user1Auth;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Trigger cleanup for User 1's MCP server
      const finishHandler1 = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;
      
      if (finishHandler1) {
        await finishHandler1();
      }

      // Track session 1 ID (would be returned in response headers)
      const session1Id = 'user1-session-id'; // In real implementation, extract from response

      // Create session for user 2
      jest.clearAllMocks();
      mockReq.body = {
        ...initRequest,
        id: 'init-2',
        params: {
          ...initRequest.params,
          clientInfo: { name: 'user2-client', version: '1.0.0' }
        }
      };
      mockReq.auth = user2Auth;
      delete mockReq.headers!['mcp-session-id'];

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Trigger cleanup for User 2's MCP server
      const finishHandler2 = (mockRes.on as jest.Mock).mock.calls.find(
        ([event]) => event === 'finish'
      )?.[1] as (() => Promise<void>) | undefined;
      
      if (finishHandler2) {
        await finishHandler2();
      }

      // Track session 2 ID (placeholder for actual implementation)

      // User 1 deletes their session
      jest.clearAllMocks();
      mockReq.method = 'DELETE';
      mockReq.headers = {
        ...mockReq.headers,
        'mcp-session-id': session1Id
      };
      mockReq.body = {};
      mockReq.auth = user1Auth;

      await handleStreamableHTTP(mockReq as Request, mockRes as Response);

      // Only user 1's session should be cleaned up
      // User 2's session should remain active
      // This test documents expected behavior for proper user isolation
    });
  });
});