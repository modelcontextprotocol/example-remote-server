# Endpoint Reference

Complete listing of all endpoints provided by each server configuration.

## Embedded OAuth Server (Port 3232)

Single server hosting OAuth authorization, mock identity provider, and MCP resources.

### OAuth Authorization Endpoints
Provided by `mcpAuthRouter` from MCP SDK:

- `GET /.well-known/oauth-authorization-server` - OAuth metadata discovery
- `POST /register` - Dynamic client registration
- `GET /authorize` - Authorization request (starts OAuth flow)
- `POST /token` - Token exchange (authorization code → tokens) and token refresh
- `POST /revoke` - Token revocation

### Mock Upstream Identity Provider Endpoints
Local simulation of upstream IDP (would be external in production):

- `GET /mock-upstream-idp/authorize` - Mock user authentication page
- `GET /mock-upstream-idp/callback` - IDP callback handler (returns userId)

**Note**: In production, the OAuth server would redirect to external URLs like `https://accounts.google.com` or `https://login.okta.com` instead of these local endpoints.

### MCP Resource Endpoints

#### Streamable HTTP Transport (Recommended)
- `GET /mcp` - Establish SSE stream for session
- `POST /mcp` - Initialize session or send messages
- `DELETE /mcp` - Terminate session

#### SSE Transport (Legacy)
- `GET /sse` - Establish SSE connection
- `POST /message` - Send messages to session

All MCP endpoints require `Authorization: Bearer <token>` header.

### Static Assets
- `GET /` - Splash page (HTML)
- `GET /mcp-logo.png` - MCP logo
- `GET /styles.css` - Stylesheet

---

## External OAuth - Auth Server (Port 3001)

Standalone OAuth authorization server (represents Auth0, Okta, etc. in production).

### OAuth Authorization Endpoints
Provided by `mcpAuthRouter` from MCP SDK:

- `GET /.well-known/oauth-authorization-server` - OAuth metadata discovery
- `POST /register` - Dynamic client registration
- `GET /authorize` - Authorization request
- `POST /token` - Token exchange and refresh
- `POST /revoke` - Token revocation

### Token Introspection
Custom implementation for resource server token validation:

- `POST /introspect` - Token introspection (RFC 7662)
  - Called by MCP server to validate tokens
  - Returns token status, scopes, expiry, user info
  - Protected endpoint (not public)

### Mock Upstream Identity Provider Endpoints
Local simulation of upstream IDP:

- `GET /mock-upstream-idp/authorize` - Mock user authentication page
- `GET /mock-upstream-idp/callback` - IDP callback handler

**Note**: Commercial OAuth providers (Auth0, Okta) have their own user authentication systems. These endpoints simulate that functionality.

### Utility Endpoints
- `GET /health` - Health check (returns server status)
- `GET /mcp-logo.png` - Logo asset for auth pages

---

## External OAuth - MCP Server (Port 3232)

Pure MCP resource server with no OAuth authorization functionality.

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
- `GET /` - Splash page
- `GET /mcp-logo.png` - MCP logo
- `GET /styles.css` - Stylesheet

---

## Key Differences

| Endpoint Type | Embedded OAuth | External Auth Server | External MCP Server |
|---------------|----------------|---------------------|---------------------|
| OAuth authorization (`/authorize`, `/token`) | ✅ Full | ✅ Full | ❌ None |
| Token introspection (`/introspect`) | ❌ Not needed | ✅ Yes | ❌ Not needed |
| OAuth metadata discovery | ✅ Yes | ✅ Yes | ✅ Read-only redirect |
| Mock IDP (`/mock-upstream-idp`) | ✅ Yes | ✅ Yes | ❌ No |
| MCP resources (`/mcp`, `/sse`) | ✅ Yes | ❌ No | ✅ Yes |

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

## References

- [MCP Transport Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OAuth 2.0 Endpoints](https://www.oauth.com/oauth2-servers/definitions/)
