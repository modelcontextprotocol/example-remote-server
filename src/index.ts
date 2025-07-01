import cors from "cors";
import express from "express";
import { BASE_URI, PORT } from "./config.js";
import { AuthRouterOptions, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { EverythingAuthProvider } from "./auth/provider.js";
import { handleMessage, handleSSEConnection, authContext } from "./handlers/mcp.js";
import { handleStreamableHTTP, initializeNodeDiscovery } from "./handlers/mcp-streamable.js";
import { handleFakeAuthorizeRedirect, handleFakeAuthorize } from "./handlers/fakeauth.js";
import { redisClient } from "./redis.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

const app = express();

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

// simple logging middleware
const logger = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.log(`${req.method} ${req.url}`);
  next();
  // Log the response status code
  res.on('finish', () => {
    console.log(`Response status code: ${res.statusCode}`);
  });
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
  methods: ['GET', 'POST', 'DELETE'], // Added DELETE for streamable HTTP
  allowedHeaders: ['Content-Type', 'Authorization', "MCP-Protocol-Version", "MCP-Session-Id", "Last-Event-ID"],
  credentials: true
};

app.use(logger);

// Apply base security headers to all routes
app.use(baseSecurityHeaders);

// Enable CORS pre-flight requests
app.options('*', cors(corsOptions));

// Auth configuration
const options: AuthRouterOptions = {
  provider: new EverythingAuthProvider(),
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
// app.use(mcpAuthRouter(options));

// MCP routes (original SSE-based)
app.get("/sse", cors(corsOptions), sseHeaders, handleSSEConnection);
app.post("/message", cors(corsOptions), sensitiveDataHeaders, handleMessage);

// MCP routes (new streamable HTTP with multi-node support)
app.get("/mcp", cors(corsOptions), handleStreamableHTTP);
app.post("/mcp", cors(corsOptions), express.json({ limit: '4mb' }), handleStreamableHTTP);
app.delete("/mcp", cors(corsOptions), handleStreamableHTTP);

// Upstream auth routes
app.get("/fakeupstreamauth/authorize", cors(corsOptions), handleFakeAuthorize);
app.get("/fakeupstreamauth/callback", cors(corsOptions), handleFakeAuthorizeRedirect);

try {
  await redisClient.connect();
  // Initialize node discovery for multi-node support
  await initializeNodeDiscovery();
} catch (error) {
  console.error("Could not connect to Redis:", error);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
