import crypto from "crypto";
import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * Generates a PKCE code challenge from a verifier string.
 * Uses S256 method as specified in RFC 7636.
 * @param verifier The code verifier string
 * @returns Base64url-encoded SHA256 hash of the verifier
 */
export function generatePKCEChallenge(verifier: string): string {
  const buffer = Buffer.from(verifier);
  const hash = crypto.createHash("sha256").update(buffer);
  return hash.digest("base64url");
}

/**
 * Generates a cryptographically secure random token.
 * @returns 64-character hexadecimal string
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes SHA256 hash of input data.
 * @param data The string to hash
 * @returns Hexadecimal representation of the hash
 */
export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Encrypts a string using AES-256-CBC encryption.
 * @param text The plaintext to encrypt
 * @param key The encryption key (64 hex characters)
 * @returns Encrypted string in format "iv:ciphertext"
 */
export function encryptString({ text, key }: { text: string; key: string }): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "hex"), iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with encryptString.
 * @param encryptedText The encrypted string in format "iv:ciphertext"
 * @param key The encryption key (64 hex characters)
 * @returns Decrypted plaintext
 */
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

/**
 * Access token expiry time in seconds (1 hour)
 */
export const ACCESS_TOKEN_EXPIRY_SEC = 60 * 60;

/**
 * Generates a complete set of MCP OAuth tokens.
 * @returns OAuth tokens with access token, refresh token, and expiry
 */
export function generateMcpTokens(): OAuthTokens {
  const mcpAccessToken = generateToken();
  const mcpRefreshToken = generateToken();
  
  return {
    access_token: mcpAccessToken,
    refresh_token: mcpRefreshToken,
    expires_in: ACCESS_TOKEN_EXPIRY_SEC,
    token_type: "Bearer",
  };
}