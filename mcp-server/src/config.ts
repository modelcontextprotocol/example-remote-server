import "dotenv/config";

/**
 * Port for the MCP server to listen on
 */
export const PORT = Number(process.env.PORT) || 3232;

/**
 * Base URI for the MCP server. Used for OAuth callbacks and metadata.
 * Should match the port if specified separately.
 */
export const BASE_URI = process.env.BASE_URI || `http://localhost:${PORT}`;

// Validate PORT and BASE_URI consistency
const baseUrl = new URL(BASE_URI);
if (baseUrl.port && parseInt(baseUrl.port) !== PORT) {
  console.warn(`Warning: BASE_URI port (${baseUrl.port}) doesn't match PORT (${PORT})`);
}

/**
 * Redis connection URL
 */
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * URL of the external authorization server
 */
export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || 'http://localhost:3001';
