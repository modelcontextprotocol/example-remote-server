# External OAuth - External OAuth Provider Pattern

Two standalone servers demonstrating how MCP resource servers integrate with external OAuth providers.

## Overview

Per the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), "the authorization server may be a separate entity." This mode demonstrates the OAuth-as-a-Service pattern.

**Pattern**: MCP resource server delegating all OAuth operations to a separate authorization server.

**Real-world use cases**: Applications using Auth0, Okta, Google OAuth, AWS Cognito, or similar providers for authentication.

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│             │  OAuth  │                  │ Token   │                 │
│  MCP Client │────────>│  Auth Server     │<────────│  MCP Server     │
│             │         │  (port 3001)     │validate │  (port 3232)    │
│             │<────────│                  │         │                 │
│             │  token  │  Issues tokens   │         │  Serves MCP     │
│             │         │                  │         │  resources      │
│             │────────────────────────────────────> │                 │
│             │         MCP requests with token      │                 │
└─────────────┘                                      └─────────────────┘
```

**Servers**:
1. **Auth Server** - Demo OAuth provider (represents Auth0/Okta) - [Details](auth-server/README.md)
2. **MCP Server** - Resource server with token validation only - [Details](mcp-server/README.md)

The MCP server contains no OAuth authorization code - it only validates tokens via introspection.

## Quick Start

```bash
# From repo root:

# 1. Make sure Redis is running
docker compose up -d

# 2. Install dependencies (if not already done)
npm install

# 3. Start both servers
npm run dev:separate

# 4. Test with MCP Inspector
npx -y @modelcontextprotocol/inspector
# Connect to: http://localhost:3232/mcp
# OAuth will redirect to auth server at :3001
```

## Individual Server Commands

```bash
# From repo root:
npm run dev:auth-server      # Start just auth server (:3001)
npm run dev:mcp-server       # Start just MCP server (:3232)

# Or from individual directories:
cd auth-server && npm run dev
cd mcp-server && npm run dev
```

## Server Roles

**Auth Server** (port 3001): Demo OAuth provider implementing client registration, authorization, token issuance, and introspection. In production, replace with Auth0, Okta, or similar. [Implementation details](auth-server/README.md)

**MCP Server** (port 3232): Resource server that validates tokens via introspection and serves MCP resources. Production-ready - just configure `AUTH_SERVER_URL`. [Implementation details](mcp-server/README.md)

## Testing

```bash
# From repo root:
npm run test:separate                      # Run all tests (104 total)
npm run test:e2e:separate                  # Full e2e test

# Individual workspace tests:
npm test --workspace=external-oauth/auth-server    # 37 tests
npm test --workspace=external-oauth/mcp-server     # 67 tests
```

## Key Differences from Embedded OAuth

| Aspect | Embedded OAuth | External OAuth |
|--------|----------------|---------------|
| Servers | 1 server | 2 servers |
| OAuth endpoints | On MCP server | On auth server |
| Token validation | Direct (in-process) | Remote (introspection API) |
| Deployment | Simpler | Production-like |
| Code sharing | All in one place | Separated by concern |

## Production Adaptation

Replace `auth-server/` with a commercial OAuth provider (Auth0, Okta, AWS Cognito, Azure AD). The `mcp-server/` code integrates with any RFC 7662-compliant introspection endpoint.

## References

- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OAuth 2.0 Resource Servers](https://www.oauth.com/oauth2-servers/the-resource-server/)
- [docs/oauth-flow.md](../docs/oauth-flow.md) - Detailed flow analysis

## Next Steps

- See [auth-server/README.md](auth-server/README.md) for OAuth provider implementation
- See [mcp-server/README.md](mcp-server/README.md) for token validation implementation
- Compare with [embedded-oauth](../embedded-oauth/README.md) for self-hosted OAuth alternative
