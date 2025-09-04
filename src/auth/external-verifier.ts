import { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { TokenIntrospectionResponse } from '../../shared/types.js';
import { logger } from '../utils/logger.js';

/**
 * Token verifier that validates tokens with an external authorization server.
 * Used when the MCP server is running in 'separate' mode.
 */
export class ExternalAuthVerifier implements OAuthTokenVerifier {
  /**
   * Creates a new external auth verifier.
   * @param authServerUrl Base URL of the external authorization server
   */
  constructor(private authServerUrl: string) {}
  
  /**
   * Verifies an access token by calling the external auth server's introspection endpoint.
   * @param token The access token to verify
   * @returns Authentication information if the token is valid
   * @throws InvalidTokenError if the token is invalid or expired
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Token introspection is OAuth 2.0 standard (RFC 7662) for validating tokens
      // The auth server checks if the token is valid and returns metadata about it
      const response = await fetch(`${this.authServerUrl}/oauth/introspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
      });
      
      if (!response.ok) {
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
      
      // Extract user ID from standard 'sub' claim or custom 'userId' field
      const userId = data.sub || data.userId;
      if (!userId) {
        logger.info('Token introspection response missing user ID', {
          hasSub: !!data.sub,
          hasUserId: !!data.userId,
        });
      }
      
      return {
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