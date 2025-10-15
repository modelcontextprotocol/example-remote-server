# OAuth Implementation Guide

This comprehensive guide covers the OAuth 2.0 + PKCE implementation in the MCP Feature Reference Server, including architecture patterns, detailed flow analysis, and integration guidance.

**Quick Start**: If you're new to this codebase, start with [Implementation Modes](#implementation-modes) to understand the difference between internal (development) and external (production) auth modes.

## Table of Contents
- [Architecture Overview](#architecture-overview)
- [Implementation Modes](#implementation-modes)
- [OAuth Flow Details](#oauth-flow-details)
- [Commercial Provider Integration](#commercial-provider-integration)
- [Error Handling](#error-handling)
- [Testing & Troubleshooting](#testing--troubleshooting)
- [Best Practices](#best-practices)

---

## Architecture Overview

This implementation uses the **separate authorization server pattern** as recommended by the [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization). The authorization server is architecturally separate from the MCP resource server, ensuring clean separation of concerns and enabling integration with commercial OAuth providers.

### Key Principles

1. **Separation of Concerns**: OAuth logic is isolated from MCP functionality
2. **Token-Based Security**: All MCP requests require valid bearer tokens
3. **PKCE Protection**: Prevents authorization code interception attacks
4. **Flexible Deployment**: Supports both development and production configurations

---

## Implementation Modes

The server supports two modes while maintaining the same architectural pattern:

### Internal Mode (Development)

In internal mode, OAuth endpoints run in the same process as the MCP server for convenience during development and exploration.

**Configuration:**
```bash
AUTH_MODE=internal  # or leave unset (default)
# Server runs on port 3232
# OAuth and MCP endpoints share the same port
```

**Architecture:**
```
┌─────────────┐         ┌───────────────────────────────────────┐
│             │  OAuth  │  Single Process (port 3232)           │
│  MCP Client │────────>│  ┌──────────────┐    ┌──────────────┐ │
│             │         │  │ Auth Module  │    │ MCP Module   │ │
│             │<────────│  │              │    │              │ │
│             │  token  │  │Issues tokens │────│ Serves MCP   │ │
│             │         │  └──────────────┘    └──────────────┘ │
│             │────────>│         MCP requests with token       │
└─────────────┘         └───────────────────────────────────────┘
```

### External Mode (Production)

In external mode, the authorization server runs as a separate process, following production best practices.

**Configuration:**
```bash
AUTH_MODE=external
AUTH_SERVER_URL=http://localhost:3001  # or commercial provider URL
# Auth server on port 3001
# MCP server on port 3232
```

**Architecture:**
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

### Mode Comparison

| Aspect | Internal Mode | External Mode |
|--------|--------------|---------------|
| **Process Architecture** | Single process | Multiple processes |
| **Port Usage** | One port (3232) | Two ports (3001 + 3232) |
| **OAuth Endpoints** | Same port as MCP | Different port/server |
| **Token Validation** | In-process call | HTTP introspection |
| **Production Ready** | Development only | ✅ Production recommended |
| **Commercial Auth Providers** | Not applicable | ✅ Supported |

---

## OAuth Flow Details

The implementation follows OAuth 2.0 with PKCE (RFC 7636) for secure authorization.

### 1. Client Registration

**Purpose**: Register the application with the OAuth server (one-time setup)

```http
POST /register
Content-Type: application/json

{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://localhost:3000/callback"]
}
```

**Response:**
```json
{
  "client_id": "abc123",
  "client_secret": "secret456",
  "client_id_issued_at": 1234567890,
  "client_secret_expires_at": 0
}
```

**Storage**: Redis key `auth:client:{clientId}` (30-day expiry)

### 2. Authorization Request

**Purpose**: Initiate OAuth flow with PKCE

```http
GET /authorize?
  client_id=abc123&
  redirect_uri=http://localhost:3000/callback&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256&
  state=xyz789
```

**PKCE Security**:
- Client generates random `code_verifier` (43-128 characters)
- Sends SHA256 hash as `code_challenge`
- Must provide original verifier during token exchange

**Storage**: Redis key `auth:pending:{authCode}` (10-minute expiry)

### 3. User Authentication

The auth server authenticates the user and obtains consent:

1. Shows authorization page
2. User authenticates (via upstream IDP in production)
3. Issues authorization code
4. Redirects to client's `redirect_uri` with code

### 4. Token Exchange

**Purpose**: Exchange authorization code for tokens

```http
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
client_id=abc123&
client_secret=secret456&
code=auth_code_here&
redirect_uri=http://localhost:3000/callback&
code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

**PKCE Validation**:
```javascript
// Server verifies: SHA256(code_verifier) === stored code_challenge
const challenge = base64url(sha256(code_verifier));
if (challenge !== stored_code_challenge) {
  throw new Error('Invalid PKCE verifier');
}
```

**Response:**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "refresh_xyz",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

### 5. Using Access Tokens

**Purpose**: Access MCP resources with bearer token

```http
POST /mcp
Authorization: Bearer eyJhbGc...
Mcp-Session-Id: session-123

{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**Token Validation Process**:

1. MCP server extracts bearer token
2. Calls auth server's `/introspect` endpoint
3. Validates token is active and not expired
4. Extracts user ID from `sub` claim
5. Processes MCP request with user context

### 6. Token Refresh

**Purpose**: Obtain new access token when current expires

```http
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token=refresh_xyz&
client_id=abc123&
client_secret=secret456
```

**Response**: New access token (and optionally new refresh token)

---

## Commercial Provider Integration

The demo auth server should be replaced with a commercial OAuth provider in production.

### Supported Providers

- **Auth0** - Full OAuth 2.0 + OIDC support
- **Okta** - Enterprise identity management
- **Azure AD/Microsoft Entra** - Microsoft identity platform
- **AWS Cognito** - AWS managed authentication
- **Google Identity Platform** - Google OAuth
- **GitHub OAuth** - Developer-friendly OAuth
- Any RFC 7662-compliant OAuth provider

### Integration Steps

#### 1. Configure the Provider

In your OAuth provider's dashboard:
- Create new OAuth application/client
- Set redirect URIs (e.g., `http://localhost:3000/callback`)
- Enable token introspection endpoint (if required)
- Note client ID and secret

#### 2. Update Server Configuration

```bash
# .env file
AUTH_MODE=external
AUTH_SERVER_URL=https://your-tenant.auth0.com
# For Okta: https://your-domain.okta.com
# For Azure: https://login.microsoftonline.com/your-tenant
```

#### 3. Adjust Token Introspection (if needed)

Most providers follow RFC 7662, but some require authentication. Edit `src/interfaces/auth-validator.ts`:

```typescript
// In ExternalTokenValidator.introspect() method
const response = await fetch(`${this.authServerUrl}/oauth/introspect`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    // Some providers require authentication
    'Authorization': `Basic ${Buffer.from('client_id:client_secret').toString('base64')}`
  },
  body: `token=${encodeURIComponent(token)}`
});
```

#### 4. Provider-Specific Examples

**Auth0:**
```bash
AUTH_SERVER_URL=https://your-tenant.auth0.com
# Introspection endpoint: /oauth/token_info
```

**Okta:**
```bash
AUTH_SERVER_URL=https://your-domain.okta.com/oauth2/default
# Introspection endpoint: /v1/introspect
```

**Azure AD:**
```bash
AUTH_SERVER_URL=https://login.microsoftonline.com/your-tenant-id
# May require additional configuration for introspection
```

---

## Error Handling

### Common OAuth Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `invalid_client` | Wrong client credentials | Verify client_id and client_secret |
| `invalid_grant` | Expired/invalid auth code | Ensure code is used within 10 minutes |
| `invalid_request` | Missing required parameters | Check all OAuth parameters are provided |
| `unauthorized_client` | Client not authorized for grant type | Verify client registration settings |
| `invalid_token` | Token expired or revoked | Refresh token or re-authenticate |

### Token Validation Errors

```typescript
// Token expired
if (result.exp && result.exp < Date.now() / 1000) {
  throw new InvalidTokenError('Token has expired');
}

// Token not active
if (!result.active) {
  throw new InvalidTokenError('Token is not active');
}

// Wrong audience
if (result.aud !== expectedAudience) {
  throw new InvalidTokenError('Token audience mismatch');
}
```

### Error Response Format

```json
{
  "error": "invalid_token",
  "error_description": "The access token expired",
  "error_uri": "https://tools.ietf.org/html/rfc6750#section-3.1"
}
```

---

## Testing & Troubleshooting

### Testing OAuth Flows

```bash
# Test internal mode
npm run dev:internal
npx @modelcontextprotocol/inspector
# Connect to http://localhost:3232/mcp

# Test external mode
npm run dev:external
npx @modelcontextprotocol/inspector
# Connect to http://localhost:3232/mcp

# Run automated tests
npm test -- --testNamePattern="OAuth"
npm run test:e2e
```

### Common Issues and Solutions

**Issue: "Cannot connect to auth server"**
- Check `AUTH_MODE` and `AUTH_SERVER_URL` in `.env`
- Verify auth server is running (external mode)
- Check network connectivity to auth server

**Issue: "Token validation failed"**
- Verify tokens haven't expired (7-day default)
- Check Redis connection if using Redis storage
- Ensure auth server introspection endpoint is accessible

**Issue: "PKCE validation failed"**
- Ensure code_verifier is 43-128 characters
- Verify SHA256 hashing is correct
- Check code_challenge_method is 'S256'

**Issue: "Session not found"**
- Verify Redis is running if configured
- Check session hasn't expired
- Ensure same user is accessing the session

### Debug Logging

Enable detailed logging for troubleshooting:

```bash
# Enable debug logs
DEBUG=* npm run dev:internal

# Check auth flow metadata
curl -v http://localhost:3232/.well-known/oauth-authorization-server

# Test introspection (external mode only, on auth server)
# Note: In internal mode, introspection is handled internally
curl -X POST http://localhost:3001/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=YOUR_TOKEN"
```

### Monitoring Token Usage

```bash
# Monitor Redis for token operations (when Redis is configured)
redis-cli MONITOR | grep auth:

# Check active sessions
redis-cli KEYS "auth:installation:*"

# Check refresh tokens
redis-cli KEYS "auth:refresh:*"
```

---

## Best Practices

### Security

1. **Always use HTTPS in production** - Prevents token interception
2. **Implement PKCE for all flows** - Required by OAuth 2.1
3. **Validate token audience** - Prevents token substitution attacks
4. **Use short token expiries** - Limits exposure window
5. **Rotate refresh tokens** - Issue new refresh token on use
6. **Log authentication events** - For security auditing
7. **Rate limit auth endpoints** - Prevent brute force attacks

### Performance

1. **Cache introspection results** - Reduce auth server load
2. **Use connection pooling** - For Redis and HTTP connections
3. **Implement token refresh ahead of expiry** - Prevent interruptions
4. **Batch token validations** - When processing multiple requests
5. **Monitor auth server latency** - Set appropriate timeouts

### Development

1. **Use internal mode for development** - Faster iteration
2. **Test with external mode before production** - Catch integration issues
3. **Implement comprehensive error handling** - Better debugging
4. **Document your OAuth configuration** - For team members
5. **Use environment variables** - Never hardcode credentials

### Production Deployment

1. **Use commercial OAuth provider** - Better security and reliability
2. **Enable Redis for sessions** - Support multiple instances
3. **Implement health checks** - Monitor auth availability
4. **Set up monitoring and alerting** - Track auth failures
5. **Plan for token migration** - When changing providers
6. **Document disaster recovery** - Auth server failure procedures

---

## Data Lifecycle

### Storage Hierarchy

When Redis is configured, the following data is stored with automatic expiry:

| Data Type | Redis Key Pattern | Default Expiry | Purpose |
|-----------|------------------|----------------|---------|
| OAuth flow state | `auth:pending:{code}` | 10 minutes | Temporary auth state |
| Token exchange | `auth:exch:{code}` | 10 minutes | Prevent replay attacks |
| User sessions | `auth:installation:{token}` | 7 days | Active sessions |
| Refresh tokens | `auth:refresh:{token}` | 7 days | Token refresh |
| Client credentials | `auth:client:{id}` | 30 days | App registration |

**Note**: When Redis is not configured (in-memory storage), all data is lost on server restart.

### Cleanup

Expired data is automatically cleaned up by Redis TTL. For manual cleanup:

```bash
# Remove all auth data (CAUTION: will log out all users)
redis-cli --scan --pattern "auth:*" | xargs redis-cli DEL

# Remove specific user session
redis-cli DEL "auth:installation:ACCESS_TOKEN"
```

---

## References

- [MCP Authorization Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [RFC 6749: OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OAuth 2.1 Draft](https://oauth.net/2.1/) - Modern security requirements