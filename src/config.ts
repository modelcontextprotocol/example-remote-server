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
 * Authentication mode:
 * - 'integrated': MCP server acts as its own OAuth server (default)
 * - 'separate': MCP server delegates to external auth server
 */
export const AUTH_MODE = (process.env.AUTH_MODE as 'integrated' | 'separate') || 'integrated';

/**
 * Port for the standalone auth server (only used in separate mode)
 * Used when running the auth-server component
 */
export const AUTH_SERVER_PORT = parseInt(process.env.AUTH_SERVER_PORT || '3001');

/**
 * URL of the external authorization server (only used when AUTH_MODE='separate')
 * This is where the MCP server will redirect clients for authentication
 */
export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || `http://localhost:${AUTH_SERVER_PORT}`;

// Validate AUTH_SERVER configuration
if (AUTH_MODE === 'separate') {
  const authUrl = new URL(AUTH_SERVER_URL);
  if (authUrl.port && parseInt(authUrl.port) !== AUTH_SERVER_PORT) {
    throw new Error(`Configuration error: AUTH_SERVER_URL port (${authUrl.port}) doesn't match AUTH_SERVER_PORT (${AUTH_SERVER_PORT})`);
  }
}
