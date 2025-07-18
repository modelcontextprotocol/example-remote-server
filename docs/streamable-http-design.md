# Design Document: Implementing Streamable HTTP Transport for Example Remote Server

## Research Summary

### Current SSE Transport Architecture

The example remote server currently uses the following architecture:

1. **SSE Endpoint**: `/sse` - Creates SSE connection using `SSEServerTransport`
2. **Message Endpoint**: `/message` - Receives POST requests and forwards them via Redis
3. **Redis Integration**: Messages are published/subscribed through Redis channels using session IDs
4. **Auth**: Uses `requireBearerAuth` middleware with `EverythingAuthProvider`
5. **Session Management**: Each SSE connection gets a unique session ID used as Redis channel key

**Key Files:**
- `/src/index.ts:91` - SSE endpoint with auth and headers
- `/src/handlers/mcp.ts:55-118` - SSE connection handler with Redis integration
- `/src/handlers/mcp.ts:120-144` - Message POST handler

### Streamable HTTP Transport Specification (2025-03-26)

The new Streamable HTTP transport replaces the old HTTP+SSE approach with a single endpoint that supports:

1. **Single Endpoint**: One URL that handles GET, POST, and DELETE methods
2. **POST Requests**: Send JSON-RPC messages, can return either JSON responses or SSE streams
3. **GET Requests**: Open SSE streams for server-to-client messages  
4. **Session Management**: Optional session IDs in `Mcp-Session-Id` headers
5. **Resumability**: Optional event storage with `Last-Event-ID` support
6. **Auth Integration**: Same authentication patterns as SSE

**Key Specification Requirements:**
- Accept header must include both `application/json` and `text/event-stream`
- Session ID management via `Mcp-Session-Id` headers
- 202 Accepted for notifications/responses only
- SSE streams or JSON responses for requests
- Security: Origin validation, localhost binding, proper auth

### TypeScript SDK Implementation

The SDK provides `StreamableHTTPServerTransport` with:

1. **Two Modes**:
   - **Stateful**: Session ID generator provided, maintains sessions in memory
   - **Stateless**: Session ID generator undefined, no session state

2. **Key Features**:
   - Built-in session validation
   - Event store support for resumability  
   - Automatic response correlation
   - Auth info threading via `req.auth`

3. **Integration Patterns**:
   - **Stateful**: Store transports by session ID, reuse across requests
   - **Stateless**: New transport per request, immediate cleanup
   - **Auth**: Same bearer auth middleware as SSE

## Implementation Plan

### 1. New Streamable HTTP Endpoint

Add `/mcp` endpoint that handles GET, POST, DELETE methods:

```typescript
// In src/index.ts
app.get("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);  
app.post("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
app.delete("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
```

### 2. Handler Implementation

Create new handler in `/src/handlers/mcp.ts`:

```typescript
export async function handleStreamableHTTP(req: Request, res: Response) {
  // Use same Redis-based architecture as SSE transport
  // but with StreamableHTTPServerTransport instead of SSEServerTransport
}
```

### 3. Transport Integration Strategy (Horizontally Scalable)

**Redis-based Session Management (Required for Horizontal Scaling)**
- Store session state in Redis, not in-memory
- Any server instance can handle any request for any session
- Session lifecycle independent of SSE connection lifecycle
- Message buffering in Redis when SSE connection is down
- Session TTL of 5 minutes to prevent Redis bloat

### 4. Redis Integration

Maintain current Redis architecture:
- Use session ID as Redis channel key
- Same message publishing/subscribing pattern
- Same MCP server creation logic
- Transport acts as bridge to Redis like current SSE implementation

### 5. Auth Integration

Use identical auth setup as SSE:
- Same `bearerAuth` middleware
- Same `authContext` middleware  
- Same `EverythingAuthProvider`
- Auth info flows through `req.auth` to transport

### 6. Backwards Compatibility

Keep existing `/sse` and `/message` endpoints:
- Maintain current SSE transport for existing clients
- Add new `/mcp` endpoint alongside
- Both transports share same Redis infrastructure
- Same auth provider serves both

## Key Differences from Current SSE Implementation

1. **Single Endpoint**: `/mcp` handles all HTTP methods vs separate `/sse` + `/message`
2. **Transport Class**: `StreamableHTTPServerTransport` vs `SSEServerTransport`  
3. **Session Headers**: `Mcp-Session-Id` headers vs URL session ID
4. **Request Handling**: Transport handles HTTP details vs manual SSE headers
5. **Response Correlation**: Built into transport vs manual request tracking

## Benefits of This Approach

1. **Spec Compliance**: Follows 2025-03-26 MCP specification exactly
2. **Minimal Changes**: Reuses existing Redis infrastructure and auth
3. **Feature Parity**: Same functionality as current SSE transport
4. **Future Proof**: Can add resumability with event store later
5. **Clean Integration**: Same auth patterns and middleware stack

## Implementation Steps

