import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  exchangeToken,
  generateToken,
  getClientRegistration,
  readPendingAuthorization,
  readMcpInstallation,
  revokeMcpInstallation,
  saveClientRegistration,
  savePendingAuthorization,
  readRefreshToken,
  generateMcpTokens,
  saveMcpInstallation,
  saveRefreshToken,
} from '../services/auth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Implementation of the OAuthRegisteredClientsStore interface using the existing client registration system
 */
export class EverythingOAuthClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const registration = await getClientRegistration(clientId);
    if (!registration) {
      return undefined;
    }
    return registration;
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    await saveClientRegistration(client.client_id, client);
    return client;
  }
}

/**
 * Implementation of the OAuthServerProvider interface for upstream authentication
 */
export class EverythingAuthProvider implements OAuthServerProvider {
  private _clientsStore: EverythingOAuthClientsStore;

  constructor() {
    this._clientsStore = new EverythingOAuthClientsStore();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {

    // Client is validated by the MCP sdk.

    // Generate authorization code
    const authorizationCode = generateToken();

    // Save the pending authorization with code challenge and state
    await savePendingAuthorization(authorizationCode, {
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256', // Currently only support S256
      clientId: client.client_id,
      state: params.state,
    });

    logger.debug('Saved pending authorization', {
      authorizationCode: authorizationCode.substring(0, 8) + '...',
      clientId: client.client_id,
      state: params.state?.substring(0, 8) + '...'
    });

    // TODO: should we use a different key, other than the authorization code, to store the pending authorization?
    
    // You can redirect to another page, or you can send an html response directly
    // res.redirect(new URL(`fakeupstreamauth/authorize?metadata=${authorizationCode}`, BASE_URI).href);

    // Set permissive CSP for styling
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'"
    ].join('; '));

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>MCP Server Authorization</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              background: #000000;
              color: #ffffff;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            
            .auth-container {
              background: #ffffff;
              color: #000000;
              border-radius: 16px;
              box-shadow: 0 20px 40px rgba(255, 255, 255, 0.1);
              padding: 40px;
              max-width: 500px;
              width: 100%;
              text-align: center;
              border: 1px solid #e2e8f0;
            }
            
            .logo-container {
              margin-bottom: 32px;
            }
            
            .logo {
              width: 80px;
              height: 80px;
              margin: 0 auto 16px;
              filter: invert(1);
            }
            
            .mcp-title {
              font-size: 24px;
              font-weight: 700;
              color: #000000;
              margin-bottom: 8px;
              letter-spacing: 2px;
            }
            
            h1 {
              color: #000000;
              font-size: 32px;
              font-weight: 800;
              margin-bottom: 12px;
              line-height: 1.2;
            }
            
            .subtitle {
              color: #4a5568;
              font-size: 18px;
              margin-bottom: 32px;
              line-height: 1.5;
            }
            
            .client-info {
              background: #f8f9fa;
              border-radius: 12px;
              padding: 24px;
              margin-bottom: 32px;
              border: 2px solid #e2e8f0;
            }
            
            .client-info h3 {
              color: #2d3748;
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 16px;
            }
            
            .client-id {
              background: white;
              border: 2px solid #e2e8f0;
              border-radius: 8px;
              padding: 12px;
              font-family: 'Courier New', monospace;
              font-size: 14px;
              color: #4a5568;
              word-break: break-all;
            }
            
            .auth-flow-info {
              background: #f8f9fa;
              border-radius: 12px;
              padding: 24px;
              margin-bottom: 32px;
              border-left: 4px solid #000000;
            }
            
            .auth-flow-info h3 {
              color: #2d3748;
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 12px;
            }
            
            .auth-flow-info p {
              color: #4a5568;
              font-size: 14px;
              line-height: 1.5;
            }
            
            .btn-primary {
              background: #000000;
              color: #ffffff;
              font-size: 18px;
              font-weight: 700;
              padding: 18px 36px;
              border: none;
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s ease;
              width: 100%;
              text-decoration: none;
              display: inline-block;
              text-align: center;
              letter-spacing: 1px;
            }
            
