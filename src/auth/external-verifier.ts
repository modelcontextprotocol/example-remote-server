import { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { TokenIntrospectionResponse } from '../../shared/types.js';
import { logger } from '../utils/logger.js';
import { BASE_URI } from '../config.js';

/**
 * Token verifier that validates tokens with an external authorization server.
 * Used when the MCP server is running in 'separate' mode.
 */
export class ExternalAuthVerifier implements OAuthTokenVerifier {
  // Token validation cache: token -> { authInfo, expiresAt }
  private tokenCache = new Map<string, { authInfo: AuthInfo; expiresAt: number }>();

  // Default cache TTL: 60 seconds (conservative for security)
  private readonly defaultCacheTTL = 60 * 1000; // milliseconds

  // The canonical URI of this MCP server for audience validation
  private readonly canonicalUri: string;

  /**
   * Creates a new external auth verifier.
   * @param authServerUrl Base URL of the external authorization server
   * @param canonicalUri Optional canonical URI for audience validation (defaults to BASE_URI)
   */
  constructor(private authServerUrl: string, canonicalUri?: string) {
    this.canonicalUri = canonicalUri || BASE_URI;
    // Periodically clean up expired cache entries
    setInterval(() => this.cleanupCache(), 60 * 1000); // Every minute
  }
  
  /**
   * Removes expired entries from the cache.
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [token, entry] of this.tokenCache.entries()) {
      if (entry.expiresAt <= now) {
        this.tokenCache.delete(token);
      }
    }
  }
  
  /**
   * Verifies an access token by calling the external auth server's introspection endpoint.
   * @param token The access token to verify
   * @returns Authentication information if the token is valid
   * @throws InvalidTokenError if the token is invalid or expired
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Check cache first
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Token validation cache hit', { 
        token: token.substring(0, 8) + '...',
        expiresIn: Math.round((cached.expiresAt - Date.now()) / 1000) + 's'
      });
      return cached.authInfo;
    }
    
    try {
      // Token introspection is OAuth 2.0 standard (RFC 7662) for validating tokens
      // The auth server checks if the token is valid and returns metadata about it
      const response = await fetch(`${this.authServerUrl}/introspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
      });
      
      if (!response.ok) {
        // On 401/403, the token might be invalid - don't cache
        if (response.status === 401 || response.status === 403) {
          this.tokenCache.delete(token); // Clear any stale cache
        }
        logger.error('Token introspection request failed', undefined, {
          status: response.status,
          statusText: response.statusText,
        });
        throw new InvalidTokenError('Token validation failed');
      }
      
      const data: TokenIntrospectionResponse = await response.json();
      
      // Check if token is active
      if (!data.active) {
        throw new InvalidTokenError('Token is not active');
      }
      
      // Check if token is expired
      if (data.exp && data.exp < Date.now() / 1000) {
        throw new InvalidTokenError('Token has expired');
      }

      // Validate audience (aud) claim to ensure token is for this MCP server
      // According to MCP spec, servers MUST validate that tokens were issued specifically for them
      if (data.aud) {
        const audiences = Array.isArray(data.aud) ? data.aud : [data.aud];
        if (!audiences.includes(this.canonicalUri)) {
          logger.error('Token audience mismatch', undefined, {
            expectedAudience: this.canonicalUri,
            actualAudience: data.aud,
          });
          throw new InvalidTokenError('Token was not issued for this resource server');
        }
      } else {
        // Log warning if no audience claim present (permissive for backwards compatibility)
        logger.info('Token introspection response missing audience claim', {
          warning: true,
          tokenSub: data.sub,
          clientId: data.client_id,
        });
      }

      // Validate token is not used before its 'not before' time (nbf) if present
      if (data.nbf && data.nbf > Date.now() / 1000) {
        throw new InvalidTokenError('Token is not yet valid (nbf)');
      }

      // Validate token was issued in the past (iat) if present
      if (data.iat && data.iat > Date.now() / 1000 + 60) { // Allow 60s clock skew
        throw new InvalidTokenError('Token issued in the future (iat)');
      }

      // Extract user ID from standard 'sub' claim or custom 'userId' field
      const userId = data.sub || data.userId;
      if (!userId) {
        logger.info('Token introspection response missing user ID', {
          hasSub: !!data.sub,
          hasUserId: !!data.userId,
        });
      }
      
      const authInfo: AuthInfo = {
        token,
        clientId: data.client_id || 'unknown',
        scopes: data.scope?.split(' ') || [], // Empty array if no scopes specified (permissive)
        expiresAt: data.exp,
        extra: {
          userId: userId || 'unknown',
          // Include other potentially useful fields
          username: data.username,
          iss: data.iss,
          aud: data.aud,
        },
      };
      
      // Cache the successful introspection result
      // Use token expiration if available, otherwise default TTL
      const cacheDuration = data.exp 
        ? Math.min((data.exp * 1000) - Date.now(), this.defaultCacheTTL)
        : this.defaultCacheTTL;
      
      if (cacheDuration > 0) {
        this.tokenCache.set(token, {
          authInfo,
          expiresAt: Date.now() + cacheDuration
        });
        
        logger.debug('Token validation cached', {
          token: token.substring(0, 8) + '...',
          cacheDuration: Math.round(cacheDuration / 1000) + 's'
        });
      }
      
      return authInfo;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw error;
      }
      
      logger.error('Failed to verify token with external auth server', error as Error, {
        authServerUrl: this.authServerUrl,
      });
      
      // Network or other errors should be treated as invalid token
      // to prevent access with unverifiable tokens
      throw new InvalidTokenError('Unable to verify token');
    }
  }
}