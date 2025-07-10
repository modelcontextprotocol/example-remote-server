import { SetOptions } from "@redis/client";
import crypto from "crypto";
import { redisClient } from "../redis.js";
import { McpInstallation, PendingAuthorization, TokenExchange } from "../types.js";
import { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { logger } from "../utils/logger.js";

export function generatePKCEChallenge(verifier: string): string {
  const buffer = Buffer.from(verifier);
  const hash = crypto.createHash("sha256").update(buffer);
  return hash.digest("base64url");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encryptString({ text, key }: { text: string; key: string }): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "hex"), iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptString({
  encryptedText,
  key,
}: {
  encryptedText: string;
  key: string;
}): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "hex"), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

const CLIENT_REGISTRATION_KEY_PREFIX = "client:";
const PENDING_AUTHORIZATION_KEY_PREFIX = "pending:";
const MCP_AUTHORIZATION_KEY_PREFIX = "mcp:";
const TOKEN_EXCHANGE_KEY_PREFIX = "exch:";
const REFRESH_TOKEN_KEY_PREFIX = "refresh:";

// Timeouts of redis keys for different stages of the OAuth flow
const REDIS_PENDING_AUTHORIZATION_EXPIRY_SEC = 10 * 60; // 10 minutes in seconds - authorization code -> PendingAuthorization
const REDIS_TOKEN_EXCHANGE_EXPIRY_SEC = 10 * 60; // 10 minutes in seconds - authorization code -> MCP access token
const REDIS_UPSTREAM_INSTALLATION_EXPIRY_SEC = 7 * 24 * 60 * 60; // 7 days in seconds - MCP access token -> UpstreamInstallation
const REDIS_REFRESH_TOKEN_EXPIRY_SEC = 7 * 24 * 60 * 60; // 7 days in seconds - MCP refresh token -> access token

// Access token expiry
const ACCESS_TOKEN_EXPIRY_SEC = 60 * 60 // 1 hour in seconds

async function saveEncrypted<T>({
  prefix,
  key,
  data,
  options,
}: {
  prefix: string;
  key: string;
  data: T;
  options?: SetOptions;
}) {
  const value = encryptString({
    text: JSON.stringify(data),
    key: key,
  });

  return await redisClient.set(prefix + sha256(key), value, options);
}

async function readEncrypted<T>({
  prefix,
  key,
  del = false,
}: {
  prefix: string;
  key: string;
  del?: boolean;
}): Promise<T | undefined> {
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

export function generateMcpTokens(): OAuthTokens {
  // Generate MCP access token and store both tokens
  const mcpAccessToken = generateToken();
  const mcpRefreshToken = generateToken();
  
  return {
    access_token: mcpAccessToken,
    refresh_token: mcpRefreshToken,
    expires_in: ACCESS_TOKEN_EXPIRY_SEC,
    token_type: "Bearer",
  }
}

export async function saveClientRegistration(
  clientId: string,
  registration: OAuthClientInformationFull,
) {
  await redisClient.set(
    CLIENT_REGISTRATION_KEY_PREFIX + clientId,
    JSON.stringify(registration),
  );
}

export async function getClientRegistration(
  clientId: string,
): Promise<OAuthClientInformationFull | undefined> {
  const data = await redisClient.get(CLIENT_REGISTRATION_KEY_PREFIX + clientId);
  if (!data) {
    return undefined;
  }
  return JSON.parse(data);
}

export async function savePendingAuthorization(
  authorizationCode: string,
  pendingAuthorization: PendingAuthorization,
) {
  await saveEncrypted({
    prefix: PENDING_AUTHORIZATION_KEY_PREFIX,
    key: authorizationCode,
    data: pendingAuthorization,
    options: { EX: REDIS_PENDING_AUTHORIZATION_EXPIRY_SEC },
  });
}

export async function readPendingAuthorization(
  authorizationCode: string,
): Promise<PendingAuthorization | undefined> {
  return readEncrypted<PendingAuthorization>({
    prefix: PENDING_AUTHORIZATION_KEY_PREFIX,
    key: authorizationCode,
  });
}

export async function saveMcpInstallation(
  mcpAccessToken: string,
  installation: McpInstallation,
) {
  await saveEncrypted({
    prefix: MCP_AUTHORIZATION_KEY_PREFIX,
    key: mcpAccessToken,
    data: installation,
    options: { EX: REDIS_UPSTREAM_INSTALLATION_EXPIRY_SEC },
  });
}

export async function readMcpInstallation(
  mcpAccessToken: string,
): Promise<McpInstallation | undefined> {
  return readEncrypted<McpInstallation>({
    prefix: MCP_AUTHORIZATION_KEY_PREFIX,
    key: mcpAccessToken,
  });
}

// This just links the refresh token to the upstream installation + mcp access token
export async function saveRefreshToken(
  refreshToken: string,
  mcpAccessToken: string,
) {
  saveEncrypted({
    prefix: REFRESH_TOKEN_KEY_PREFIX,
    key: refreshToken,
    data: mcpAccessToken,
    options: { EX: REDIS_REFRESH_TOKEN_EXPIRY_SEC },
  })
}

export async function readRefreshToken(
  refreshToken: string,
): Promise<string | undefined> {
  return readEncrypted<string>({
    prefix: REFRESH_TOKEN_KEY_PREFIX,
    key: refreshToken,
  });
}

export async function revokeMcpInstallation(
  mcpAccessToken: string,
): Promise<void> {
  const installation = await readEncrypted<McpInstallation>({
    prefix: MCP_AUTHORIZATION_KEY_PREFIX,
    key: mcpAccessToken,
    del: true,
  });

  if (!installation) {
    return;
  }
  // Revoke upstream tokens here
}

export async function saveTokenExchange(
  authorizationCode: string,
  tokenExchange: TokenExchange,
) {
  await saveEncrypted({
    prefix: TOKEN_EXCHANGE_KEY_PREFIX,
    key: authorizationCode,
    data: tokenExchange,
    options: { EX: REDIS_TOKEN_EXCHANGE_EXPIRY_SEC },
  });
}

/**
 * Exchanges a temporary authorization code for an MCP access token. Will only succeed the first time.
 */
export async function exchangeToken(
  authorizationCode: string,
): Promise<TokenExchange | undefined> {
  const data = await redisClient.get(TOKEN_EXCHANGE_KEY_PREFIX + sha256(authorizationCode));

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
    await revokeMcpInstallation(tokenExchange.mcpAccessToken);
    throw new Error("Duplicate use of authorization code detected; tokens revoked");
  }

  const rereadData = await saveEncrypted({
    prefix: TOKEN_EXCHANGE_KEY_PREFIX,
    key: authorizationCode,
    data: { ...tokenExchange, alreadyUsed: true },
    options: { KEEPTTL: true, GET: true },
  });

  if (rereadData !== data) {
    // Data concurrently changed while we were updating it. This necessarily means a duplicate use.
    logger.error('Duplicate use of authorization code detected (concurrent update); revoking tokens', undefined, {
      authorizationCode: authorizationCode.substring(0, 8) + '...'
    });
    await revokeMcpInstallation(tokenExchange.mcpAccessToken);
    throw new Error("Duplicate use of authorization code detected; tokens revoked");
  }

  return tokenExchange;
}
