# OAuth Architecture Patterns

This document describes different OAuth 2.0 architecture patterns for MCP servers, as specified in the [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

## Overview

Per the MCP specification, "the authorization server may be hosted with the resource server or as a separate entity." This leads to two primary patterns for implementing OAuth in MCP servers.

## Pattern 1: Separate Authorization Server (Recommended)

The current implementation demonstrates this pattern with separate authorization and resource servers. (Note: the authorization server is for demonstration purposes only.)

### Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│             │  OAuth  │                  │ Token   │                 │
│  MCP Client │────────>│  Auth Server     │<────────│  MCP Server     │
│             │         │  (port 3001)     │validate │  (port 3232)    │
│             │<────────│                  │         │                 │
│             │  token  │  Issues tokens   │         │  Serves MCP     │
│             │         └──────────────────┘         │  resources      │
│             │────────────────────────────────────> │                 │
│             │         MCP requests with token      │                 │
└─────────────┘                                      └─────────────────┘
```

### Components

1. **Demo Authorization Server** (port 3001)
   - Handles OAuth 2.0 authorization flow
   - Issues and manages tokens
   - Provides token introspection endpoint (RFC 7662)
   - Should be replaced with Auth0, Okta, Google OAuth, etc.

2. **MCP Resource Server** (port 3232)
   - Serves MCP protocol resources
   - Validates tokens via introspection
   - Contains no OAuth authorization code
   - Focuses purely on MCP functionality

### Using a Commercial Auth Provider

The demo auth server should be replaced with a commercial OAuth provider in production.

**Supported providers:**
- Auth0, Okta, Azure AD/Microsoft Entra
- AWS Cognito, Google Identity Platform
- GitHub OAuth
- Any RFC 7662-compliant OAuth provider

#### Integration Steps

1. **Configure provider**: Set up OAuth app in your provider
   - Register your MCP server as a resource server
   - Configure allowed redirect URIs
   - Enable token introspection endpoint

2. **Update MCP server environment** (`mcp-server/.env`):
   ```bash
   AUTH_SERVER_URL=https://your-tenant.auth0.com
   # or https://your-domain.okta.com
   # or https://login.microsoftonline.com/your-tenant
   ```

3. **Adjust token introspection** if needed (`mcp-server/src/auth/external-verifier.ts`):
   ```typescript
   // Most providers use RFC 7662 standard format, but some may differ
   const response = await fetch(`${this.authServerUrl}/oauth/introspect`, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/x-www-form-urlencoded',
       // Some providers require authentication here
       'Authorization': `Basic ${Buffer.from('client_id:client_secret').toString('base64')}`
     },
     body: `token=${token}`
   });
   ```

4. **Update redirect URIs**: Configure your provider's allowed callbacks to match your deployment URLs

5. **Test the integration**: Verify the full OAuth flow with your provider

**Note on token introspection:** Most providers use the RFC 7662 standard format. If your provider uses a non-standard format, you may need to adjust the response parsing in `mcp-server/src/auth/external-verifier.ts`.

The MCP server code otherwise remains unchanged - it only needs to know where to validate tokens.

---

## Pattern 2: Embedded Authorization Server (Alternative/Legacy)

The MCP spec describes an alternative pattern where the OAuth server is embedded within the MCP server. However, this pattern is not recommended in the general case, and is not demonstrated in this codebase.

### Possible Use Cases

- **Enterprise Deployments**: Organizations needing control over OAuth token issuance while leveraging existing corporate identity infrastructure (LDAP, Active Directory, SAML)
- **Proof of Concepts**: Quick prototypes and demonstrations
- **Small Deployments**: Internal tools with simple auth needs
- **Isolated Systems**: Air-gapped environments without external connectivity
- **Custom Auth Requirements**: Specialized authentication needs not met by standard providers

---

## Comparison

| Aspect | Separate Servers | Embedded Server |
|--------|------------------|-----------------|
| **Architecture** | 2+ servers | 1 server |
| **OAuth endpoints** | On auth server | On MCP server |
| **Token validation** | Remote (introspection) | In-process |
| **Upstream IDP support** | Via auth server | Direct integration |
| **Production readiness** | ✅ Recommended | ⚠️ Limited use cases |

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