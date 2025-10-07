# Endpoint Reference

Complete listing of all endpoints provided by each server in the architecture.

## Auth Server

Standalone OAuth 2.0 authorization server that handles authentication and token management.

### OAuth Authorization Endpoints
Provided by `mcpAuthRouter` from MCP SDK:

- `GET /.well-known/oauth-authorization-server` - OAuth metadata discovery
- `POST /register` - Dynamic client registration
- `GET /authorize` - Authorization request (starts OAuth flow)
- `POST /token` - Token exchange (authorization code → tokens) and token refresh
- `POST /revoke` - Token revocation

### Token Introspection
Custom implementation for resource server token validation:

- `POST /introspect` - Token introspection ([RFC 7662](https://datatracker.ietf.org/doc/html/rfc7662))
  - Called by MCP server to validate tokens
  - Returns token status, scopes, expiry, user info
  - Protected endpoint (not public)

### Mock Upstream Identity Provider Endpoints
Local simulation of upstream IDP (would be external in production):

- `GET /mock-upstream-idp/authorize` - Mock user authentication page
- `GET /mock-upstream-idp/callback` - IDP callback handler (returns userId)

**Note**: In production, this would redirect to external providers like Auth0, Okta, Google, GitHub, etc. These endpoints simulate that functionality for demonstration purposes.

### Utility Endpoints
- `GET /health` - Health check (returns server status)
- `GET /mcp-logo.png` - Logo asset for auth pages

---

## MCP Server

MCP resource server that implements the Model Context Protocol with delegated authentication.

### OAuth Metadata (Read-Only)
Provided by `mcpAuthMetadataRouter`:

- `GET /.well-known/oauth-authorization-server` - Returns metadata pointing to external auth server
  - Tells clients to use auth server at :3001
  - Read-only - no token issuance happens here

### MCP Resource Endpoints

#### Streamable HTTP Transport (Recommended)
- `GET /mcp` - Establish SSE stream for session
- `POST /mcp` - Initialize session or send messages
- `DELETE /mcp` - Terminate session

#### SSE Transport (Legacy)
- `GET /sse` - Establish SSE connection
- `POST /message` - Send messages to session

All MCP endpoints require `Authorization: Bearer <token>` header. Tokens are validated by calling the auth server's `/introspect` endpoint.

### Static Assets
- `GET /` - Splash page (HTML)
- `GET /mcp-logo.png` - MCP logo
- `GET /styles.css` - Stylesheet

---

## Architecture Overview

| Endpoint Type | Auth Server | MCP Server |
|---------------|-------------|------------|
| OAuth authorization (`/authorize`, `/token`) | ✅ Full implementation | ❌ None (delegates to auth server) |
| Token introspection (`/introspect`) | ✅ Provides service | ❌ Consumes service |
| OAuth metadata discovery | ✅ Authoritative | ✅ Read-only redirect |
| Mock IDP (`/mock-upstream-idp`) | ✅ Yes | ❌ No |
| MCP resources (`/mcp`, `/sse`) | ❌ No | ✅ Yes |

---

## Headers

### Required Headers

**For MCP endpoints**:
- `Authorization: Bearer <access_token>` - OAuth access token (required)
- `Mcp-Session-Id: <session_id>` - Session identifier (for Streamable HTTP, after initialization)

**For OAuth endpoints**:
- `Content-Type: application/json` (for POST requests)
- `Content-Type: application/x-www-form-urlencoded` (for `/token` endpoint)

### Response Headers

**Streamable HTTP**:
- `Mcp-Session-Id` - Session ID (returned on initialization)
- `Content-Type: text/event-stream` - For SSE responses

**SSE Transport**:
- `Content-Type: text/event-stream`
- `Cache-Control: no-store, max-age=0`
- `Connection: keep-alive`

---

## Authentication Flow

1. **Client discovers auth server**: GET `/.well-known/oauth-authorization-server` from MCP server
2. **Client registers**: POST to auth server's `/register` endpoint
3. **User authorizes**: Redirected to auth server's `/authorize` endpoint
4. **Token exchange**: POST to auth server's `/token` endpoint
5. **Access MCP resources**: Use bearer token with MCP server endpoints
6. **Token validation**: MCP server validates tokens via auth server's `/introspect` endpoint

---

## References

- [MCP Transport Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OAuth 2.0 Endpoints](https://www.oauth.com/oauth2-servers/definitions/)