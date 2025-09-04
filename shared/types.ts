import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Represents a pending OAuth authorization that hasn't been exchanged for tokens yet.
 * Stored in Redis with the authorization code as the key.
 */
export interface PendingAuthorization {
  /** The redirect URI where the client expects to receive the authorization code */
  redirectUri: string;
  /** PKCE code challenge - a derived value from the code verifier */
  codeChallenge: string;
  /** Method used to derive the code challenge (currently only S256 supported) */
  codeChallengeMethod: string;
  /** The OAuth client ID that initiated the authorization */
  clientId: string;
  /** Optional state parameter for CSRF protection */
  state?: string;
}

/**
 * Represents the exchange of an authorization code for an MCP access token.
 * Used to prevent replay attacks by tracking if a code has been used.
 */
export interface TokenExchange {
  /** The MCP access token that was issued for this authorization code */
  mcpAccessToken: string;
  /** Whether this authorization code has already been exchanged for tokens */
  alreadyUsed: boolean;
}

/**
 * Represents fake upstream tokens for demonstration purposes.
 * In production, this would contain real upstream provider tokens.
 */
export interface FakeUpstreamInstallation {
  /** Simulated access token from the fake upstream provider */
  fakeAccessTokenForDemonstration: string;
  /** Simulated refresh token from the fake upstream provider */
  fakeRefreshTokenForDemonstration: string;
}

/**
 * The complete installation object stored in Redis, containing both
 * upstream provider information and MCP-specific tokens.
 * This object is encrypted using the MCP access token as the key.
 */
export interface McpInstallation {
  /** Information from the upstream authentication provider */
  fakeUpstreamInstallation: FakeUpstreamInstallation;
  /** MCP OAuth tokens issued to the client */
  mcpTokens: OAuthTokens;
  /** The OAuth client ID associated with this installation */
  clientId: string;
  /** Unix timestamp (seconds) when the tokens were issued */
  issuedAt: number;
  /** Unique identifier for the user (not the OAuth client) */
  userId: string;
}

/**
 * OAuth 2.0 Token Introspection Response
 * Based on RFC 7662: https://tools.ietf.org/html/rfc7662
 * Used when validating tokens with an external authorization server.
 */
export interface TokenIntrospectionResponse {
  /** Whether the token is currently active */
  active: boolean;
  /** Space-separated list of scopes associated with the token */
  scope?: string;
  /** Client identifier for the OAuth client that requested the token */
  client_id?: string;
  /** Human-readable identifier for the resource owner */
  username?: string;
  /** Type of the token (e.g., "Bearer") */
  token_type?: string;
  /** Expiration time as seconds since Unix epoch */
  exp?: number;
  /** Time at which the token was issued as seconds since Unix epoch */
  iat?: number;
  /** Time before which the token is not valid as seconds since Unix epoch */
  nbf?: number;
  /** Subject identifier for the resource owner */
  sub?: string;
  /** Intended audience for the token */
  aud?: string | string[];
  /** Issuer of the token */
  iss?: string;
  /** Unique identifier for the token */
  jti?: string;
  /** Custom field for our implementation to store user ID */
  userId?: string;
}