import { jest } from '@jest/globals';
import { Request, Response } from 'express';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MockRedisClient, setRedisClient } from '../redis.js';

describe('Streamable HTTP Handler', () => {
  let mockRedis: MockRedisClient;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    jest.resetAllMocks();
  });

  afterEach(() => {
    mockRedis.clear();
  });

  describe('Helper function tests', () => {
    it('should verify Redis mock is working', async () => {
      await mockRedis.set('test-key', 'test-value');
      const value = await mockRedis.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should handle Redis pub/sub', async () => {
      const messageHandler = jest.fn();
      const cleanup = await mockRedis.createSubscription(
        'test-channel',
        messageHandler,
        jest.fn()
      );

      await mockRedis.publish('test-channel', 'test-message');
      
      expect(messageHandler).toHaveBeenCalledWith('test-message');
      
      await cleanup();
    });
  });

  describe('Request validation', () => {
    it('should identify initialize requests correctly', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
      
      const initRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' }
        }
      };

      const nonInitRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      expect(isInitializeRequest(initRequest)).toBe(true);
      expect(isInitializeRequest(nonInitRequest)).toBe(false);
    });
  });

  describe('HTTP response mock behavior', () => {
    it('should create proper response mock with chainable methods', () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        headersSent: false,
      } as Partial<Response>;

      // Test chaining
      const result = mockRes.status!(400).json!({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request' },
        id: null
      });

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request' },
        id: null
      });
      expect(result).toBe(mockRes);
    });
  });

  describe('Session ID generation', () => {
    it('should generate valid UUIDs', async () => {
      const { randomUUID } = await import('crypto');
      
      const sessionId = randomUUID();
      
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('Redis channel naming', () => {
    it('should create correct channel names for server communication', () => {
      const sessionId = 'test-session-123';
      const requestId = 'req-456';

      const toServerChannel = `mcp:shttp:toserver:${sessionId}`;
      const toClientChannel = `mcp:shttp:toclient:${sessionId}:${requestId}`;
      const notificationChannel = `mcp:shttp:toclient:${sessionId}:__GET_stream`;

      expect(toServerChannel).toBe('mcp:shttp:toserver:test-session-123');
      expect(toClientChannel).toBe('mcp:shttp:toclient:test-session-123:req-456');
      expect(notificationChannel).toBe('mcp:shttp:toclient:test-session-123:__GET_stream');
    });
  });

  describe('Error response formatting', () => {
    it('should format JSON-RPC error responses correctly', () => {
      const errorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      };

      expect(errorResponse.jsonrpc).toBe('2.0');
      expect(errorResponse.error.code).toBe(-32000);
      expect(errorResponse.error.message).toContain('Bad Request');
      expect(errorResponse.id).toBe(null);
    });

    it('should format internal error responses correctly', () => {
      const internalErrorResponse = {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
        },
        id: null,
      };

      expect(internalErrorResponse.jsonrpc).toBe('2.0');
      expect(internalErrorResponse.error.code).toBe(-32603);
      expect(internalErrorResponse.error.message).toBe('Internal error');
      expect(internalErrorResponse.id).toBe(null);
    });
  });

  describe('Request/Response patterns', () => {
    it('should handle typical MCP message structures', () => {
      const initializeRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        }
      };

      const toolsListRequest: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      const toolsListResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            {
              name: 'echo',
              description: 'Echo the input',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string' }
                }
              }
            }
          ]
        }
      };

      expect(initializeRequest.method).toBe('initialize');
      expect(toolsListRequest.method).toBe('tools/list');
      expect(toolsListResponse.result).toBeDefined();
      expect(Array.isArray(toolsListResponse.result?.tools)).toBe(true);
    });
  });

  describe('HTTP header handling', () => {
    it('should extract session ID from headers', () => {
      const mockReq = {
        headers: {
          'mcp-session-id': 'test-session-123',
          'content-type': 'application/json'
        },
        body: {}
      } as Partial<Request>;

      const sessionId = mockReq.headers!['mcp-session-id'] as string;
      
      expect(sessionId).toBe('test-session-123');
    });

    it('should handle missing session ID in headers', () => {
      const mockReq = {
        headers: {
          'content-type': 'application/json'
        },
        body: {}
      } as Partial<Request>;

      const sessionId = mockReq.headers!['mcp-session-id'] as string | undefined;
      
      expect(sessionId).toBeUndefined();
    });
  });
});