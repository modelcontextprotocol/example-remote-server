import { Response } from "express";
import { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { MockRedisClient, setRedisClient } from "../redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "../types.js";
import { EverythingAuthProvider, EverythingOAuthClientsStore } from "./provider.js";
import * as authService from "../services/auth.js";

// Create mocks for the auth service functions
jest.mock("../services/auth.js", () => {
  // Use actual implementations for some functions
  const originalModule = jest.requireActual("../services/auth.js");

  return {
    ...originalModule,
    exchangeToken: jest.fn(),
    generateToken: jest.fn(),
    getClientRegistration: jest.fn(),
    readMcpInstallation: jest.fn(),
    readPendingAuthorization: jest.fn(),
    readRefreshToken: jest.fn(),
    revokeMcpInstallation: jest.fn(),
    saveClientRegistration: jest.fn(),
    savePendingAuthorization: jest.fn(),
    saveMcpInstallation: jest.fn(),
    generateMcpTokens: jest.fn(),
    saveRefreshToken: jest.fn(),
  };
});

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
    json: jest.fn().mockReturnThis()
  };
  return res as unknown as jest.Mocked<Response>;
}


function getMockAuthValues() {
  const client = createTestClient();
  const accessToken = "test-access-token";
  const newTokens: OAuthTokens = {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
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
      refresh_token: "test-refresh-token",
      expires_in: 3600,
    },
    clientId: client.client_id,
    issuedAt: Date.now() / 1000,
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
    jest.resetAllMocks();
    clientsStore = new EverythingOAuthClientsStore();
  });
  
  describe("getClient", () => {
    it("returns undefined for non-existent client", async () => {
      (authService.getClientRegistration as jest.Mock).mockResolvedValueOnce(undefined);
      
      const result = await clientsStore.getClient("non-existent");
      
      expect(result).toBeUndefined();
      expect(authService.getClientRegistration).toHaveBeenCalledWith("non-existent");
    });
    
    it("returns client information for existing client", async () => {
      const client = createTestClient();
      (authService.getClientRegistration as jest.Mock).mockResolvedValueOnce(client);
      
      const result = await clientsStore.getClient(client.client_id);
      
      expect(result).toEqual(client);
      expect(authService.getClientRegistration).toHaveBeenCalledWith(client.client_id);
    });
  });
  
  describe("registerClient", () => {
    it("saves and returns client information", async () => {
      const client = createTestClient();
      (authService.saveClientRegistration as jest.Mock).mockResolvedValueOnce(undefined);
      
      const result = await clientsStore.registerClient(client);
      
      expect(result).toEqual(client);
      expect(authService.saveClientRegistration).toHaveBeenCalledWith(client.client_id, client);
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
    
    // Set up token generator mock
    (authService.generateToken as jest.Mock).mockImplementation(() => "mock-token");
    
    provider = new EverythingAuthProvider();
  });
  
  describe("authorize", () => {
    it("saves pending authorization and redirects to upstream install", async () => {
      const client = createTestClient();
      // Use a type assertion to make TypeScript ignore the mismatch
      const params = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
      } as unknown as AuthorizationParams;
      const res = createMockResponse();
      
      await provider.authorize(client, params, res);
      
      // Verify pending authorization is saved
      expect(authService.savePendingAuthorization).toHaveBeenCalledWith("mock-token", {
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: "S256",
        clientId: client.client_id,
      });
      
      // Verify redirect to upstream installation
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("/fakeupstreamauth/authorize?metadata=mock-token"));
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
      
      (authService.readPendingAuthorization as jest.Mock).mockResolvedValueOnce(pendingAuth);
      
      const result = await provider.challengeForAuthorizationCode(client, "test-code");
      
      expect(result).toBe("test-challenge");
      expect(authService.readPendingAuthorization).toHaveBeenCalledWith("test-code");
    });
    
    it("throws error for non-existent authorization code", async () => {
      const client = createTestClient();
      
      (authService.readPendingAuthorization as jest.Mock).mockResolvedValueOnce(undefined);
      
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
      
      (authService.readPendingAuthorization as jest.Mock).mockResolvedValueOnce(pendingAuth);
      
      await expect(provider.challengeForAuthorizationCode(client, "test-code"))
        .rejects
        .toThrow("Authorization code does not match client");
    });
  });
  
  describe("exchangeAuthorizationCode", () => {
    it("returns tokens when exchange is successful", async () => {
      const client = createTestClient();
      const tokenData: TokenExchange = {
        mcpAccessToken: "test-access-token",
        alreadyUsed: false,
      };
      const { mcpInstallation } = getMockAuthValues();
      
      (authService.exchangeToken as jest.Mock).mockResolvedValueOnce(tokenData);
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(mcpInstallation);
      
      const result = await provider.exchangeAuthorizationCode(client, "test-code");
      
      expect(result).toEqual({
        access_token: tokenData.mcpAccessToken,
        expires_in: mcpInstallation.mcpTokens.expires_in,
        refresh_token: mcpInstallation.mcpTokens.refresh_token,
        token_type: "Bearer",
      });
      expect(authService.exchangeToken).toHaveBeenCalledWith("test-code");
    });
    
    it("throws error for invalid authorization code", async () => {
      const client = createTestClient();
      
      (authService.exchangeToken as jest.Mock).mockResolvedValueOnce(undefined);
      
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
        newTokens,
        mcpInstallation,
      } = getMockAuthValues();

      
      // Mock service calls
      (authService.readRefreshToken as jest.Mock).mockResolvedValueOnce(accessToken);
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(mcpInstallation);
      (authService.generateMcpTokens as jest.Mock).mockReturnValueOnce(newTokens);
      
      const result = await provider.exchangeRefreshToken(client, "test-refresh-token");
      
      expect(result).toEqual(newTokens);
      expect(authService.readRefreshToken).toHaveBeenCalledWith("test-refresh-token");
      expect(authService.readMcpInstallation).toHaveBeenCalledWith(accessToken);
      expect(authService.saveRefreshToken).toHaveBeenCalledWith(newTokens.refresh_token, newTokens.access_token);
      expect(authService.saveMcpInstallation).toHaveBeenCalledWith(
        newTokens.access_token, 
        expect.objectContaining({
          ...mcpInstallation,
          mcpTokens: newTokens,
          issuedAt: expect.any(Number),
        })
      );
    });
    
    it("throws error for invalid refresh token", async () => {
      const client = createTestClient();
      
      (authService.readRefreshToken as jest.Mock).mockResolvedValueOnce(undefined);
      
      await expect(provider.exchangeRefreshToken(client, "test-refresh-token"))
        .rejects
        .toThrow("Invalid refresh token");
    });
    
    it("throws error for refresh token with no installation", async () => {
      const client = createTestClient();
      
      (authService.readRefreshToken as jest.Mock).mockResolvedValueOnce("test-access-token");
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(undefined);
      
      await expect(provider.exchangeRefreshToken(client, "test-refresh-token"))
        .rejects
        .toThrow("Invalid refresh token");
    });
    
    it("throws error when client ID doesn't match", async () => {
      const client = createTestClient();
      const accessToken = "test-access-token";
      
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
      };
      
      (authService.readRefreshToken as jest.Mock).mockResolvedValueOnce(accessToken);
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(mcpInstallation);
      
      await expect(provider.exchangeRefreshToken(client, "test-refresh-token"))
        .rejects
        .toThrow("Invalid client");
    });

    it("works correctly even when the refresh token has expired from Redis", async () => {
      const client = createTestClient();
      
      // Simulate the refresh token not being found in Redis (expired)
      (authService.readRefreshToken as jest.Mock).mockResolvedValueOnce(undefined);
      
      await expect(provider.exchangeRefreshToken(client, "expired-refresh-token"))
        .rejects
        .toThrow("Invalid refresh token");
      
      expect(authService.readRefreshToken).toHaveBeenCalledWith("expired-refresh-token");
      // Should not proceed to check the installation since the refresh token lookup failed
      expect(authService.readMcpInstallation).not.toHaveBeenCalled();
    });
  });
  
  describe("verifyAccessToken", () => {
    it("returns auth info for valid token", async () => {
      const accessToken = "test-access-token";
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
      };
      
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(mcpInstallation);
      
      const result = await provider.verifyAccessToken(accessToken);
      
      expect(result).toEqual({
        token: accessToken,
        clientId: mcpInstallation.clientId,
        scopes: ['mcp'],
        expiresAt: mcpInstallation.mcpTokens.expires_in! + mcpInstallation.issuedAt,
      });
    });
    
    it("throws error for invalid token", async () => {
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(undefined);
      
      await expect(provider.verifyAccessToken("invalid-token"))
        .rejects
        .toThrow("Invalid access token");
    });
    
    it("throws InvalidTokenError for expired token", async () => {
      const accessToken = "test-access-token";
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
      };
      
      (authService.readMcpInstallation as jest.Mock).mockResolvedValueOnce(mcpInstallation);
      
      await expect(provider.verifyAccessToken(accessToken))
        .rejects
        .toThrow(InvalidTokenError);
    });
  });
  
  describe("revokeToken", () => {
    it("calls revokeMcpInstallation with token", async () => {
      const client = createTestClient();
      const request: OAuthTokenRevocationRequest = {
        token: "test-token",
        token_type_hint: "access_token"
      };
      
      await provider.revokeToken(client, request);
      
      expect(authService.revokeMcpInstallation).toHaveBeenCalledWith(request.token);
    });
  });
});