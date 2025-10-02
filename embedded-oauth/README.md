# Embedded OAuth - MCP Feature Reference Server

This is a **complete, standalone implementation** of an MCP server with self-hosted OAuth authentication. Everything you need is in this directory.

## Overview

Per the [MCP specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), "the authorization server may be hosted with the resource server." This mode demonstrates a self-hosted OAuth 2.1 authorization server running in the same process as the MCP server.

**Pattern demonstrated**: OAuth server that delegates user authentication to an upstream identity provider (corporate SSO, LDAP, Active Directory).

**Real-world use case**: Enterprise deployments that need control over OAuth token issuance while leveraging existing corporate identity infrastructure.

For the OAuth-as-a-Service pattern (using Auth0/Okta directly), see [external-oauth](../external-oauth/README.md).

## Quick Start

```bash
# 1. Make sure Redis is running (from repo root)
docker compose up -d

# 2. Install dependencies (if not already done)
npm install

# 3. Start the server
npm run dev

# 4. Test with MCP Inspector
npx -y @modelcontextprotocol/inspector
# Connect to: http://localhost:3232/mcp
```

## Available Commands

```bash
npm run dev         # Start with hot reload
npm run dev:break   # Start with debugger
npm run build       # Build to dist/
npm start           # Run built version
npm test            # Run 85 unit tests
npm run lint        # Lint code
npm run typecheck   # Check types
```

## Configuration

Environment variables are in `.env`:
```bash
BASE_URI=http://localhost:3232
PORT=3232
REDIS_URL=redis://localhost:6379
```

## What This Demonstrates

**OAuth + MCP integration**:
- Self-hosted OAuth 2.1 server with PKCE
- Upstream identity provider delegation (simulated via `/mock-upstream-idp/*`)
- Complete authorization flow in one codebase

**MCP features**:
- Tools (7), resources (100), prompts (3), sampling, logging, completions
- Streamable HTTP and SSE transports
- Redis-backed horizontal scaling
- Session isolation and user ownership

## Understanding the Upstream Delegation Pattern

This implementation demonstrates a common enterprise OAuth pattern:

```
MCP Client                   This Server                    Simulated Upstream
   │                              │                              │
   │──1. /authorize───────────────>│                              │
   │<───(show auth page)───────────│                              │
   │                               │                              │
   │──2. Click "Continue"──────────>│                              │
   │<──redirect /mock-upstream-idp─│                              │
   │                               │                              │
   │──3. /mock-upstream-idp/authorize──────────────────────────────>│
   │<──(show user selection)───────────────────────────────────────│
   │──4. Select user───────────────────────────────────────────────>│
   │<──redirect with userId────────────────────────────────────────│
   │                               │                              │
   │──5. /mock-upstream-idp/callback──>│                              │
   │                               │──(validate userId)            │
   │                               │──(issue MCP tokens)           │
   │<──redirect with auth code─────│                              │
   │                               │                              │
   │──6. /token (exchange code)────>│                              │
   │<──MCP access token────────────│                              │
```

**In production**, `/mock-upstream-idp/*` would be replaced by corporate SSO (Okta, Azure AD, etc.).

## Code Organization

```
src/
├── index.ts                 # Main entry point (MCP + OAuth + routing)
├── auth/
│   ├── provider.ts          # FeatureReferenceAuthProvider (OAuth server logic)
│   └── auth-core.ts         # Token generation, PKCE utilities
├── services/
│   ├── mcp.ts               # MCP server with all features
│   ├── auth.ts              # Auth service wrappers
│   ├── redis-auth.ts        # Redis auth operations
│   └── redisTransport.ts    # Redis-backed transport
├── handlers/
│   ├── shttp.ts             # Streamable HTTP handler
│   ├── sse.ts               # SSE handler
│   ├── mock-upstream-idp.ts          # Mock upstream IDP simulation
│   └── common.ts            # Shared middleware
└── utils/
    └── logger.ts            # Structured logging
```

## Next Steps

- Modify `src/services/mcp.ts` to add custom tools and resources
- See [external-oauth](../external-oauth/README.md) for external OAuth pattern
- See [docs/oauth-flow.md](../docs/oauth-flow.md) for detailed OAuth flow analysis

## Testing

```bash
npm test                        # 85 unit tests
npm run test:e2e:integrated     # E2E test (from repo root)
```

## References

- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [OAuth 2.1 Draft](https://oauth.net/2.1/)
- [RFC 6749: OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [docs/oauth-flow.md](../docs/oauth-flow.md) - Detailed flow analysis with mode differences