1. **Add Dependencies**: `StreamableHTTPServerTransport` from SDK
2. **Create Redis Session Management**: Implement `SessionManager` and `MessageDelivery` classes
3. **Create Handler**: New streamable HTTP handler function with Redis integration
4. **Add Routes**: New `/mcp` endpoint with all HTTP methods
5. **Session Management**: Redis-based session storage with TTL
6. **Message Buffering**: Redis-based message buffering for disconnected clients
7. **Testing**: Verify auth, Redis integration, horizontal scaling, and MCP protocol compliance
8. **Documentation**: Update README with new endpoint usage

### Additional Implementation Considerations

- **Redis Connection Management**: Ensure Redis connections are properly pooled and cleaned up
- **Error Handling**: Robust error handling for Redis operations and session timeouts
- **Monitoring**: Add logging for session creation, cleanup, and message buffering metrics
- **Performance**: Consider Redis memory usage and implement appropriate limits on message buffer size
- **Security**: Ensure session IDs are cryptographically secure and validate all session operations

## Technical Details

### Session Management Architecture (Redis-based)

**Redis Data Structures for Horizontal Scaling:**

```typescript
// Redis keys for session management
const SESSION_METADATA_KEY = (sessionId: string) => `session:${sessionId}:metadata`;
const SESSION_MESSAGES_KEY = (sessionId: string) => `session:${sessionId}:messages`;
const SESSION_CONNECTION_KEY = (sessionId: string) => `session:${sessionId}:connection`;

// Session metadata structure
interface SessionMetadata {
  sessionId: string;
  clientId: string;
  createdAt: number;
  lastActivity: number;
}

// Session lifecycle management
class SessionManager {
  private static SESSION_TTL = 5 * 60; // 5 minutes in seconds
  
  static async createSession(sessionId: string, clientId: string): Promise<void> {
    const metadata: SessionMetadata = {
      sessionId,
      clientId,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    
    // Store session metadata with TTL
    await redisClient.set(
      SESSION_METADATA_KEY(sessionId), 
      JSON.stringify(metadata),
      { EX: this.SESSION_TTL }
    );
    
    // Initialize empty message buffer
    await redisClient.del(SESSION_MESSAGES_KEY(sessionId));
    
    // Mark connection as disconnected initially
    await redisClient.set(SESSION_CONNECTION_KEY(sessionId), 'disconnected', { EX: this.SESSION_TTL });
  }
  
  static async refreshSession(sessionId: string): Promise<boolean> {
    const metadata = await this.getSessionMetadata(sessionId);
    if (!metadata) return false;
    
    // Update last activity and refresh TTL
    metadata.lastActivity = Date.now();
    await redisClient.set(
      SESSION_METADATA_KEY(sessionId), 
      JSON.stringify(metadata),
      { EX: this.SESSION_TTL }
    );
    
    // Refresh other keys too
    await redisClient.expire(SESSION_MESSAGES_KEY(sessionId), this.SESSION_TTL);
    await redisClient.expire(SESSION_CONNECTION_KEY(sessionId), this.SESSION_TTL);
    
    return true;
  }
  
  static async deleteSession(sessionId: string): Promise<void> {
    await redisClient.del(SESSION_METADATA_KEY(sessionId));
    await redisClient.del(SESSION_MESSAGES_KEY(sessionId));
    await redisClient.del(SESSION_CONNECTION_KEY(sessionId));
  }
  
  static async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const data = await redisClient.get(SESSION_METADATA_KEY(sessionId));
    return data ? JSON.parse(data) : null;
  }
  
  // Mark SSE connection as connected/disconnected
  static async setConnectionState(sessionId: string, connected: boolean): Promise<void> {
    await redisClient.set(
      SESSION_CONNECTION_KEY(sessionId), 
      connected ? 'connected' : 'disconnected',
      { EX: this.SESSION_TTL }
    );
  }
  
  static async isConnected(sessionId: string): Promise<boolean> {
    const state = await redisClient.get(SESSION_CONNECTION_KEY(sessionId));
    return state === 'connected';
  }
}
```

### Redis Integration Pattern with Message Buffering

The implementation extends the current Redis pattern to support message buffering:

