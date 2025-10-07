# OAuth 2.0 + PKCE Flow Analysis

This document details the complete OAuth 2.0 authorization code flow with PKCE as implemented in this reference server with separate authorization and resource servers.

## Flow Overview

The server implements OAuth 2.1 with PKCE (Proof Key for Code Exchange) for secure authorization. The architecture separates the authorization server (port 3001) from the MCP resource server (port 3232).

## 1. Client Registration

**Purpose**: Register the application with the OAuth server (happens once during app setup).

**Flow**:
```
App → Auth Server: POST /register {"client_name": "...", "redirect_uris": [...]}
Auth Server → App: {"client_id": "XYZ", "client_secret": "ABC", ...}
```

**Storage**:
- Redis key: `auth:client:{clientId}`
- Expiry: 30 days (long-lived app credentials)
- Server: Auth Server (port 3001)

---

## 2. Authorization Request

**Purpose**: User initiates connection to MCP server.

**Flow**:
```
App → Auth Server: GET /authorize?
  client_id=XYZ
  &redirect_uri=http://localhost:3000/callback
  &code_challenge=<SHA256 of verifier>
  &code_challenge_method=S256
  &state=<CSRF token>

Auth Server: Saves pending authorization, shows authorization page
```

**Storage**:
- Redis key: `auth:pending:{authCode}`
- Expiry: 10 minutes (short-lived temporary state)
- Data: redirect_uri, code_challenge, code_challenge_method, client_id, state
- Server: Auth Server (port 3001)

---

## 3. User Authentication & Authorization

**Purpose**: Authenticate the user and obtain consent.

**Flow**:
```
Auth Server → User: Shows auth page with "Continue to Authentication" button
User → Auth Server: Clicks button
Auth Server → Upstream IDP: Redirects to /mock-upstream-idp/authorize
Upstream IDP → User: Shows user selection UI
User → Upstream IDP: Selects/creates user ID
Upstream IDP → Auth Server: Redirects to /mock-upstream-idp/callback?userId=X
Auth Server: Validates user, issues authorization code
Auth Server → App: Redirects to app's redirect_uri with code
```

**Note**: In production, the upstream IDP would be an external provider (Auth0, Okta, Google, GitHub, etc.). The `/mock-upstream-idp/*` endpoints simulate this for demonstration purposes.

---

## 4. Authorization Code Exchange

**Purpose**: Exchange authorization code for access and refresh tokens.

**Flow**:
```
App → Auth Server: POST /token
  grant_type=authorization_code
  &client_id=XYZ
  &client_secret=ABC
  &code=<authorization code>
  &redirect_uri=http://localhost:3000/callback
  &code_verifier=<original random string>

Auth Server:
  1. Validates code_verifier matches code_challenge (PKCE)
  2. Validates redirect_uri matches original
  3. Validates client credentials
  4. Issues tokens

Auth Server → App:
  {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 604800,
    "token_type": "Bearer"
  }
```

**Storage**:
- `auth:exch:{authCode}` - Token exchange record (prevents replay attacks)
- `auth:installation:{accessToken}` - Active MCP installation
- `auth:refresh:{refreshToken}` - Refresh token mapping
- Expiry: 10 minutes for exchange record, 7 days for installation
- Server: Auth Server (port 3001)

---

## 5. Using Access Tokens

**Purpose**: Access MCP resources with the token.

**Flow**:
```
App → MCP Server: POST /mcp
  Authorization: Bearer <access_token>
  Mcp-Session-Id: <session_id>
  {MCP request}

MCP Server → Auth Server: POST /introspect
  token=<access_token>

Auth Server → MCP Server:
  {
    "active": true,
    "userId": "...",
    "exp": ...,
    "aud": "http://localhost:3232"
  }

MCP Server: Validates audience, serves MCP resource
```

**Token Validation Process**:
1. MCP Server receives request with bearer token
2. Calls Auth Server's `/introspect` endpoint (RFC 7662)
3. Auth Server validates token and returns metadata
4. MCP Server validates audience matches `BASE_URI`
5. Request proceeds with authenticated user context

This separation allows the Auth Server to be replaced with commercial providers (Auth0, Okta) while keeping the MCP server unchanged.

---

## 6. Token Refresh

**Purpose**: Obtain new access token when current one expires.

**Flow**:
```
App → Auth Server: POST /token
  grant_type=refresh_token
  &refresh_token=<refresh token>
  &client_id=XYZ
  &client_secret=ABC

Auth Server:
  1. Validates refresh_token
  2. Issues new access_token (and optionally new refresh_token)
  3. Updates installation record

Auth Server → App: {"access_token": "...", ...}
```

**Storage**:
- Reads: `auth:refresh:{refreshToken}` → gets access token
- Reads: `auth:installation:{accessToken}` → gets installation
- Writes: New `auth:installation:{newAccessToken}`
- Writes: New `auth:refresh:{newRefreshToken}`
- Expiry: 7 days
- Server: Auth Server (port 3001)

---

## Data Lifecycle Hierarchy

**Timeline (shortest to longest expiry):**
1. **OAuth flow state** (10 minutes) - `auth:pending`, `auth:exch`
2. **User sessions** (7 days) - `auth:installation`, `auth:refresh`
3. **Client credentials** (30 days) - `auth:client`

This hierarchy ensures each layer outlives the layers it supports.

---

## Security: PKCE (Proof Key for Code Exchange)

PKCE prevents authorization code interception attacks:

1. **Authorization request**: Client sends `code_challenge` (SHA256 hash of random string)
2. **Token exchange**: Client must provide original `code_verifier`
3. **Server validates**: SHA256(code_verifier) must equal stored code_challenge

This ensures only the client that initiated the flow can exchange the code, even if the code is intercepted.

---

## References

- [RFC 6749: OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)