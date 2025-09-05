import express from 'express';
import cors from 'cors';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { EverythingAuthProvider } from '../src/auth/provider.js';
import { handleFakeAuthorize, handleFakeAuthorizeRedirect } from '../src/handlers/fakeauth.js';
import { redisClient } from '../src/redis.js';
import { logger } from '../src/utils/logger.js';
import { AUTH_SERVER_PORT, AUTH_SERVER_URL } from '../src/config.js';

const app = express();

console.log('=====================================');
console.log('MCP Demonstration Authorization Server');
console.log('=====================================');
console.log('This standalone server demonstrates OAuth 2.0');
console.log('authorization separate from the MCP resource server');
console.log('');
console.log('This is for demonstration purposes only.');
console.log('In production, you would use a real OAuth provider');
console.log('like Auth0, Okta, Google, GitHub, etc.');
console.log('=====================================');

// CORS for Inspector and MCP server
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(logger.middleware());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    mode: 'authorization-server',
    endpoints: {
      metadata: `${AUTH_SERVER_URL}/.well-known/oauth-authorization-server`,
      authorize: `${AUTH_SERVER_URL}/oauth/authorize`,
      token: `${AUTH_SERVER_URL}/oauth/token`,
      register: `${AUTH_SERVER_URL}/oauth/register`,
      introspect: `${AUTH_SERVER_URL}/oauth/introspect`
    }
  });
});

// Create auth provider instance for reuse
const authProvider = new EverythingAuthProvider();

// OAuth endpoints via SDK's mcpAuthRouter
app.use(mcpAuthRouter({
  provider: authProvider,
  issuerUrl: new URL(AUTH_SERVER_URL),
  tokenOptions: {
    rateLimit: { windowMs: 5000, limit: 100 }
  },
  clientRegistrationOptions: {
    rateLimit: { windowMs: 60000, limit: 10 }
  }
}));

// Token introspection endpoint (RFC 7662)
app.post('/oauth/introspect', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Missing token parameter' });
    }
    
    // Verify the token using the auth provider
    const authInfo = await authProvider.verifyAccessToken(token);
    
    // Return RFC 7662 compliant response
    res.json({
      active: true,
      client_id: authInfo.clientId,
      scope: authInfo.scopes.join(' '),
      exp: authInfo.expiresAt,
      sub: authInfo.extra?.userId || 'unknown',
      userId: authInfo.extra?.userId, // Custom field for our implementation
      username: authInfo.extra?.username,
      iss: AUTH_SERVER_URL,
      aud: authInfo.clientId,
      token_type: 'Bearer'
    });
    
  } catch (error) {
    logger.debug('Token introspection failed', { error: (error as Error).message });
    
    // Return inactive token response (don't leak error details)
    res.json({
      active: false
    });
  }
});

// Fake upstream auth endpoints (for user authentication simulation)
app.get('/fakeupstreamauth/authorize', cors(), handleFakeAuthorize);
app.get('/fakeupstreamauth/callback', cors(), handleFakeAuthorizeRedirect);

// Static assets (for auth page styling)
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/mcp-logo.png', (req, res) => {
  // Serve from the main server's static directory
  const logoPath = path.join(__dirname, '../src/static/mcp.png');
  res.sendFile(logoPath);
});

// Connect to Redis (shared with MCP server in dev)
try {
  await redisClient.connect();
  logger.info('Connected to Redis', { url: redisClient.options?.url });
} catch (error) {
  logger.error('Could not connect to Redis', error as Error);
  process.exit(1);
}

app.listen(AUTH_SERVER_PORT, () => {
  logger.info('Authorization server started', {
    port: AUTH_SERVER_PORT,
    url: AUTH_SERVER_URL,
    endpoints: {
      metadata: `${AUTH_SERVER_URL}/.well-known/oauth-authorization-server`,
      authorize: `${AUTH_SERVER_URL}/oauth/authorize`,
      token: `${AUTH_SERVER_URL}/oauth/token`,
      register: `${AUTH_SERVER_URL}/oauth/register`,
      introspect: `${AUTH_SERVER_URL}/oauth/introspect`
    }
  });
  
  console.log('');
  console.log('🚀 Auth server ready! Test with:');
  console.log(`   curl ${AUTH_SERVER_URL}/health`);
  console.log(`   curl ${AUTH_SERVER_URL}/.well-known/oauth-authorization-server`);
  console.log('');
  console.log('💡 To test separate mode:');
  console.log('   1. Keep this server running');
  console.log('   2. In another terminal: AUTH_MODE=separate npm run dev');
  console.log('   3. Connect Inspector to http://localhost:3232');
});