```typescript
// Message delivery with buffering support
class MessageDelivery {
  static async deliverMessage(sessionId: string, message: JSONRPCMessage): Promise<void> {
    const isConnected = await SessionManager.isConnected(sessionId);
    
    if (isConnected) {
      // Direct delivery via existing Redis pub/sub
      const redisChannel = `mcp:${sessionId}`;
      await redisClient.publish(redisChannel, JSON.stringify(message));
    } else {
      // Buffer the message for later delivery
      await redisClient.lpush(
        SESSION_MESSAGES_KEY(sessionId), 
        JSON.stringify(message)
      );
      // Set TTL on the messages list
      await redisClient.expire(SESSION_MESSAGES_KEY(sessionId), SessionManager.SESSION_TTL);
    }
  }
  
  static async deliverBufferedMessages(sessionId: string, transport: StreamableHTTPServerTransport): Promise<void> {
    // Get all buffered messages
    const bufferedMessages = await redisClient.lrange(SESSION_MESSAGES_KEY(sessionId), 0, -1);
    
    // Deliver buffered messages in order (reverse because lpush)
    for (let i = bufferedMessages.length - 1; i >= 0; i--) {
      const message = JSON.parse(bufferedMessages[i]);
      await transport.send(message);
    }
    
    // Clear the buffer after delivery
    await redisClient.del(SESSION_MESSAGES_KEY(sessionId));
  }
}

// Enhanced Redis subscription for SSE connections
const setupRedisSubscription = async (sessionId: string, transport: StreamableHTTPServerTransport) => {
  const redisChannel = `mcp:${sessionId}`;
  
  const redisCleanup = await redisClient.createSubscription(
    redisChannel,
    async (message) => {
      const jsonMessage = JSON.parse(message);
      try {
        await transport.send(jsonMessage);
      } catch (error) {
        console.error(`Failed to send message on transport for session ${sessionId}:`, error);
        // Mark connection as disconnected so future messages get buffered
        await SessionManager.setConnectionState(sessionId, false);
      }
    },
    async (error) => {
      console.error('Redis subscription error:', error);
      await SessionManager.setConnectionState(sessionId, false);
    }
  );
  
  return redisCleanup;
};
```

### Handler Implementation Flow

The new streamable HTTP handler integrates with the Redis-based session management:

```typescript
export async function handleStreamableHTTP(req: Request, res: Response) {
  const method = req.method;
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  
  if (method === 'POST') {
    // Handle POST requests (initialization or message sending)
    
    if (isInitializeRequest(req.body) && !sessionId) {
      // New session initialization
      const newSessionId = randomUUID();
      const authInfo = req.auth;
      
      // Create session in Redis
      await SessionManager.createSession(newSessionId, authInfo?.clientId || 'unknown');
      
      // Create transport with Redis-based session management
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        // Custom implementation - don't store transport in memory
      });
      
      const { server: mcpServer, cleanup: mcpCleanup } = createMcpServer();
      
      // Set up Redis subscription for this session but don't store transport globally
      // Instead, rely on Redis for all message routing
      
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      
    } else if (sessionId) {
      // Existing session - validate and handle request
      const sessionValid = await SessionManager.refreshSession(sessionId);
      if (!sessionValid) {
        res.writeHead(404).end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null
        }));
        return;
      }
      
      // Create ephemeral transport for this request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId, // Use existing session ID
      });
      
      const { server: mcpServer, cleanup: mcpCleanup } = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      
      // Clean up after request completes
      res.on('close', mcpCleanup);
    }
    
  } else if (method === 'GET') {
    // Handle SSE stream requests
    
    if (!sessionId) {
      res.writeHead(400).end('Session ID required');
      return;
    }
    
    const sessionValid = await SessionManager.refreshSession(sessionId);
    if (!sessionValid) {
      res.writeHead(404).end('Session not found');
      return;
    }
    
    // Create transport for SSE stream
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    
    // Mark connection as active
    await SessionManager.setConnectionState(sessionId, true);
    
    // Deliver any buffered messages first
    await MessageDelivery.deliverBufferedMessages(sessionId, transport);
    
    // Set up Redis subscription for live messages
    const redisCleanup = await setupRedisSubscription(sessionId, transport);
    
    // Handle connection cleanup
    res.on('close', async () => {
      await SessionManager.setConnectionState(sessionId, false);
      redisCleanup();
    });
    
    await transport.handleRequest(req, res);
    
  } else if (method === 'DELETE') {
    // Handle session deletion
    
    if (!sessionId) {
      res.writeHead(400).end('Session ID required');
      return;
    }
    
    // Delete session from Redis
    await SessionManager.deleteSession(sessionId);
    res.writeHead(200).end();
  }
}
```

### Auth Information Flow

Auth information flows through the middleware stack:

```typescript
// Auth middleware adds req.auth
const authInfo: AuthInfo = req.auth;

// Transport receives auth info
await transport.handleRequest(req, res);

// Auth info is available in MCP server handlers
server.tool('example', 'description', schema, async (params, { authInfo }) => {
  // authInfo contains token, clientId, scopes, etc.
});
```

## Conclusion

This design provides horizontally scalable streamable HTTP support by using Redis for all session state management and message buffering. Key advantages:

1. **Horizontal Scalability**: Any server instance can handle any request for any session
2. **Resilient Connection Handling**: SSE disconnects don't end sessions; messages are buffered
3. **Automatic Cleanup**: 5-minute session TTL prevents Redis bloat
4. **Backwards Compatibility**: Existing `/sse` and `/message` endpoints remain unchanged
5. **Spec Compliance**: Follows 2025-03-26 MCP specification exactly

The implementation is more complex than a single-instance approach but essential for production deployment in a horizontally scaled environment. The Redis-based architecture ensures sessions persist across server instances and SSE connection interruptions.