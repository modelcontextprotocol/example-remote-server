# MCP Standalone Authorization Server

This is a demonstration OAuth 2.0 authorization server for MCP.

## Purpose

This server demonstrates how MCP servers can delegate authentication to a separate 
authorization server (Mode 2 in our implementation). In production environments, 
you would typically use established OAuth providers like:

- Auth0
- Okta
- Google OAuth
- GitHub OAuth
- Microsoft Azure AD

## Architecture

When running in separate mode, the architecture looks like:

1. MCP Client (e.g., Inspector) discovers auth server URL from MCP server metadata
2. Client registers and authenticates directly with this auth server
3. Auth server issues tokens
4. MCP server validates tokens by calling this auth server's introspection endpoint

## Endpoints

- `/.well-known/oauth-authorization-server` - OAuth 2.0 server metadata
- `/oauth/authorize` - Authorization endpoint
- `/oauth/token` - Token endpoint
- `/oauth/register` - Dynamic client registration
- `/oauth/introspect` - Token introspection (for MCP server validation)
- `/fakeupstreamauth/authorize` - Fake upstream auth page (demo only)
- `/fakeupstreamauth/callback` - Fake upstream callback (demo only)
- `/health` - Health check endpoint

## Development

This server shares Redis with the MCP server for development convenience.
In production, these would typically be separate.

## Running the Auth Server

### Standalone
```bash
# From the repository root
npm run dev:auth-server
```

### With MCP Server (Separate Mode)
```bash
# Start both servers together
npm run dev:with-separate-auth
```

## Testing

### Health Check
```bash
curl http://localhost:3001/health
```

### OAuth Metadata
```bash
curl http://localhost:3001/.well-known/oauth-authorization-server
```

### With MCP Inspector
1. Start this auth server: `npm run dev:auth-server`
2. Start MCP server in separate mode: `AUTH_MODE=separate npm run dev`
3. Open Inspector: `npx -y @modelcontextprotocol/inspector`
4. Connect to `http://localhost:3232`
5. Auth flow will redirect to this server (port 3001)

## Configuration

The auth server uses the same environment variables as the main server:
- `AUTH_SERVER_PORT` - Port to run on (default: 3001)
- `AUTH_SERVER_URL` - Base URL (default: http://localhost:3001)
- `REDIS_URL` - Redis connection (shared with MCP server)

## Production Considerations

In production:
- Use real OAuth providers instead of this demonstration server
- Separate Redis instances for auth and resource servers
- Enable HTTPS with proper certificates
- Implement proper rate limiting and monitoring
- Use secure client secrets and token rotation