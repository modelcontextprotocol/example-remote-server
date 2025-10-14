/**
 * Token validation interface - the ONLY connection between Auth and MCP modules
 *
 * This interface abstracts how tokens are validated, allowing the MCP module
 * to work identically whether auth is internal (in-process) or external (HTTP).
 *
 * The interface mimics the OAuth 2.0 Token Introspection endpoint (RFC 7662)
 * to maintain consistency between internal and external modes.
 */

import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthModule } from '../modules/auth/index.js';

/**
 * Token introspection response per RFC 7662
 * https://datatracker.ietf.org/doc/html/rfc7662
 */
export interface TokenIntrospectionResponse {
  active: boolean;
  client_id?: string;
  scope?: string;
  exp?: number;
  sub?: string;
  aud?: string | string[];
  username?: string;
  token_type?: string;
  iss?: string;
  nbf?: number;
  iat?: number;
}

/**
 * Token validator interface
 */
export interface ITokenValidator {
  /**
   * Validates a token and returns introspection data
   * Mimics the /introspect endpoint behavior
   */
  introspect(token: string): Promise<TokenIntrospectionResponse>;

  /**
   * For MCP SDK compatibility - converts introspection to AuthInfo
   */
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

/**
 * Base validator with shared logic for converting introspection to AuthInfo
 */
abstract class BaseTokenValidator implements ITokenValidator {
  abstract introspect(token: string): Promise<TokenIntrospectionResponse>;

  /**
   * Convert introspection response to MCP SDK AuthInfo format
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const result = await this.introspect(token);

    if (!result.active) {
      throw new InvalidTokenError('Token is not active');
    }

    // Validate token hasn't expired
    if (result.exp && result.exp < Date.now() / 1000) {
      throw new InvalidTokenError('Token has expired');
    }

    return {
      token,
      clientId: result.client_id || 'unknown',
      scopes: result.scope?.split(' ') || [],
      expiresAt: result.exp,
      extra: {
        userId: result.sub || 'unknown',
        audience: result.aud,
        username: result.username,
        issuer: result.iss
      }
    };
  }
}

/**
 * External token validator - validates tokens via HTTP to external auth server
 * Used when AUTH_MODE=external
 */
export class ExternalTokenValidator extends BaseTokenValidator {
  // Cache tokens for 60 seconds to reduce auth server load
  private cache = new Map<string, {
    result: TokenIntrospectionResponse;
    expiresAt: number;
  }>();

  constructor(private authServerUrl: string) {
    super();

    // Clean up expired cache entries every minute
    setInterval(() => this.cleanupCache(), 60 * 1000);
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    // Check cache first
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      // Call external auth server's introspection endpoint
      const response = await fetch(`${this.authServerUrl}/introspect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `token=${encodeURIComponent(token)}`
      });

      if (!response.ok) {
        console.error(`Token introspection failed: ${response.status} ${response.statusText}`);
        return { active: false };
      }

      const result = await response.json() as TokenIntrospectionResponse;

      // Cache successful introspections for 60 seconds
      if (result.active) {
        const cacheDuration = 60 * 1000; // 60 seconds
        this.cache.set(token, {
          result,
          expiresAt: Date.now() + cacheDuration
        });
      }

      return result;

    } catch (error) {
      console.error('Failed to introspect token:', error);
      // Treat network errors as invalid token
      return { active: false };
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [token, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(token);
      }
    }
  }
}

/**
 * Internal token validator - validates tokens via direct method call
 * Used when AUTH_MODE=internal
 *
 * IMPORTANT: Even though auth is running in-process, we still go through
 * the introspection interface to maintain architectural separation.
 * The auth module is a stand-in for an external OAuth server.
 */
export class InternalTokenValidator extends BaseTokenValidator {
  constructor(private authModule: AuthModule) {
    super();
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    // Direct method call instead of HTTP, but returns same format
    // This maintains the separation - auth module is still "external"
    // architecturally, just running in the same process for convenience
    return this.authModule.introspectToken(token);
  }
}