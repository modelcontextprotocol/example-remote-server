# Auth Server - Demo OAuth 2.0 Provider

Demonstration OAuth 2.0 authorization server representing commercial providers (Auth0, Okta, Google OAuth).

## Purpose

Complete OAuth 2.1 server implementing:
- Client registration (Dynamic Client Registration)
- Authorization flow with PKCE
- Token issuance and refresh
- Token introspection (RFC 7662)
- User authentication (via demo upstream IDP)

In production, replace this server with a commercial OAuth provider.

## Quick Start

```bash
# From this directory:
npm run dev

# Server starts on http://localhost:3001
```

## Flow

```
MCP Client ──OAuth──> Auth Server ──tokens──> MCP Client ──MCP requests──> MCP Server
                                                                                │
                                                                                └──validate──> Auth Server /introspect
```

1. MCP Client initiates OAuth flow with this server
2. Server handles authorization and user authentication
3. Server issues access tokens
4. Client uses tokens to access MCP server
5. MCP server validates tokens by calling this server's `/introspect` endpoint

## Key Components

### `src/index.ts`
Main entry point. Sets up:
- OAuth endpoints via SDK's `mcpAuthRouter`
- Token introspection endpoint (`POST /introspect`)
- Mock upstream auth UI for demo
- Rate limiting and CORS

### `src/auth/provider.ts`
**FeatureReferenceAuthProvider** - Implements OAuth server logic:
- Client registration storage
- Authorization code generation
- PKCE challenge validation
- Token issuance and refresh
- Token verification

### `src/services/`
- **auth.ts**: Auth service wrappers
- **redis-auth.ts**: Redis operations for OAuth data

### `src/handlers/mock-upstream-idp.ts`
Mock upstream identity provider. Simulates user authentication that would be handled by corporate SSO or social login in production OAuth providers.

## OAuth Endpoints

```bash
# Discovery
GET /.well-known/oauth-authorization-server

# Client registration
POST /register

# Authorization
GET /authorize?client_id=...&redirect_uri=...&code_challenge=...

# Token exchange
POST /token

# Token introspection (called by MCP server)
POST /introspect
```

## Configuration

Environment variables in `.env`:
```bash
AUTH_SERVER_URL=http://localhost:3001
AUTH_SERVER_PORT=3001
BASE_URI=http://localhost:3232         # MCP server URL
REDIS_URL=redis://localhost:6379
```

## Testing

```bash
npm test              # 37 unit tests
npm run lint          # Lint code
npm run typecheck     # Type checking
npm run build         # Build to dist/
```

## Production Usage

This demo server should be replaced with a commercial OAuth provider in production.

See [OAuth Architecture Patterns](../docs/oauth-architecture-patterns.md#using-a-commercial-auth-provider) for detailed integration guidance.

**Supported providers:** Auth0, Okta, Azure AD, AWS Cognito, Google, GitHub, and any RFC 7662-compliant OAuth provider.

## Redis Data

This server stores in Redis:
- `auth:client:{clientId}` - OAuth client registrations (30 day TTL)
- `auth:pending:{code}` - Pending authorizations (10 min TTL)
- `auth:installation:{token}` - Active installations (7 day TTL)
- `auth:refresh:{refreshToken}` - Refresh token mappings (7 day TTL)
- `auth:exch:{code}` - Token exchanges (10 min TTL)

## Related Documentation

- [Main README](../README.md) - Complete project documentation
- [MCP Server README](../mcp-server/README.md) - How MCP server uses these tokens
- [OAuth Architecture Patterns](../docs/oauth-architecture-patterns.md) - OAuth integration options
- [OAuth Flow](../docs/oauth-flow.md) - Detailed OAuth flow analysis
