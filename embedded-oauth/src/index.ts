import { BearerAuthMiddlewareOptions, requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { AuthRouterOptions, getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import cors from "cors";
import rateLimit from "express-rate-limit";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { FeatureReferenceAuthProvider } from "./auth/provider.js";
import { handleMockUpstreamAuthorize, handleMockUpstreamCallback } from "./handlers/mock-upstream-idp.js";
import { BASE_URI, PORT } from "./config.js";
import { authContext } from "./handlers/common.js";
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
const mockUpstreamIdpRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 20, // 20 auth attempts per minute
  message: { error: 'too_many_requests', error_description: 'Authentication rate limit exceeded' }
});

const staticFileRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 25, // 25 requests per 10 minutes for static files
  message: { error: 'too_many_requests', error_description: 'Static file rate limit exceeded' }
});

// Embedded OAuth: MCP server acts as its own OAuth authorization server
logger.info('Starting MCP server with embedded OAuth', {
  baseUri: BASE_URI,
  port: PORT
});

const authProvider = new FeatureReferenceAuthProvider();
  
  const authRouterOptions: AuthRouterOptions = {
    provider: authProvider,
    issuerUrl: new URL(BASE_URI),
    tokenOptions: {
      rateLimit: {
        windowMs: 5 * 1000,
        limit: 100,
      }
    },
    clientRegistrationOptions: {
      rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        limit: 10, // Limit to 10 registrations per minute
      },
    },
  };
  
  // Serve OAuth endpoints
  app.use(mcpAuthRouter(authRouterOptions));
  
  // Configure bearer auth middleware
  const bearerAuthOptions: BearerAuthMiddlewareOptions = {
    verifier: {
      verifyAccessToken: authProvider.verifyAccessToken.bind(authProvider),
    },
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(BASE_URI)),
  };
  
const bearerAuth = requireBearerAuth(bearerAuthOptions);

// MCP routes (legacy SSE transport)
app.get("/sse", cors(corsOptions), bearerAuth, authContext, sseHeaders, handleSSEConnection);
app.post("/message", cors(corsOptions), bearerAuth, authContext, sensitiveDataHeaders, handleMessage);

// MCP routes (new streamable HTTP transport)
app.get("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
app.post("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
app.delete("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);

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

// Mock upstream identity provider routes
app.get("/mock-upstream-idp/authorize", mockUpstreamIdpRateLimit, cors(corsOptions), handleMockUpstreamAuthorize);
app.get("/mock-upstream-idp/callback", mockUpstreamIdpRateLimit, cors(corsOptions), handleMockUpstreamCallback);

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
