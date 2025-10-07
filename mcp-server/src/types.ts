/**
 * OAuth 2.0 Token Introspection Response
 * Based on RFC 7662: https://tools.ietf.org/html/rfc7662
 * Used when validating tokens with the external authorization server.
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
