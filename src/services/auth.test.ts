import { jest } from '@jest/globals';
import crypto from "crypto";
import {
  decryptString,
  exchangeToken,
  generateMcpTokens,
  generatePKCEChallenge,
  generateToken,
  getClientRegistration,
  readMcpInstallation,
  readPendingAuthorization,
  readRefreshToken,
  revokeMcpInstallation,
  saveClientRegistration,
  saveMcpInstallation,
  savePendingAuthorization,
  saveRefreshToken,
  saveTokenExchange,
} from "./auth.js";
import { MockRedisClient, setRedisClient } from "../redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "../types.js";
import { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";


describe("auth utils", () => {
  let mockRedis: MockRedisClient;

  beforeEach(() => {
    mockRedis = new MockRedisClient();
    setRedisClient(mockRedis);
    
    jest.resetAllMocks();
  });

  describe("generateToken", () => {
    it("generates a 64-character hex string", () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates unique tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("generateMcpTokens", () => {
    it("generates valid token structure", () => {
      const tokens = generateMcpTokens();
      
      expect(tokens.access_token).toBeDefined();
      expect(tokens.access_token).toMatch(/^[0-9a-f]{64}$/);
      
      expect(tokens.refresh_token).toBeDefined();
      expect(tokens.refresh_token).toMatch(/^[0-9a-f]{64}$/);
      
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.expires_in).toBeDefined();
    });
    
    it("generates unique tokens", () => {
      const tokens1 = generateMcpTokens();
      const tokens2 = generateMcpTokens();
      
      expect(tokens1.access_token).not.toBe(tokens2.access_token);
      expect(tokens1.refresh_token).not.toBe(tokens2.refresh_token);
    });
  });

  describe("client registration", () => {
    it("saves and retrieves client registration", async () => {
      const clientId = "test-client-id";
      const registration: OAuthClientInformationFull = {
        client_id: clientId,
        client_name: "Test Client",
        client_uri: "https://example.com",
        redirect_uris: ["https://example.com/callback"]
      };
      
      await saveClientRegistration(clientId, registration);
      const retrieved = await getClientRegistration(clientId);
      
      expect(retrieved).toEqual(registration);
    });
    
    it("returns undefined for non-existent client", async () => {
      const result = await getClientRegistration("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("pending authorization", () => {
    it("saves and retrieves pending authorization", async () => {
      const authCode = generateToken();
      const pendingAuth: PendingAuthorization = {
        redirectUri: "https://example.com/callback",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
        clientId: "test-client-id"
      };
      
      await savePendingAuthorization(authCode, pendingAuth);
      const retrieved = await readPendingAuthorization(authCode);
      
      expect(retrieved).toEqual(pendingAuth);
    });
    
    it("returns undefined for non-existent code", async () => {
      const result = await readPendingAuthorization("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("token exchange", () => {
    it("saves and retrieves token exchange data", async () => {
      const authCode = generateToken();
      const tokenExchange: TokenExchange = {
        mcpAccessToken: generateToken(),
        alreadyUsed: false
      };
      
      // For this test, we'll directly manipulate Redis to check the token
      // instead of using exchangeToken which changes the value
      await saveTokenExchange(authCode, tokenExchange);
      
      // Get the key used by saveTokenExchange (now with auth: prefix)
      const key = "auth:exch:" + crypto.createHash("sha256").update(authCode).digest("hex");
      
      // Get the encrypted data
      const encryptedData = await mockRedis.get(key);
      expect(encryptedData).not.toBeNull();
      
      // Decrypt it manually to verify
      const decoded = JSON.parse(decryptString({
        encryptedText: encryptedData!,
        key: authCode
      }));
      
      expect(decoded).toEqual(tokenExchange);
    });
    
    it("prevents duplicate token exchange", async () => {
      const authCode = generateToken();
      const tokenExchange: TokenExchange = {
        mcpAccessToken: generateToken(),
        alreadyUsed: false
      };
      
      await saveTokenExchange(authCode, tokenExchange);
      
      // First exchange succeeds
      const first = await exchangeToken(authCode);
      expect(first).toBeDefined();
      
      // Mock console.error to suppress expected error message
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Second exchange throws
      await expect(exchangeToken(authCode)).rejects.toThrow(
        "Duplicate use of authorization code detected"
      );
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
    
    it("returns undefined for non-existent code", async () => {
      const result = await exchangeToken("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("MCP installation", () => {
    it("returns undefined for missing tokens", async () => {
      const accessToken = generateToken();
      const result = await readMcpInstallation(accessToken);
      expect(result).toBeUndefined();
    });

    it("saves and retrieves installation data", async () => {
      const accessToken = generateToken();

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
      }

      await saveMcpInstallation(accessToken, mcpInstallation);

      const result = await readMcpInstallation(accessToken);
      expect(result).toEqual(mcpInstallation);
    });
  });

  describe("refresh token", () => {
    it("saves and retrieves refresh token mapping", async () => {
      const refreshToken = generateToken();
      const accessToken = generateToken();
      
      await saveRefreshToken(refreshToken, accessToken);
      const retrieved = await readRefreshToken(refreshToken);
      
      expect(retrieved).toBe(accessToken);
    });
    
    it("returns undefined for non-existent refresh token", async () => {
      const result = await readRefreshToken("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("revokeMcpInstallation", () => {
    it("revokes token for valid installation", async () => {
      // For this test, we'll simply test if the WebClient is called with our mocked token
      
      // Create mock installation
      const accessToken = generateToken();
      
      // Save it to Redis with actual function
      await saveMcpInstallation(accessToken, {
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
      });
      
      const getDel = jest.spyOn(mockRedis, 'getDel').mockImplementationOnce(() => {
        // Need to return encrypted data for successful decryption in the revoke function
        // Create encrypted data using our access token
        const mcpInstallation = {
          mcpTokens: {
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 3600,
          },
          clientId: "client-id",
          issuedAt: Date.now() / 1000,
    userId: "test-user-id",
        };
        const value = JSON.stringify(mcpInstallation);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(accessToken, "hex"), iv);
        let encrypted = cipher.update(value, "utf-8", "hex");
        encrypted += cipher.final("hex");
        return Promise.resolve(`${iv.toString("hex")}:${encrypted}`);
      });

      await revokeMcpInstallation(accessToken);
      
      // Should have called getDel with the correct key (now auth:installation:)
      expect(getDel).toHaveBeenCalledWith(expect.stringContaining("auth:installation:"));
      
    });
    
    it("handles non-existent installation without error", async () => {
      await expect(revokeMcpInstallation("non-existent")).resolves.not.toThrow();
    });
  });

  describe("generatePKCEChallenge", () => {
    it("generates base64url-encoded SHA256 hash", () => {
      const verifier = "test_verifier";
      const challenge = generatePKCEChallenge(verifier);
      expect(challenge).toBe("0Ku4rR8EgR1w3HyHLBCxVLtPsAAks5HOlpmTEt0XhVA");
    });

    it("generates different challenges for different verifiers", () => {
      const challenge1 = generatePKCEChallenge("verifier1");
      const challenge2 = generatePKCEChallenge("verifier2");
      expect(challenge1).not.toBe(challenge2);
    });
  });
});