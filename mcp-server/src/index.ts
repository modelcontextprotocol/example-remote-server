/**
 * MCP Resource Server with External OAuth Authentication
 *
 * This server demonstrates how to build an MCP server that delegates ALL
 * authentication to an external OAuth provider. Key points:
 *
 * - No OAuth authorization code in this server (no /authorize, /token endpoints)
 * - Uses Bearer token authentication middleware from MCP SDK
 * - Validates tokens via external auth server's /introspect endpoint
 * - Focuses purely on serving MCP protocol resources
 *
 * In production, the external auth server would be Auth0, Okta, Google OAuth, etc.
 */

import { BearerAuthMiddlewareOptions, requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import cors from "cors";
import rateLimit from "express-rate-limit";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ExternalAuthVerifier } from "./auth/external-verifier.js";
import { BASE_URI, PORT, AUTH_SERVER_URL } from "./config.js";
import { handleStreamableHTTP } from "./handlers/shttp.js";
import { handleMessage, handleSSEConnection } from "./handlers/sse.js";
import { redisClient } from "./redis.js";
import { logger } from "./utils/logger.js";

const app = express();

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base security middleware - applied to all routes
const baseSecurityHeaders = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Content Security Policy
  const csp = [
    "default-src 'self'",
    "object-src 'none'",      // Disable plugins
    "frame-ancestors 'none'", // No embedding
    "form-action 'self'",     // Only allow forms to submit to our domain
    "base-uri 'self'",       // Restrict base tag
    "upgrade-insecure-requests",
    "block-all-mixed-content"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
};

// Structured logging middleware
const loggingMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const startTime = Date.now();

  // Sanitize headers to remove sensitive information
  const sanitizedHeaders = { ...req.headers };
  delete sanitizedHeaders.authorization;
  delete sanitizedHeaders.cookie;
  delete sanitizedHeaders['x-api-key'];

  // Log request (without sensitive data)
  logger.info('Request received', {
    method: req.method,
    url: req.url,
    // Only log specific safe headers
    headers: {
      'content-type': sanitizedHeaders['content-type'],
      'user-agent': sanitizedHeaders['user-agent'],
      'mcp-protocol-version': sanitizedHeaders['mcp-protocol-version'],
      'mcp-session-id': sanitizedHeaders['mcp-session-id'],
      'accept': sanitizedHeaders['accept'],
      'x-cloud-trace-context': sanitizedHeaders['x-cloud-trace-context']
    },
    // Don't log request body as it may contain sensitive data
    bodySize: req.headers['content-length']
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
};


// Sensitive data middleware - for routes with sensitive data
const sensitiveDataHeaders = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
};

// SSE middleware - specific for SSE endpoint
const sseHeaders = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Connection', 'keep-alive');
  next();
};

// Configure CORS to allow any origin since this is a public API service
const corsOptions = {
  origin: true, // Allow any origin
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', "Mcp-Protocol-Version", "Mcp-Protocol-Id"],
  exposedHeaders: ["Mcp-Protocol-Version", "Mcp-Protocol-Id"],
  credentials: true
};


app.use(express.json());

// Add structured logging context middleware first
app.use(logger.middleware());

// Then add the logging middleware
app.use(loggingMiddleware);

// Apply base security headers to all routes
app.use(baseSecurityHeaders);

// Enable CORS pre-flight requests
app.options('*', cors(corsOptions));

// Rate limiting for custom endpoints
const staticFileRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 25, // 25 requests per 10 minutes for static files
  message: { error: 'too_many_requests', error_description: 'Static file rate limit exceeded' }
});

// Separate mode: MCP server uses external auth server
logger.info('Starting MCP server in SEPARATE mode', {
  baseUri: BASE_URI,
  port: PORT,
  authServerUrl: AUTH_SERVER_URL
});

// Fetch metadata from external auth server with retry logic
let authMetadata;
const maxRetries = 5;
const retryDelay = 3000; // 3 seconds

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    logger.info(`Attempting to connect to auth server (attempt ${attempt}/${maxRetries})`, {
      authServerUrl: AUTH_SERVER_URL
    });

    const authMetadataResponse = await fetch(`${AUTH_SERVER_URL}/.well-known/oauth-authorization-server`);
    if (!authMetadataResponse.ok) {
      throw new Error(`Failed to fetch auth server metadata: ${authMetadataResponse.status} ${authMetadataResponse.statusText}`);
    }
    authMetadata = await authMetadataResponse.json();
    logger.info('Successfully fetched auth server metadata', {
      issuer: authMetadata.issuer,
      authorizationEndpoint: authMetadata.authorization_endpoint,
      tokenEndpoint: authMetadata.token_endpoint
    });
    break; // Success, exit retry loop

  } catch (error) {
    if (attempt < maxRetries) {
      logger.info(`Failed to connect to auth server, retrying in ${retryDelay/1000} seconds...`, {
        attempt,
        maxRetries,
        error: (error as Error).message
      });
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    } else {
      logger.error('Failed to fetch auth server metadata after all retries', error as Error);
      logger.error('Make sure the auth server is running at', undefined, { authServerUrl: AUTH_SERVER_URL });
      process.exit(1);
    }
  }
}

// BACKWARDS COMPATIBILITY: We serve OAuth metadata from the MCP server even in separate mode
// This is technically redundant since the auth server handles all OAuth operations,
// but some clients may expect to find .well-known/oauth-authorization-server on the
// resource server itself. The metadata points to the external auth server endpoints.
app.use(mcpAuthMetadataRouter({
  oauthMetadata: authMetadata,
  resourceServerUrl: new URL(BASE_URI),
  resourceName: "MCP Feature Reference Server"
}));

// Configure bearer auth with external verifier
const externalVerifier = new ExternalAuthVerifier(AUTH_SERVER_URL);

const bearerAuthOptions: BearerAuthMiddlewareOptions = {
  verifier: externalVerifier,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(BASE_URI)),
};

const bearerAuth = requireBearerAuth(bearerAuthOptions);

// MCP routes (legacy SSE transport)
app.get("/sse", cors(corsOptions), bearerAuth, sseHeaders, handleSSEConnection);
app.post("/message", cors(corsOptions), bearerAuth, sensitiveDataHeaders, handleMessage);

// MCP routes (new streamable HTTP transport)
app.get("/mcp", cors(corsOptions), bearerAuth, handleStreamableHTTP);
app.post("/mcp", cors(corsOptions), bearerAuth, handleStreamableHTTP);
app.delete("/mcp", cors(corsOptions), bearerAuth, handleStreamableHTTP);

// Static assets
app.get("/mcp-logo.png", staticFileRateLimit, (req, res) => {
  const logoPath = path.join(__dirname, "static", "mcp.png");
  res.sendFile(logoPath);
});

app.get("/styles.css", staticFileRateLimit, (req, res) => {
  const cssPath = path.join(__dirname, "static", "styles.css");
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(cssPath);
});

// Splash page
app.get("/", (req, res) => {
  const splashPath = path.join(__dirname, "static", "index.html");
  res.sendFile(splashPath);
});

// Note: Fake upstream auth routes are not needed in separate mode
// The auth server handles all authentication

try {
  await redisClient.connect();
} catch (error) {
  logger.error("Could not connect to Redis", error as Error);
  process.exit(1);
}

app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    url: `http://localhost:${PORT}`,
    environment: process.env.NODE_ENV || 'development'
  });
});
