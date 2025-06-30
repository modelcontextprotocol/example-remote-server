import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { AuthRouterOptions, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import cors from "cors";
import express from "express";
import { EverythingAuthProvider } from "./auth/provider.js";
import { BASE_URI, PORT } from "./config.js";
import { authContext } from "./handlers/common.js";
import { handleFakeAuthorize, handleFakeAuthorizeRedirect } from "./handlers/fakeauth.js";
import { handleStreamableHTTP } from "./handlers/shttp.js";
import { handleMessage, handleSSEConnection } from "./handlers/sse.js";
import { redisClient } from "./redis.js";

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
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', "Mcp-Protocol-Version", "Mcp-Protocol-Id"],
  exposedHeaders: ["Mcp-Protocol-Version", "Mcp-Protocol-Id"],
  credentials: true
};


app.use(express.json());
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
  }
};
app.use(mcpAuthRouter(options));
const bearerAuth = requireBearerAuth(options);

// MCP routes (legacy SSE transport)
app.get("/sse", cors(corsOptions), bearerAuth, authContext, sseHeaders, handleSSEConnection);
app.post("/message", cors(corsOptions), bearerAuth, authContext, sensitiveDataHeaders, handleMessage);

// MCP routes (new streamable HTTP transport)
app.get("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
app.post("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);
app.delete("/mcp", cors(corsOptions), bearerAuth, authContext, handleStreamableHTTP);

// Upstream auth routes
app.get("/fakeupstreamauth/authorize", cors(corsOptions), handleFakeAuthorize);
app.get("/fakeupstreamauth/callback", cors(corsOptions), handleFakeAuthorizeRedirect);

try {
  await redisClient.connect();
} catch (error) {
  console.error("Could not connect to Redis:", error);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
