# User ID System Documentation

## Overview

The MCP server implements a comprehensive user identification and session ownership system that ensures secure multi-user access to MCP resources. This system integrates localStorage-based user management, OAuth authentication flows, and Redis-backed session isolation.

## Architecture Components

### 1. User ID Management (localStorage)
### 2. OAuth Authorization Flow
### 3. Redis Session Ownership
### 4. Session Access Validation

---

## 1. User ID Management (localStorage)

The fake upstream authentication system uses browser localStorage to manage user identities for testing and development purposes.

### localStorage Schema

```typescript
// Stored in browser localStorage
{
  "mcpUserId": "550e8400-e29b-41d4-a716-446655440000" // UUID v4
}
```

### User ID Generation Flow

```mermaid
sequenceDiagram
    participant Browser
    participant LocalStorage
    participant AuthPage as Fake Auth Page
    
    Browser->>AuthPage: Load /fakeupstreamauth/authorize
    AuthPage->>LocalStorage: Check mcpUserId
    
    alt User ID exists
        LocalStorage-->>AuthPage: Return existing UUID
        AuthPage->>Browser: Display existing ID
    else User ID missing
        AuthPage->>AuthPage: Generate new UUID v4
        AuthPage->>LocalStorage: Store new mcpUserId
        AuthPage->>Browser: Display new ID
    end
    
    Note over AuthPage: User can edit or regenerate ID
    AuthPage->>LocalStorage: Update mcpUserId (if changed)
```

### User ID Operations

| Operation | Description | Implementation |
|-----------|-------------|----------------|
| **Generate** | Create new UUID v4 | `generateUUID()` function |
| **Retrieve** | Get existing or create new | `getUserId()` function |
| **Update** | Edit existing ID | `editUserId()` function |
| **Persist** | Store in localStorage | `localStorage.setItem('mcpUserId', userId)` |

---

## 2. OAuth Authorization Flow

The OAuth flow integrates user IDs from localStorage into the MCP authorization process.

### Complete OAuth Flow with User ID

```mermaid
sequenceDiagram
    participant Client
    participant MCPServer as MCP Server
    participant AuthPage as Auth Page
    participant FakeAuth as Fake Upstream Auth
    participant LocalStorage
    participant Redis
    
    Client->>MCPServer: Request authorization
    MCPServer->>AuthPage: Redirect to auth page
    AuthPage->>Client: Show MCP authorization page
    Client->>FakeAuth: Click "Continue to Authentication"
    
    FakeAuth->>LocalStorage: Get/Create userId
    LocalStorage-->>FakeAuth: Return userId
    FakeAuth->>Client: Show userId management UI
    
    Client->>FakeAuth: Complete authentication
    FakeAuth->>MCPServer: Redirect with code + userId
    MCPServer->>Redis: Store userId in McpInstallation
    MCPServer->>Client: Return access token
    
    Note over Redis: McpInstallation.userId = userId
```

### OAuth Data Flow

```mermaid
graph TD
    A[Browser localStorage] -->|userId| B[Fake Auth Page]
    B -->|userId in query params| C[Authorization Callback]
    C -->|userId| D[McpInstallation Object]
    D -->|access_token| E[Redis Storage]
    E -->|AuthInfo.extra.userId| F[Session Ownership]
```

### Authorization Code Exchange

The userId is embedded in the authorization flow:

```javascript
// In fake auth page
function authorize() {
  const userId = getUserId(); // From localStorage
  const url = new URL(redirectUri);
  url.searchParams.set('userId', userId);
  url.searchParams.set('code', 'fakecode');
  window.location.href = url.toString();
}
```

---

## 3. Redis Session Ownership

Redis stores session ownership information using a structured key system.

### Redis Key Structure

#### MCP Session Keys (MCP Server)
```
session:{sessionId}:owner → userId                    # Session ownership
mcp:shttp:toserver:{sessionId} → [pub/sub channel]   # Client→Server messages (also indicates liveness)
mcp:shttp:toclient:{sessionId}:{requestId} → [pub/sub channel] # Server→Client responses
mcp:control:{sessionId}   → [pub/sub channel]        # Control messages
```

