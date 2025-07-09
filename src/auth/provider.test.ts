import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { Response } from "express";
import { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { MockRedisClient, setRedisClient } from "../redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "../types.js";
import { EverythingAuthProvider, EverythingOAuthClientsStore } from "./provider.js";
import * as authService from "../services/auth.js";

// Helper function to create sample client
function createTestClient(): OAuthClientInformationFull {
  return {
    client_id: "test-client-id",
    client_name: "Test Client",
    client_uri: "https://example.com",
    redirect_uris: ["https://example.com/callback"]
  };
}

// Helper function to create a mock Response object
function createMockResponse() {
  const res = {
    redirect: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis()
  };
  return res as unknown as jest.Mocked<Response>;
}


function getMockAuthValues() {
  const client = createTestClient();
  // Use properly generated tokens for encryption
  const accessToken = authService.generateToken();
  const newTokens: OAuthTokens = {
    access_token: authService.generateToken(),
    refresh_token: authService.generateToken(),
    token_type: "bearer",
    expires_in: 3600,
  };
  const mcpInstallation: McpInstallation = {
    fakeUpstreamInstallation: {
      fakeAccessTokenForDemonstration: "fake-upstream-access-token",
      fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
    },
    mcpTokens: {
      access_token: accessToken,
      token_type: "Bearer",
      refresh_token: authService.generateToken(),
      expires_in: 3600,
    },
    clientId: client.client_id,
    issuedAt: Date.now() / 1000,
    userId: "test-user-id",
  };

  return {
    client,
    accessToken,
    newTokens,
    mcpInstallation,
  }
}

describe("EverythingOAuthClientsStore", () => {
  let clientsStore: EverythingOAuthClientsStore;
  
  beforeEach(() => {
    const mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    jest.resetAllMocks();
    clientsStore = new EverythingOAuthClientsStore();
  });
  
  describe("getClient", () => {
    it("returns undefined for non-existent client", async () => {
      const result = await clientsStore.getClient("non-existent");
      expect(result).toBeUndefined();
    });
    
    it("returns client information for existing client", async () => {
      const client = createTestClient();
      // First save the client
      await clientsStore.registerClient(client);
      
      // Then retrieve it
      const result = await clientsStore.getClient(client.client_id);
      
      expect(result).toEqual(client);
    });
  });
  
  describe("registerClient", () => {
    it("saves and returns client information", async () => {
      const client = createTestClient();
      
      const result = await clientsStore.registerClient(client);
      
      expect(result).toEqual(client);
      
      // Verify it was saved
      const retrieved = await clientsStore.getClient(client.client_id);
      expect(retrieved).toEqual(client);
    });
  });
});

describe("EverythingAuthProvider", () => {
  let provider: EverythingAuthProvider;
  let mockRedis: MockRedisClient;
  
  beforeEach(() => {
    jest.resetAllMocks();
    
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    
    provider = new EverythingAuthProvider();
  });
  
  describe("authorize", () => {
    it("saves pending authorization and sends HTML response", async () => {
      const client = createTestClient();
      // Use a type assertion to make TypeScript ignore the mismatch
      const params = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
      } as unknown as AuthorizationParams;
      const res = createMockResponse();
      
      await provider.authorize(client, params, res);
      
      // Verify HTML sent with redirect
      expect(res.send).toHaveBeenCalled();
      const sentHtml = (res.send as jest.Mock).mock.calls[0][0];
      expect(sentHtml).toContain('MCP Server Authorization');
      expect(sentHtml).toContain('Authorization Required');
      expect(sentHtml).toContain('fakeupstreamauth/authorize?redirect_uri=/fakeupstreamauth/callback&state=');
    });
  });
  
  describe("challengeForAuthorizationCode", () => {
    it("returns code challenge for valid authorization code", async () => {
      const client = createTestClient();
      const pendingAuth: PendingAuthorization = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
        clientId: client.client_id,
      };
      
      // First save the pending authorization
      const authCode = authService.generateToken();
      await authService.savePendingAuthorization(authCode, pendingAuth);
      
      const result = await provider.challengeForAuthorizationCode(client, authCode);
      
      expect(result).toBe("test-challenge");
    });
    
    it("throws error for non-existent authorization code", async () => {
      const client = createTestClient();
      
      await expect(provider.challengeForAuthorizationCode(client, "test-code"))
        .rejects
        .toThrow("Authorization code not found");
    });
    
    it("throws error when client ID doesn't match", async () => {
      const client = createTestClient();
      const pendingAuth: PendingAuthorization = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
        clientId: "different-client-id",
      };
      
      // Save pending auth with different client ID
      const authCode = authService.generateToken();
      await authService.savePendingAuthorization(authCode, pendingAuth);
      
      await expect(provider.challengeForAuthorizationCode(client, authCode))
        .rejects
        .toThrow("Authorization code does not match client");
    });
  });
  
  describe("exchangeAuthorizationCode", () => {
    it("returns tokens when exchange is successful", async () => {
      const client = createTestClient();
      const { mcpInstallation } = getMockAuthValues();
      
      // Setup: save token exchange and installation
      const authCode = authService.generateToken();
      const tokenExchange: TokenExchange = {
        mcpAccessToken: mcpInstallation.mcpTokens.access_token,
        alreadyUsed: false,
      };
      await authService.saveTokenExchange(authCode, tokenExchange);
      await authService.saveMcpInstallation(mcpInstallation.mcpTokens.access_token, mcpInstallation);
      
      const result = await provider.exchangeAuthorizationCode(client, authCode);
      
      expect(result).toEqual({
        access_token: mcpInstallation.mcpTokens.access_token,
        expires_in: mcpInstallation.mcpTokens.expires_in,
        refresh_token: mcpInstallation.mcpTokens.refresh_token,
        token_type: "Bearer",
      });
    });
    
    it("throws error for invalid authorization code", async () => {
      const client = createTestClient();
      
      await expect(provider.exchangeAuthorizationCode(client, "test-code"))
        .rejects
        .toThrow("Invalid authorization code");
    });
  });
  
  describe("exchangeRefreshToken", () => {
    it("returns new tokens when refresh token is valid", async () => {
      const {
        client,
        accessToken,
        mcpInstallation,
      } = getMockAuthValues();
      
      // Setup: save refresh token and installation
      const refreshToken = authService.generateToken();
      await authService.saveRefreshToken(refreshToken, accessToken);
      await authService.saveMcpInstallation(accessToken, mcpInstallation);
      
      const result = await provider.exchangeRefreshToken(client, refreshToken);
      
      // Should return new tokens
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('expires_in', 3600);
      expect(result).toHaveProperty('token_type', 'Bearer');
    });
    
    it("throws error for invalid refresh token", async () => {
      const client = createTestClient();
      
      await expect(provider.exchangeRefreshToken(client, "test-refresh-token"))
        .rejects
        .toThrow("Invalid refresh token");
    });
    
    it("throws error for refresh token with no installation", async () => {
      const client = createTestClient();
      const refreshToken = authService.generateToken();
      const accessToken = authService.generateToken();
      
      // Only save refresh token, not the installation
      await authService.saveRefreshToken(refreshToken, accessToken);
      
      await expect(provider.exchangeRefreshToken(client, refreshToken))
        .rejects
        .toThrow("Invalid refresh token");
    });
    
    it("throws error when client ID doesn't match", async () => {
      const client = createTestClient();
      const accessToken = authService.generateToken();
      const refreshToken = authService.generateToken();
      
      const mcpInstallation: McpInstallation = {
        fakeUpstreamInstallation: {
          fakeAccessTokenForDemonstration: "fake-upstream-access-token",
          fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
        },
        mcpTokens: {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
        },
        clientId: "different-client-id",
        issuedAt: Date.now() / 1000,
    userId: "test-user-id",
      };
      
      await authService.saveRefreshToken(refreshToken, accessToken);
      await authService.saveMcpInstallation(accessToken, mcpInstallation);
      
      await expect(provider.exchangeRefreshToken(client, refreshToken))
        .rejects
        .toThrow("Invalid client");
    });

    it("works correctly even when the refresh token has expired from Redis", async () => {
      const client = createTestClient();
      
      // Simulate the refresh token not being found in Redis (expired)
      await expect(provider.exchangeRefreshToken(client, "expired-refresh-token"))
        .rejects
        .toThrow("Invalid refresh token");
    });
  });
  
  describe("verifyAccessToken", () => {
    it("returns auth info for valid token", async () => {
      const accessToken = authService.generateToken();
      const mcpInstallation: McpInstallation = {
        fakeUpstreamInstallation: {
          fakeAccessTokenForDemonstration: "fake-upstream-access-token",
          fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
        },
        mcpTokens: {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
        },
        clientId: "client-id",
        issuedAt: Date.now() / 1000,
    userId: "test-user-id",
      };
      
      await authService.saveMcpInstallation(accessToken, mcpInstallation);
      
      const result = await provider.verifyAccessToken(accessToken);
      
      expect(result).toEqual({
        token: accessToken,
        clientId: mcpInstallation.clientId,
        scopes: ['mcp'],
        expiresAt: mcpInstallation.mcpTokens.expires_in! + mcpInstallation.issuedAt,
        extra: {
          userId: "test-user-id"
        }
      });
    });
    
    it("throws error for invalid token", async () => {
      await expect(provider.verifyAccessToken("invalid-token"))
        .rejects
        .toThrow("Invalid access token");
    });
    
    it("throws InvalidTokenError for expired token", async () => {
      const accessToken = authService.generateToken();
      const oneDayInSeconds = 24 * 60 * 60;
      const twoDaysAgoInSeconds = Math.floor(Date.now() / 1000) - (2 * oneDayInSeconds);
      
      const mcpInstallation: McpInstallation = {
        fakeUpstreamInstallation: {
          fakeAccessTokenForDemonstration: "fake-upstream-access-token",
          fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
        },
        mcpTokens: {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: oneDayInSeconds,
        },
        clientId: "client-id",
        issuedAt: twoDaysAgoInSeconds, // 2 days ago, with 1-day expiry
        userId: "test-user-id",
      };
      
      await authService.saveMcpInstallation(accessToken, mcpInstallation);
      
      await expect(provider.verifyAccessToken(accessToken))
        .rejects
        .toThrow(InvalidTokenError);
    });
  });
  
  describe("revokeToken", () => {
    it("revokes the installation when given an access token", async () => {
      const client = createTestClient();
      const accessToken = authService.generateToken();
      const mcpInstallation: McpInstallation = {
        fakeUpstreamInstallation: {
          fakeAccessTokenForDemonstration: "fake-upstream-access-token",
          fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
        },
        mcpTokens: {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
        },
        clientId: client.client_id,
        issuedAt: Date.now() / 1000,
    userId: "test-user-id",
      };
      
      // Save the installation
      await authService.saveMcpInstallation(accessToken, mcpInstallation);
      
      // Verify it exists
      const saved = await authService.readMcpInstallation(accessToken);
      expect(saved).toBeTruthy();
      
      // Revoke it
      const request: OAuthTokenRevocationRequest = {
        token: accessToken,
        token_type_hint: "access_token"
      };
      
      await provider.revokeToken(client, request);
      
      // Verify it was revoked
      const revoked = await authService.readMcpInstallation(accessToken);
      expect(revoked).toBeUndefined();
    });
  });
});