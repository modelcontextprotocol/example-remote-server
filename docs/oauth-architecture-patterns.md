# OAuth Architecture Patterns

This document describes different OAuth 2.0 architecture patterns for MCP servers, as specified in the [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

## Overview

Per the MCP specification, "the authorization server may be hosted with the resource server or as a separate entity." This leads to two primary patterns for implementing OAuth in MCP servers.

## Pattern 1: Separate Authorization Server (Implemented)

The current implementation uses this production-ready pattern with separate authorization and resource servers.

### Architecture

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

### Components

1. **Authorization Server** (port 3001)
   - Handles OAuth 2.0 authorization flow
   - Issues and manages tokens
   - Provides token introspection endpoint (RFC 7662)
   - Can be replaced with Auth0, Okta, Google OAuth, etc.

2. **MCP Resource Server** (port 3232)
   - Serves MCP protocol resources
   - Validates tokens via introspection
   - Contains no OAuth authorization code
   - Focuses purely on MCP functionality

### Benefits

- **Standards Compliance**: Follows OAuth 2.0 best practices
- **Flexibility**: Easy to swap auth providers
- **Scalability**: Servers scale independently
- **Security**: Clear security boundaries
- **Maintainability**: Separation of concerns

### Real-World Use Cases

- **SaaS Applications**: Using Auth0 or Okta for authentication
- **Enterprise**: Integrating with corporate SSO (SAML, LDAP)
- **Social Login**: Google, GitHub, Facebook authentication
- **Cloud Native**: AWS Cognito, Azure AD integration

### Implementation Details

The MCP server validates tokens by calling the auth server's `/introspect` endpoint:

```typescript
// In MCP server
const response = await fetch(`${AUTH_SERVER_URL}/introspect`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: `token=${accessToken}`
});

const introspection = await response.json();
if (introspection.active) {
  // Token is valid, extract user info
  const userId = introspection.sub;
}
```

---

## Pattern 2: Embedded Authorization Server (Alternative)

An alternative pattern where the OAuth server is embedded within the MCP server. This demonstrates a self-hosted OAuth 2.1 authorization server running in the same process as the MCP server.

### Architecture

```
┌─────────────┐         ┌─────────────────────────┐
│             │  OAuth  │                         │
│  MCP Client │────────>│    MCP Server           │
│             │         │  ┌──────────────────┐  │
│             │<────────│  │ OAuth Server     │  │
│             │  token  │  └──────────────────┘  │
│             │         │  ┌──────────────────┐  │
│             │────────>│  │ MCP Resources    │  │
│             │   MCP   │  └──────────────────┘  │
└─────────────┘         └─────────────────────────┘
```

### Upstream Delegation Pattern

Embedded OAuth often delegates user authentication to an upstream identity provider while maintaining control over token issuance:

```
MCP Client                   MCP+OAuth Server              Upstream IDP
   │                              │                         (Corporate SSO)
   │──1. /authorize───────────────>│                              │
   │<───(show auth page)───────────│                              │
   │                               │                              │
   │──2. Click "Continue"──────────>│                              │
   │<──redirect to upstream────────│                              │
   │                               │                              │
   │──3. /upstream/authorize────────────────────────────────────────>│
   │<──(authenticate user)──────────────────────────────────────────│
   │──4. Provide credentials────────────────────────────────────────>│
   │<──redirect with userId─────────────────────────────────────────│
   │                               │                              │
   │──5. /callback with userId───────>│                              │
   │                               │──(validate userId)            │
   │                               │──(issue MCP tokens)           │
   │<──redirect with auth code──────│                              │
   │                               │                              │
   │──6. /token (exchange code)─────>│                              │
   │<──MCP access token─────────────│                              │
```

### Characteristics

- **Single Server**: OAuth and MCP in one process
- **Port**: Typically runs on single port (e.g., 3232)
- **Token Validation**: In-process, direct database access
- **Deployment**: Simpler, fewer moving parts
- **Upstream Delegation**: Can delegate authentication to corporate SSO while controlling token issuance

### Benefits

- **Simplicity**: Single server to deploy and manage
- **Performance**: No network hop for token validation
- **Self-Contained**: All functionality in one codebase
- **Control**: Full control over token issuance while leveraging existing identity infrastructure

### Drawbacks

- **Coupling**: Auth and MCP logic intertwined
- **Scalability**: Can't scale auth independently
- **Flexibility**: Harder to switch auth providers
- **Updates**: Auth changes require MCP server updates

### Use Cases

- **Enterprise Deployments**: Organizations needing control over OAuth token issuance while leveraging existing corporate identity infrastructure (LDAP, Active Directory, SAML)
- **Proof of Concepts**: Quick prototypes and demonstrations
- **Small Deployments**: Internal tools with simple auth needs
- **Isolated Systems**: Air-gapped environments without external connectivity
- **Custom Auth Requirements**: Specialized authentication needs not met by standard providers

### Typical Configuration

Environment variables for embedded pattern:
```bash
BASE_URI=http://localhost:3232      # Single server URL
PORT=3232                           # Single port for OAuth + MCP
REDIS_URL=redis://localhost:6379    # Session storage
UPSTREAM_IDP_URL=https://corp.sso  # Optional: upstream identity provider
```

### Code Organization

Typical structure for embedded OAuth implementation:
```
src/
├── index.ts                 # Main entry point (MCP + OAuth + routing)
├── auth/
│   ├── provider.ts          # OAuth server implementation
│   └── auth-core.ts         # Token generation, PKCE utilities
├── services/
│   ├── mcp.ts               # MCP protocol implementation
│   ├── auth.ts              # Auth service integration
│   ├── redis-auth.ts        # Redis auth operations
│   └── redisTransport.ts    # Redis-backed transport
├── handlers/
│   ├── oauth.ts             # OAuth endpoints (/authorize, /token)
│   ├── mcp-shttp.ts         # Streamable HTTP handler
│   ├── mcp-sse.ts           # SSE handler
│   └── upstream-idp.ts      # Upstream IDP integration
└── utils/
    └── logger.ts            # Structured logging
```

---

## Comparison

| Aspect | Separate Servers | Embedded Server |
|--------|------------------|-----------------|
| **Architecture** | 2+ servers | 1 server |
| **OAuth endpoints** | On auth server | On MCP server |
| **Token validation** | Remote (introspection) | In-process |
| **Deployment** | More complex | Simpler |
| **Scalability** | Independent scaling | Coupled scaling |
| **Provider integration** | Easy (standard APIs) | Difficult |
| **Code organization** | Clear separation | Mixed concerns |
| **Network hops** | Additional for validation | None for validation |
| **Upstream IDP support** | Via auth server | Direct integration |
| **Production readiness** | ✅ Recommended | ⚠️ Limited use cases |

---

## Migration Path

### From Embedded to Separate

If starting with embedded OAuth, migration to separate servers involves:

1. **Extract auth code**: Move OAuth handlers to separate service
2. **Implement introspection**: Add RFC 7662 endpoint
3. **Update MCP server**: Replace in-process validation with introspection calls
4. **Update configuration**: Point MCP server to auth server URL
5. **Migrate upstream IDP**: Move delegation logic to auth server
6. **Test thoroughly**: Ensure token flow works correctly

### From Separate to Commercial Provider

Replacing the demo auth server with a commercial provider:

1. **Configure provider**: Set up OAuth app in Auth0/Okta
2. **Update metadata URL**: Point to provider's discovery endpoint
3. **Configure introspection**: Set up token validation
4. **Update redirect URIs**: Configure allowed callbacks
5. **Migrate users**: Import existing users if needed
6. **Test integration**: Verify full OAuth flow

---

## Best Practices

1. **Use separate servers** for production deployments
2. **Implement token caching** to reduce introspection calls
3. **Use PKCE** for all OAuth flows (prevents code interception)
4. **Validate token audience** to prevent token substitution
5. **Implement proper session management** with Redis or similar
6. **Use HTTPS** in production for all endpoints
7. **Monitor token expiration** and implement refresh logic
8. **Log authentication events** for security auditing
9. **Consider upstream delegation** for enterprise deployments
10. **Document auth flow** for your specific implementation

---

## Testing Considerations

When implementing either pattern, ensure comprehensive testing:

- **Unit tests**: Test OAuth flows, token validation, session management
- **Integration tests**: Test auth server and MCP server interaction
- **E2E tests**: Test complete user flows from authorization to resource access
- **Security tests**: Test PKCE validation, token expiration, session isolation
- **Performance tests**: Test token validation caching, concurrent sessions

---

## References

- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 6749: OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OAuth 2.1 Draft](https://oauth.net/2.1/) - Modern security requirements
- [The OAuth 2.0 Authorization Framework in Practice](https://www.oauth.com/)