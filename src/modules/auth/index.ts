/**
 * Auth Module - Self-contained authentication module
 *
 * This module encapsulates all OAuth/authentication functionality.
 * In internal mode, it runs in-process but maintains architectural separation.
 * It acts as a stand-in for an external OAuth server (Auth0, Okta, etc).
 *
 * IMPORTANT: This is NOT using the deprecated MCP SDK integrated auth pattern.
 * Even in internal mode, the auth module is architecturally separate from MCP.
 */

import { Router } from 'express';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { FeatureReferenceAuthProvider } from './auth/provider.js';
import { handleMockUpstreamAuthorize, handleMockUpstreamCallback } from './handlers/mock-upstream-idp.js';
import { TokenIntrospectionResponse } from '../../interfaces/auth-validator.js';
import { logger } from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuthConfig {
  baseUri: string;
  authServerUrl?: string; // For metadata purposes
  redisUrl?: string;
}

export class AuthModule {
  private provider: FeatureReferenceAuthProvider;
  private router: Router;

  constructor(private config: AuthConfig) {
    this.provider = new FeatureReferenceAuthProvider();
    this.router = this.setupRouter();
  }

  /**
   * Get Express router with all auth endpoints
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Direct token introspection for internal mode
   * Returns the same format as the /introspect endpoint would
   */
  async introspectToken(token: string): Promise<TokenIntrospectionResponse> {
    try {
      const authInfo = await this.provider.verifyAccessToken(token);

      // Return RFC 7662 compliant introspection response
      return {
        active: true,
        client_id: authInfo.clientId,
        scope: authInfo.scopes.join(' '),
        exp: authInfo.expiresAt,
        sub: String(authInfo.extra?.userId || 'unknown'),
        username: authInfo.extra?.username as string | undefined,
        aud: this.config.baseUri,
        iss: this.config.authServerUrl || this.config.baseUri,
        token_type: 'Bearer'
      };
    } catch (error) {
      logger.debug('Token introspection failed', { error: (error as Error).message });
      return { active: false };
    }
  }

  private setupRouter(): Router {
    const router = Router();

    // OAuth endpoints via SDK's mcpAuthRouter
    router.use(mcpAuthRouter({
      provider: this.provider,
      issuerUrl: new URL(this.config.authServerUrl || this.config.baseUri),
      tokenOptions: {
        rateLimit: { windowMs: 5000, limit: 100 }
      },
      clientRegistrationOptions: {
        rateLimit: { windowMs: 60000, limit: 10 }
      }
    }));

    // Token introspection endpoint (RFC 7662)
    // This endpoint exists for external mode compatibility
    router.post('/introspect', express.urlencoded({ extended: false }), async (req, res) => {
      try {
        const { token } = req.body;

        if (!token) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing token parameter'
          });
        }

        const result = await this.introspectToken(token);
        res.json(result);

      } catch (error) {
        logger.error('Introspection endpoint error', error as Error);
        res.json({ active: false });
      }
    });

    // Mock upstream IDP endpoints (for demo purposes)
    router.get('/mock-upstream-idp/authorize', handleMockUpstreamAuthorize);
    router.get('/mock-upstream-idp/callback', handleMockUpstreamCallback);

    // Static assets for auth pages
    router.get('/mcp-logo.png', (req, res) => {
      const logoPath = path.join(__dirname, 'static', 'mcp.png');
      res.sendFile(logoPath);
    });

    // Health check
    router.get('/auth/health', (req, res) => {
      res.json({
        status: 'healthy',
        module: 'auth',
        mode: 'internal'
      });
    });

    return router;
  }
}