#### Auth Keys (Auth Server)
```
auth:client:{clientId} → client registration          # OAuth client registrations
auth:pending:{authCode} → pending authorization       # Pending auth (10 min TTL)
auth:installation:{accessToken} → MCP installation    # Active sessions (7 days TTL)
auth:exch:{authCode} → token exchange                 # Token exchange (10 min TTL)
auth:refresh:{refreshToken} → access token            # Refresh tokens (7 days TTL)
```

Note: The `auth:` prefix ensures complete isolation from MCP session keys, allowing both integrated and separate modes to work consistently.

### Redis Operations

| Operation | Key Pattern | Value | Purpose |
|-----------|-------------|--------|---------|
| **Set Owner** | `session:{sessionId}:owner` | `userId` | Store session owner |
| **Get Owner** | `session:{sessionId}:owner` | `userId` | Retrieve session owner |
| **Check Live** | `mcp:shttp:toserver:{sessionId}` | `numsub > 0` | Check if session active via pub/sub subscribers |

### Session Liveness Mechanism

Session liveness is determined by **pub/sub subscription count** rather than explicit keys:

```mermaid
graph TD
    A[MCP Server Starts] --> B[Subscribe to mcp:shttp:toserver:sessionId]
    B --> C[numsub = 1 → Session is LIVE]
    C --> D[Session Processing]
    D --> E[MCP Server Shutdown]
    E --> F[Unsubscribe from channel]
    F --> G[numsub = 0 → Session is DEAD]
    
    H[isLive() function] --> I[Check numsub count]
    I --> J{numsub > 0?}
    J -->|Yes| K[Session is Live]
    J -->|No| L[Session is Dead]
```

**Why this works:**
- When an MCP server starts, it subscribes to `mcp:shttp:toserver:{sessionId}`
- When it shuts down (gracefully or crashes), Redis automatically removes the subscription
- `numsub` reflects the actual state without requiring explicit cleanup

### Session Ownership Functions

```typescript
// Core ownership functions
export async function setSessionOwner(sessionId: string, userId: string): Promise<void>
export async function getSessionOwner(sessionId: string): Promise<string | null>
export async function validateSessionOwnership(sessionId: string, userId: string): Promise<boolean>
export async function isSessionOwnedBy(sessionId: string, userId: string): Promise<boolean>
export async function isLive(sessionId: string): Promise<boolean> // Uses numsub count
```

---

## 4. Session Access Validation

Session access is validated at multiple points in the request lifecycle.

### Session Validation Flow

```mermaid
sequenceDiagram
    participant Client
    participant Handler as shttp Handler
    participant Auth as Auth Middleware
    participant Redis
    
    Client->>Handler: MCP Request with session-id
    Handler->>Auth: Extract userId from token
    Auth-->>Handler: Return userId
    
    alt New Session (Initialize)
        Handler->>Handler: Generate new sessionId
        Handler->>Redis: setSessionOwner(sessionId, userId)
        Handler->>Handler: Start MCP server (subscribes to channel)
        Note over Handler: Session becomes "live" via pub/sub subscription
        Handler->>Client: Return with new session
    else Existing Session
        Handler->>Redis: isSessionOwnedBy(sessionId, userId)
        Redis-->>Handler: Return ownership status
        
        alt Session Owned by User
            Handler->>Client: Process request
        else Session Not Owned
            Handler->>Client: 400 Bad Request
        end
    end
```

### DELETE Request Validation

```mermaid
sequenceDiagram
    participant Client
    participant Handler as shttp Handler
    participant Redis
    
    Client->>Handler: DELETE /mcp (session-id: xyz)
    Handler->>Handler: Extract userId from auth
    Handler->>Redis: isSessionOwnedBy(sessionId, userId)
    
    alt Session Owned by User
        Redis-->>Handler: true
        Handler->>Redis: shutdownSession(sessionId)
        Handler->>Client: 200 OK (Session terminated)
    else Session Not Owned
        Redis-->>Handler: false
        Handler->>Client: 404 Not Found (Session not found or access denied)
    end
```

