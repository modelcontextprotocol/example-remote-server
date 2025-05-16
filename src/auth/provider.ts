import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BASE_URI } from '../config.js';
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

    // TODO: should we use a different key, other than the authorization code, to store the pending authorization?
    
    // You can redirect to another page, or you can send an html response directly
    // res.redirect(new URL(`fakeupstreamauth/authorize?metadata=${authorizationCode}`, BASE_URI).href);

    res.send(`
      <html>
        <head>
          <title>MCP Auth Page</title>
        </head>
        <body>
          <h1>MCP Server Auth Page</h1>
          <p>
            This page is the authorization page presented by the MCP server, routing the user upstream. This is only 
            needed on 2025-03-26 Auth spec, where the MCP server acts as it's own authoriztion server. This page should
            be present to avoid confused deputy attacks.
          </p>
          <p>
            Click <a href="/fakeupstreamauth/authorize?redirect_uri=/fakeupstreamauth/callback&state=${authorizationCode}">here</a> 
            to continue to the upstream auth
          </p>
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
      console.log('Pending auth clientId', pendingAuth.clientId);
      console.log('ClientId', client.client_id);
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
      expiresAt
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await revokeMcpInstallation(request.token);
  }
}