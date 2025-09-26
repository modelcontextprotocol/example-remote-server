import { redisClient } from "../redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "../types.js";
import { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

// Re-export from shared modules for backward compatibility
export {
  generatePKCEChallenge,
  generateToken,
  decryptString,
  generateMcpTokens
} from "../../shared/auth-core.js";

import * as sharedRedisAuth from "../../shared/redis-auth.js";

// Wrapper functions that pass redisClient to shared module functions

export async function saveClientRegistration(
  clientId: string,
  registration: OAuthClientInformationFull,
) {
  return sharedRedisAuth.saveClientRegistration(redisClient, clientId, registration);
}

export async function getClientRegistration(
  clientId: string,
): Promise<OAuthClientInformationFull | undefined> {
  return sharedRedisAuth.getClientRegistration(redisClient, clientId);
}

export async function savePendingAuthorization(
  authorizationCode: string,
  pendingAuthorization: PendingAuthorization,
) {
  return sharedRedisAuth.savePendingAuthorization(redisClient, authorizationCode, pendingAuthorization);
}

export async function readPendingAuthorization(
  authorizationCode: string,
): Promise<PendingAuthorization | undefined> {
  return sharedRedisAuth.readPendingAuthorization(redisClient, authorizationCode);
}

export async function saveMcpInstallation(
  mcpAccessToken: string,
  installation: McpInstallation,
) {
  return sharedRedisAuth.saveMcpInstallation(redisClient, mcpAccessToken, installation);
}

export async function readMcpInstallation(
  mcpAccessToken: string,
): Promise<McpInstallation | undefined> {
  return sharedRedisAuth.readMcpInstallation(redisClient, mcpAccessToken);
}

export async function saveRefreshToken(
  refreshToken: string,
  mcpAccessToken: string,
) {
  return sharedRedisAuth.saveRefreshToken(redisClient, refreshToken, mcpAccessToken);
}

export async function readRefreshToken(
  refreshToken: string,
): Promise<string | undefined> {
  return sharedRedisAuth.readRefreshToken(redisClient, refreshToken);
}

export async function revokeMcpInstallation(
  mcpAccessToken: string,
): Promise<void> {
  return sharedRedisAuth.revokeMcpInstallation(redisClient, mcpAccessToken);
}

export async function saveTokenExchange(
  authorizationCode: string,
  tokenExchange: TokenExchange,
) {
  return sharedRedisAuth.saveTokenExchange(redisClient, authorizationCode, tokenExchange);
}

export async function exchangeToken(
  authorizationCode: string,
): Promise<TokenExchange | undefined> {
  return sharedRedisAuth.exchangeToken(redisClient, authorizationCode);
}