            .btn-primary:hover {
              background: #333333;
              transform: translateY(-2px);
              box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
            }
            
            .branding {
              margin-top: 24px;
              padding-top: 24px;
              border-top: 1px solid #e2e8f0;
              color: #718096;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="auth-container">
            <div class="logo-container">
              <img src="/mcp-logo.png" alt="MCP Logo" class="logo">
              <div class="mcp-title">MCP</div>
            </div>
            
            <h1>Authorization Required</h1>
            <p class="subtitle">This client wants to connect to your MCP server</p>
            
            <div class="client-info">
              <h3>Client Application</h3>
              <div class="client-id">${client.client_id}</div>
            </div>
            
            <div class="auth-flow-info">
              <h3>What happens next?</h3>
              <p>You'll be redirected to authenticate with the upstream provider. Once verified, you'll be granted access to this MCP server's resources.</p>
            </div>
            
            <a href="/fakeupstreamauth/authorize?redirect_uri=/fakeupstreamauth/callback&state=${authorizationCode}" class="btn-primary">
              Continue to Authentication
            </a>
            
            <div class="branding">
              Model Context Protocol (MCP) Server
            </div>
          </div>
        </body>
      </html>
    `);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const pendingAuth = await readPendingAuthorization(authorizationCode);
    if (!pendingAuth) {
      throw new Error('Authorization code not found');
    }

    if (pendingAuth.clientId !== client.client_id) {
      throw new Error('Authorization code does not match client');
    }

    return pendingAuth.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const tokenData = await exchangeToken(authorizationCode);
    if (!tokenData) {
      throw new Error('Invalid authorization code');
    }

    // Get the MCP installation to retrieve the full token data including refresh token
    const mcpInstallation = await readMcpInstallation(tokenData.mcpAccessToken);
    if (!mcpInstallation) {
      throw new Error('Failed to retrieve MCP installation');
    }

    // Return the full token data including refresh token
    return {
      access_token: mcpInstallation.mcpTokens.access_token,
      refresh_token: mcpInstallation.mcpTokens.refresh_token,
      expires_in: mcpInstallation.mcpTokens.expires_in,
      token_type: 'Bearer',
    };
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, _scopes?: string[]): Promise<OAuthTokens> {
    const accessToken = await readRefreshToken(refreshToken);

    if (!accessToken) {
      throw new Error('Invalid refresh token');
    }

    const mcpInstallation = await readMcpInstallation(accessToken);

    if (!mcpInstallation) {
      throw new Error('Invalid refresh token');
    }

    // Check the client_id
    if (mcpInstallation.clientId !== client.client_id) {
      throw new Error('Invalid client');
    }
    
    const newTokens = generateMcpTokens();

    if (newTokens.refresh_token) {
      await saveRefreshToken(newTokens.refresh_token, newTokens.access_token);
    }

    // Update the installation with the new tokens
    await saveMcpInstallation(newTokens.access_token, {
      ...mcpInstallation,
      mcpTokens: newTokens,
      issuedAt: Date.now() / 1000,
      userId: mcpInstallation.userId, // Preserve the user ID
    });

    return newTokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const installation = await readMcpInstallation(token);
    if (!installation) {
      throw new InvalidTokenError("Invalid access token");
    }

    const expiresAt = (
      installation.mcpTokens.expires_in
      ? installation.mcpTokens.expires_in + installation.issuedAt
      : undefined
    );

    // This can be removed once in the SDK
    // Check if the token is expired
    if (!!expiresAt && expiresAt < Date.now() / 1000) {
      throw new InvalidTokenError("Token has expired");
    }
    
    return {
      token,
      clientId: installation.clientId,
      scopes: ['mcp'],
      expiresAt,
      extra: {
        userId: installation.userId
      }
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await revokeMcpInstallation(request.token);
  }
}