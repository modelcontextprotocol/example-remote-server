# OAuth 2.0 + PKCE Flow Analysis

This document details the complete OAuth 2.0 authorization code flow with PKCE as implemented in this reference server, including how it differs between integrated and separate modes.

## Flow Overview

The server implements OAuth 2.1 with PKCE (Proof Key for Code Exchange) for secure authorization. Here's how each step maps to data storage, expiry, and mode-specific behavior:

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

**Mode differences**: None - identical in both modes.

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

**Mode differences**:
- **Embedded OAuth**: OAuth server runs on MCP server (port 3232)
- **External OAuth**: OAuth server runs independently (port 3001)

---

## 3. User Authentication & Authorization

**Purpose**: Authenticate the user and obtain consent.

**Flow** (identical in both modes):
```
OAuth Server → User: Shows auth page with "Continue to Authentication" button
User → OAuth Server: Clicks button
OAuth Server → Upstream IDP: Redirects to /mock-upstream-idp/authorize
Upstream IDP → User: Shows user selection UI
User → Upstream IDP: Selects/creates user ID
Upstream IDP → OAuth Server: Redirects to /mock-upstream-idp/callback?userId=X
OAuth Server: Validates user, issues authorization code
OAuth Server → App: Redirects to app's redirect_uri with code
```

**Mode differences**:
- **Embedded OAuth**: OAuth Server runs on MCP server (port 3232)
- **External OAuth**: OAuth Server runs independently (port 3001)

The flow itself is identical. Both modes delegate user authentication to an upstream IDP (simulated by `/mock-upstream-idp/*` endpoints, which represent corporate SSO or social login in production).

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

**Mode differences**: None in the exchange itself. The endpoint location differs:
- **Embedded OAuth**: `http://localhost:3232/token`
- **External OAuth**: `http://localhost:3001/token`

---

## 5. Using Access Tokens

**Purpose**: Access MCP resources with the token.

**Flow**:
```
App → MCP Server: POST /mcp
  Authorization: Bearer <access_token>
  Mcp-Session-Id: <session_id>
  {MCP request}

MCP Server: Validates token → Serves MCP resource
```

**Token Validation - Embedded OAuth**:
```
MCP Server (same process as OAuth server):
  - Reads auth:installation:{accessToken} from Redis
  - Validates expiry, scopes
  - Returns user info directly
```

**Token Validation - External OAuth**:
```
MCP Server:
  - Calls POST {AUTH_SERVER_URL}/introspect with token
  - Auth server validates and returns token info
  - MCP server validates audience matches BASE_URI
  - Proceeds with request
```

**Mode differences**: This is the key architectural difference:
- **Embedded OAuth**: In-process token validation (fast, direct Redis access)
- **External OAuth**: Remote token validation via HTTP introspection (adds network hop, follows RFC 7662)

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

**Mode differences**: None - identical flow, just different endpoint locations.

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

**Mode differences**: None - PKCE works identically in both modes.

---

## References

- [RFC 6749: OAuth 2.0 Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 7662: Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
