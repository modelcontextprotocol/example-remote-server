/**
 * MCP Feature Reference Server - Unified Entry Point
 *
 * This server demonstrates the recommended pattern for MCP servers with OAuth:
 * - Auth functionality is always architecturally separate from MCP
 * - In 'internal' mode: Auth server runs in-process for convenience
 * - In 'external' mode: Auth server runs separately (Auth0, Okta, or standalone)
 *
 * The auth module acts as a stand-in for an external OAuth server, even when
 * running internally. This is NOT the deprecated integrated auth pattern.
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { AuthModule } from './modules/auth/index.js';
import { MCPModule } from './modules/mcp/index.js';
import { ExternalTokenValidator, InternalTokenValidator, ITokenValidator } from './interfaces/auth-validator.js';
import { redisClient } from './modules/shared/redis.js';
import { logger } from './modules/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Determine server type based on auth mode
  const isAuthServerOnly = config.auth.mode === 'auth_server';
  const serverType = isAuthServerOnly ? 'OAuth Authorization Server' : 'MCP Feature Reference Server';

  console.log('');
  console.log('========================================');
  console.log(serverType);
  console.log('========================================');

  const app = express();

  // Basic middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(logger.middleware());

  // Connect to Redis if configured
  if (config.redis.enabled && config.redis.url) {
    try {
      await redisClient.connect();
      console.log('Connected to Redis');
    } catch (error) {
      logger.error('Failed to connect to Redis', error as Error);
      if (config.nodeEnv === 'production') {
        process.exit(1);
      }
      console.log('WARNING: Continuing without Redis (development mode)');
    }
  }

  // OAuth metadata discovery endpoint
  // Only served by MCP servers (not standalone auth servers)
  if (config.auth.mode !== 'auth_server') {
    app.get('/.well-known/oauth-authorization-server', (req, res) => {
      // Log the metadata discovery request
      logger.info('OAuth metadata discovery', {
        userAgent: req.get('user-agent'),
        authMode: config.auth.mode,
        ip: req.ip
      });

      // Determine the auth server URL based on mode
      const authServerUrl = config.auth.mode === 'internal'
        ? config.baseUri  // Internal mode: auth is in same process
        : config.auth.externalUrl!;  // External mode: separate auth server

      res.json({
        issuer: authServerUrl,
        authorization_endpoint: `${authServerUrl}/authorize`,
        token_endpoint: `${authServerUrl}/token`,
        registration_endpoint: `${authServerUrl}/register`,
        introspection_endpoint: `${authServerUrl}/introspect`,
        revocation_endpoint: `${authServerUrl}/revoke`,
        token_endpoint_auth_methods_supported: ['none'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        service_documentation: 'https://modelcontextprotocol.io'
      });
    });
  }

  // Initialize modules based on auth mode
  let tokenValidator: ITokenValidator | undefined;

  if (config.auth.mode === 'internal' || config.auth.mode === 'auth_server') {
    // ========================================
    // INTERNAL MODE or AUTH_SERVER MODE: Mount auth endpoints
    // ========================================
    if (config.auth.mode === 'auth_server') {
      console.log('Mode: STANDALONE AUTH SERVER');
      console.log('   Serving OAuth 2.0 endpoints only');
    } else {
      console.log('Auth Mode: INTERNAL (all-in-one)');
      console.log('   Running auth server in-process for demo/development');
    }
    console.log('');

    // Create auth module
    const authModule = new AuthModule({
      baseUri: config.baseUri,
      authServerUrl: config.baseUri, // Points to itself
      redisUrl: config.redis.url
    });

    // Mount auth routes
    app.use('/', authModule.getRouter());

    // Create internal token validator for MCP (if not auth-only mode)
    if (config.auth.mode === 'internal') {
      tokenValidator = new InternalTokenValidator(authModule);
    }

    console.log('Auth Endpoints:');
    console.log(`   Register Client: POST ${config.baseUri}/register`);
    console.log(`   Authorize: GET ${config.baseUri}/authorize`);
    console.log(`   Get Token: POST ${config.baseUri}/token`);
    console.log(`   Introspect: POST ${config.baseUri}/introspect`);

  } else if (config.auth.mode === 'external') {
    // ========================================
    // EXTERNAL MODE: MCP only, auth elsewhere
    // ========================================
    console.log('Auth Mode: EXTERNAL');
    console.log(`   Using external auth server: ${config.auth.externalUrl}`);
    console.log('');

    // Create external token validator (HTTP calls)
    tokenValidator = new ExternalTokenValidator(config.auth.externalUrl!);
  }

  // ========================================
  // MCP Module (skip for standalone auth server)
  // ========================================
  if (config.auth.mode !== 'auth_server') {
    if (!tokenValidator) {
      throw new Error('Token validator not initialized');
    }

    const mcpModule = new MCPModule(
      {
        baseUri: config.baseUri,
        redisUrl: config.redis.url
      },
      tokenValidator
    );

    // Mount MCP routes
    app.use('/', mcpModule.getRouter());

    console.log('');
    console.log('MCP Endpoints:');
    console.log(`   Streamable HTTP: ${config.baseUri}/mcp`);
    console.log(`   SSE (legacy): ${config.baseUri}/sse`);
    console.log(`   Health Check: ${config.baseUri}/health`);
    console.log(`   OAuth Metadata: ${config.baseUri}/.well-known/oauth-authorization-server`);
  }

  // Splash page (customize based on mode)
  app.get('/', (req, res) => {
    if (config.auth.mode === 'auth_server') {
      // Simple splash page for standalone auth server
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Authorization Server</title>
            <style>
              body {
                font-family: system-ui, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
              }
              h1 { color: #333; }
              .endpoint {
                background: #f5f5f5;
                padding: 10px;
                margin: 5px 0;
                font-family: monospace;
              }
            </style>
          </head>
          <body>
            <h1>OAuth Authorization Server</h1>
            <p>This is a demo standalone OAuth 2.0 authorization server for MCP.</p>

            <h2>Available Endpoints</h2>
            <div class="endpoint">POST ${config.baseUri}/register - Register OAuth client</div>
            <div class="endpoint">GET ${config.baseUri}/authorize - Authorization endpoint</div>
            <div class="endpoint">POST ${config.baseUri}/token - Token endpoint</div>
            <div class="endpoint">POST ${config.baseUri}/introspect - Token introspection</div>
          </body>
        </html>
      `);
    } else {
      const srcStaticDir = path.join(__dirname, 'static');
      const splashPath = path.join(srcStaticDir, 'index.html');
      let html = fs.readFileSync(splashPath, 'utf8');
      res.send(html);
    }
  });

  // Start server
  app.listen(config.port, () => {
    console.log('');
    console.log('========================================');
    console.log(`Server running at: ${config.baseUri}`);
    console.log('========================================');
    console.log('');

    if (config.auth.mode === 'auth_server') {
      console.log('This server provides OAuth 2.0 endpoints only.');
      console.log('To use with an MCP server:');
      console.log('  1. Start MCP server with AUTH_MODE=external');
      console.log(`  2. Set AUTH_SERVER_URL=${config.baseUri}`);
    } else if (config.auth.mode === 'internal') {
      console.log('To switch to external auth:');
      console.log('  1. Start auth server separately');
      console.log('  2. Set AUTH_MODE=external');
      console.log('  3. Set AUTH_SERVER_URL=<auth-server-url>');
      console.log('  4. Restart this server');
    } else if (config.auth.mode === 'external') {
      console.log('To switch to internal auth:');
      console.log('  1. Set AUTH_MODE=internal');
      console.log('  2. Restart this server');
    }
    console.log('');
  });
}

// Start the server
main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});