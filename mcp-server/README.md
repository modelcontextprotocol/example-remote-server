# MCP Server - Resource Server with External OAuth

MCP resource server demonstrating token validation with external OAuth providers.

## Purpose

This server shows how to build an MCP server that delegates all OAuth operations to external providers:
- No OAuth authorization code in the MCP server
- Token validation via introspection API (RFC 7662)
- Focus on serving MCP resources
- Authentication handled by external provider (Auth0, Okta, etc.)

## Quick Start

```bash
# This server requires the auth server to be running!

# Option 1: Start both servers from repo root
cd .. && npm run dev

# Option 2: Start servers individually
# Terminal 1:
cd ../auth-server && npm run dev

# Terminal 2:
cd ../mcp-server && npm run dev

# Server starts on http://localhost:3232
```

## Architecture

This server:
1. Advertises the external OAuth server in its metadata
2. Receives MCP requests with Bearer tokens
3. Validates tokens via the OAuth server's `/introspect` endpoint
4. Serves MCP resources after token validation
5. Manages MCP sessions tied to validated users

The server does not issue tokens or handle user authentication.

## Key Components

### `src/index.ts`
Main entry point. Notable aspects for external auth:
- **No OAuth endpoints** (handled by auth server)
- Uses `ExternalAuthVerifier` to validate tokens
- Fetches auth metadata from external server on startup
- Serves MCP endpoints only

### `src/auth/external-verifier.ts`
**ExternalAuthVerifier** - Validates tokens with external auth server:
```typescript
async verifyAccessToken(token: string): Promise<AuthInfo> {
  // Calls POST /introspect on auth server
  // Validates token is active and intended for this MCP server
  // Returns user info and scopes
}
```

### `src/services/mcp.ts`
MCP server implementation with all features:
- 7 demonstration tools
- 100 paginated resources
- 3 prompts with argument support
- Sampling, completions, logging

### `src/services/redisTransport.ts`
Redis-backed transport enabling:
- Horizontal scaling
- Session state management
- Message routing across instances

## MCP Endpoints

```bash
# Streamable HTTP (recommended)
GET/POST/DELETE /mcp

# SSE (legacy)
GET /sse
POST /message
```

All endpoints require `Authorization: Bearer <token>` header.

## Configuration

Environment variables in `.env`:
```bash
BASE_URI=http://localhost:3232         # This MCP server's URL
PORT=3232                              # MCP server port
AUTH_SERVER_URL=http://localhost:3001  # External auth server URL
REDIS_URL=redis://localhost:6379
```

## Token Validation Flow

1. Client sends request with `Authorization: Bearer <token>`
2. MCP server extracts token from header
3. **MCP server calls** `POST AUTH_SERVER_URL/introspect` with token
4. Auth server returns token info (active, user_id, scopes, expiry)
5. MCP server validates:
   - Token is active
   - Token audience matches this server (BASE_URI)
   - Token hasn't expired
6. Request proceeds with user context

## Testing

```bash
npm test              # 67 unit tests
npm run lint          # Lint code
npm run typecheck     # Type checking
npm run build         # Build to dist/
```

## Production Adaptation

To use a commercial OAuth provider:

1. Update `.env` with provider URL:
```bash
AUTH_SERVER_URL=https://your-tenant.auth0.com
```

2. Modify `src/auth/external-verifier.ts` for provider-specific introspection:
```typescript
const response = await fetch(`${this.authServerUrl}/oauth/introspect`, {
  // Add provider-specific authentication
})
```

3. Adjust response parsing if the introspection format differs from RFC 7662 standard

The MCP server code otherwise remains unchanged.

## References

- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [OAuth 2.0 Resource Servers](https://www.oauth.com/oauth2-servers/the-resource-server/)

## Related Documentation

- [Main README](../README.md) - Complete project documentation
- [Auth Server README](../auth-server/README.md) - The demo OAuth provider
- [OAuth Patterns](../docs/oauth-patterns.md) - OAuth architecture patterns
- [OAuth Flow](../docs/oauth-flow.md) - Detailed OAuth flow analysis
- [Session Ownership](../docs/session-ownership.md) - Session management details