### Request Authorization Matrix

| Request Type | Session ID | User ID | Authorization Check |
|-------------|-----------|---------|-------------------|
| **Initialize** | None | Required | Create new session |
| **Existing Session** | Required | Required | `isSessionOwnedBy()` |
| **DELETE Session** | Required | Required | `isSessionOwnedBy()` |

---

## 5. Security Model

### Multi-User Isolation

```mermaid
graph TB
    subgraph "User A"
        A1[localStorage: userA-id]
        A2[Session: session-A]
        A3[Redis: session:A:owner → userA]
    end
    
    subgraph "User B"
        B1[localStorage: userB-id]
        B2[Session: session-B]
        B3[Redis: session:B:owner → userB]
    end
    
    subgraph "Redis Isolation"
        R1[session:A:owner → userA-id]
        R2[session:B:owner → userB-id]
        R3[Ownership Validation]
    end
    
    A3 --> R1
    B3 --> R2
    R1 --> R3
    R2 --> R3
```

### Security Guarantees

1. **Session Isolation**: Users can only access sessions they own
2. **Identity Verification**: User ID is validated from authenticated token
3. **Ownership Persistence**: Session ownership is stored in Redis
4. **Access Control**: All session operations validate ownership
5. **Secure Cleanup**: DELETE operations verify ownership before termination

### Attack Prevention

| Attack Vector | Prevention | Implementation |
|---------------|------------|----------------|
| **Session Hijacking** | Ownership validation | `isSessionOwnedBy()` check |
| **Cross-User Access** | User ID verification | Extract userId from AuthInfo |
| **Session Spoofing** | Token validation | Bearer token middleware |
| **Unauthorized DELETE** | Ownership check | Validate before shutdown |

---

## 6. Implementation Details

### Error Handling

```typescript
// Session access errors
if (!userId) {
  return 401; // Unauthorized: User ID required
}

if (!await isSessionOwnedBy(sessionId, userId)) {
  return 400; // Bad Request: Session access denied
}
```

### Testing Strategy

The system includes comprehensive tests for:

- **User session isolation**: Users cannot access other users' sessions
- **DELETE request validation**: Only owners can delete sessions
- **Redis cleanup**: Proper cleanup of ownership data
- **Auth flow integration**: User ID propagation through OAuth

### Performance Considerations

1. **Redis Efficiency**: O(1) lookups for session ownership
2. **Session Reuse**: Existing sessions are reused when ownership matches
3. **Cleanup**: Automatic cleanup prevents resource leaks
4. **Caching**: Session ownership is cached in Redis

---

## 7. Configuration

### Environment Variables

```bash
# Redis configuration for session storage
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Base URI for OAuth redirects
BASE_URI=http://localhost:3000
```

### Development Testing

```bash
# Run multi-user tests
npm test -- --testNamePattern="User Session Isolation"

# Test session ownership
npm test -- --testNamePattern="session ownership"

# Full integration test
npm test
```

---

## 8. Monitoring and Debugging

### Redis Key Monitoring

```bash
# Monitor session ownership keys
redis-cli KEYS "session:*:owner"

# Watch session ownership operations
redis-cli MONITOR | grep "session:"

# Check active (live) sessions via pub/sub
redis-cli PUBSUB CHANNELS "mcp:shttp:toserver:*"
redis-cli PUBSUB NUMSUB "mcp:shttp:toserver:*"
```

### Debugging Commands

```bash
# Check session ownership
redis-cli GET "session:550e8400-e29b-41d4-a716-446655440000:owner"

# List all session owners
redis-cli KEYS "session:*:owner"

# Check if specific session is live
redis-cli PUBSUB NUMSUB "mcp:shttp:toserver:550e8400-e29b-41d4-a716-446655440000"

# Monitor pub/sub activity
redis-cli MONITOR
```

This system provides robust multi-user session management with strong security guarantees and comprehensive testing coverage.