import { SetOptions } from "@redis/client";
import { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { RedisClient } from "../src/redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "./types.js";
import { sha256, encryptString, decryptString } from "./auth-core.js";
import { logger } from "../src/utils/logger.js";

/**
 * Redis key prefixes for different data types
 * All auth-related keys use "auth:" prefix to avoid collision with MCP session keys
 */
export const REDIS_KEY_PREFIXES = {
  CLIENT_REGISTRATION: "auth:client:",
  PENDING_AUTHORIZATION: "auth:pending:",
  MCP_AUTHORIZATION: "auth:installation:",  // Changed from "mcp:" to avoid collision
  TOKEN_EXCHANGE: "auth:exch:",
  REFRESH_TOKEN: "auth:refresh:",
} as const;

/**
 * Redis key expiry times in seconds
 */
export const REDIS_EXPIRY_TIMES = {
  CLIENT_REGISTRATION: 30 * 24 * 60 * 60,  // 30 days - client app credentials
  PENDING_AUTHORIZATION: 10 * 60,          // 10 minutes - authorization code -> PendingAuthorization
  TOKEN_EXCHANGE: 10 * 60,                 // 10 minutes - authorization code -> MCP access token
  UPSTREAM_INSTALLATION: 7 * 24 * 60 * 60, // 7 days - MCP access token -> UpstreamInstallation
  REFRESH_TOKEN: 7 * 24 * 60 * 60,         // 7 days - MCP refresh token -> access token
} as const;

/**
 * Saves encrypted data to Redis with optional expiry.
 */
async function saveEncrypted<T>(
  redisClient: RedisClient,
  {
    prefix,
    key,
    data,
    options,
  }: {
    prefix: string;
    key: string;
    data: T;
    options?: SetOptions;
  }
): Promise<string | null> {
  const value = encryptString({
    text: JSON.stringify(data),
    key: key,
  });

  return await redisClient.set(prefix + sha256(key), value, options);
}

/**
 * Reads and decrypts data from Redis.
 */
async function readEncrypted<T>(
  redisClient: RedisClient,
  {
    prefix,
    key,
    del = false,
  }: {
    prefix: string;
    key: string;
    del?: boolean;
  }
): Promise<T | undefined> {
  const data = del
    ? await redisClient.getDel(prefix + sha256(key))
    : await redisClient.get(prefix + sha256(key));

  if (!data) {
    return undefined;
  }

  const decoded = decryptString({
    encryptedText: data,
    key: key,
  });

  return JSON.parse(decoded);
}

/**
 * Saves a client registration to Redis.
 */
export async function saveClientRegistration(
  redisClient: RedisClient,
  clientId: string,
  registration: OAuthClientInformationFull
): Promise<void> {
  await redisClient.set(
    REDIS_KEY_PREFIXES.CLIENT_REGISTRATION + clientId,
    JSON.stringify(registration),
    { EX: REDIS_EXPIRY_TIMES.CLIENT_REGISTRATION }
  );
}

/**
 * Retrieves a client registration from Redis.
 */
export async function getClientRegistration(
  redisClient: RedisClient,
  clientId: string
): Promise<OAuthClientInformationFull | undefined> {
  const data = await redisClient.get(REDIS_KEY_PREFIXES.CLIENT_REGISTRATION + clientId);
  if (!data) {
    return undefined;
  }
  return JSON.parse(data);
}

/**
 * Saves a pending authorization to Redis.
 */
export async function savePendingAuthorization(
  redisClient: RedisClient,
  authorizationCode: string,
  pendingAuthorization: PendingAuthorization
): Promise<void> {
  await saveEncrypted(redisClient, {
    prefix: REDIS_KEY_PREFIXES.PENDING_AUTHORIZATION,
    key: authorizationCode,
    data: pendingAuthorization,
    options: { EX: REDIS_EXPIRY_TIMES.PENDING_AUTHORIZATION },
  });
}

/**
 * Reads a pending authorization from Redis.
 */
export async function readPendingAuthorization(
  redisClient: RedisClient,
  authorizationCode: string
): Promise<PendingAuthorization | undefined> {
  return readEncrypted<PendingAuthorization>(redisClient, {
    prefix: REDIS_KEY_PREFIXES.PENDING_AUTHORIZATION,
    key: authorizationCode,
  });
}

/**
 * Saves an MCP installation to Redis.
 */
export async function saveMcpInstallation(
  redisClient: RedisClient,
  mcpAccessToken: string,
  installation: McpInstallation
): Promise<void> {
  await saveEncrypted(redisClient, {
    prefix: REDIS_KEY_PREFIXES.MCP_AUTHORIZATION,
    key: mcpAccessToken,
    data: installation,
    options: { EX: REDIS_EXPIRY_TIMES.UPSTREAM_INSTALLATION },
  });
}

/**
 * Reads an MCP installation from Redis.
 */
export async function readMcpInstallation(
  redisClient: RedisClient,
  mcpAccessToken: string
): Promise<McpInstallation | undefined> {
  return readEncrypted<McpInstallation>(redisClient, {
    prefix: REDIS_KEY_PREFIXES.MCP_AUTHORIZATION,
    key: mcpAccessToken,
  });
}

/**
 * Links a refresh token to an MCP access token.
 */
export async function saveRefreshToken(
  redisClient: RedisClient,
  refreshToken: string,
  mcpAccessToken: string
): Promise<void> {
  await saveEncrypted(redisClient, {
    prefix: REDIS_KEY_PREFIXES.REFRESH_TOKEN,
    key: refreshToken,
    data: mcpAccessToken,
    options: { EX: REDIS_EXPIRY_TIMES.REFRESH_TOKEN },
  });
}

/**
 * Reads the access token associated with a refresh token.
 */
export async function readRefreshToken(
  redisClient: RedisClient,
  refreshToken: string
): Promise<string | undefined> {
  return readEncrypted<string>(redisClient, {
    prefix: REDIS_KEY_PREFIXES.REFRESH_TOKEN,
    key: refreshToken,
  });
}

/**
 * Revokes an MCP installation.
 */
export async function revokeMcpInstallation(
  redisClient: RedisClient,
  mcpAccessToken: string
): Promise<void> {
  const installation = await readEncrypted<McpInstallation>(redisClient, {
    prefix: REDIS_KEY_PREFIXES.MCP_AUTHORIZATION,
    key: mcpAccessToken,
    del: true,
  });

  if (!installation) {
    return;
  }
  // In production, would revoke upstream tokens here
}

/**
 * Saves a token exchange record.
 */
export async function saveTokenExchange(
  redisClient: RedisClient,
  authorizationCode: string,
  tokenExchange: TokenExchange
): Promise<void> {
  await saveEncrypted(redisClient, {
    prefix: REDIS_KEY_PREFIXES.TOKEN_EXCHANGE,
    key: authorizationCode,
    data: tokenExchange,
    options: { EX: REDIS_EXPIRY_TIMES.TOKEN_EXCHANGE },
  });
}

/**
 * Exchanges a temporary authorization code for an MCP access token.
 * Will only succeed the first time to prevent replay attacks.
 */
export async function exchangeToken(
  redisClient: RedisClient,
  authorizationCode: string
): Promise<TokenExchange | undefined> {
  const data = await redisClient.get(
    REDIS_KEY_PREFIXES.TOKEN_EXCHANGE + sha256(authorizationCode)
  );

  if (!data) {
    return undefined;
  }

  const decoded = decryptString({
    encryptedText: data,
    key: authorizationCode,
  });

  const tokenExchange: TokenExchange = JSON.parse(decoded);
  if (tokenExchange.alreadyUsed) {
    logger.error('Duplicate use of authorization code detected; revoking tokens', undefined, {
      authorizationCode: authorizationCode.substring(0, 8) + '...'
    });
    await revokeMcpInstallation(redisClient, tokenExchange.mcpAccessToken);
    throw new Error("Duplicate use of authorization code detected; tokens revoked");
  }

  const rereadData = await saveEncrypted(redisClient, {
    prefix: REDIS_KEY_PREFIXES.TOKEN_EXCHANGE,
    key: authorizationCode,
    data: { ...tokenExchange, alreadyUsed: true },
    options: { KEEPTTL: true, GET: true },
  });

  if (rereadData !== data) {
    // Data concurrently changed while we were updating it. This necessarily means a duplicate use.
    logger.error('Duplicate use of authorization code detected (concurrent update); revoking tokens', undefined, {
      authorizationCode: authorizationCode.substring(0, 8) + '...'
    });
    await revokeMcpInstallation(redisClient, tokenExchange.mcpAccessToken);
    throw new Error("Duplicate use of authorization code detected; tokens revoked");
  }

  return tokenExchange;
}