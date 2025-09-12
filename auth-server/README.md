# MCP Standalone Authorization Server

This is a demonstration OAuth 2.0 authorization server for MCP's separate authentication mode.

## Purpose

This server demonstrates how MCP servers can delegate authentication to a separate authorization server. See the main [README Authentication Modes](../README.md#authentication-modes) section for a complete overview of integrated vs separate modes.

In production environments, you would typically use established OAuth providers like:
- Auth0, Okta
- Google OAuth, GitHub OAuth  
- Microsoft Azure AD, AWS Cognito

## Architecture

For detailed architecture information and OAuth flow analysis, see:
- [Authentication Modes](../README.md#authentication-modes) - Overview and comparison
- [OAuth 2.0 + PKCE Flow Analysis](../README.md#oauth-20--pkce-flow-analysis) - Step-by-step flow breakdown
- [Authentication Architecture](../README.md#authentication-architecture) - Visual diagrams

This auth server specifically implements the "Auth Server" component in the separate mode architecture diagram.

## Endpoints

- `/.well-known/oauth-authorization-server` - OAuth 2.0 server metadata
- `/authorize` - Authorization endpoint
- `/token` - Token endpoint  
- `/register` - Dynamic client registration
- `/introspect` - Token introspection (for MCP server validation)
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
See the main [Testing with MCP Inspector](../README.md#testing-with-mcp-inspector) section for complete testing instructions for both modes.

**Quick test for this auth server:**
1. Start this auth server: `npm run dev:auth-server`
2. Start MCP server in separate mode: `AUTH_MODE=separate npm run dev` 
3. Follow the separate mode testing steps in the main README

## Configuration

The auth server uses the same configuration system as the main server. See [Configuration](../README.md#configuration) in the main README for complete environment variable documentation.

**Auth server specific variables:**
- `AUTH_SERVER_PORT` - Port to run on (default: 3001)
- `AUTH_SERVER_URL` - Base URL (default: http://localhost:3001)
- `REDIS_URL` - Redis connection (shared with MCP server)

## Production Considerations

**This server is for demonstration only.** In production, use established OAuth providers.

For comprehensive security and deployment guidance, see:
- [Security](../README.md#security) - Security measures and best practices
- [Configuration](../README.md#configuration) - Environment setup
- [Monitoring & Debugging](../README.md#monitoring--debugging) - Operational guidance

**Production replacement options:**
- Corporate SSO (Auth0, Okta)
- Cloud providers (AWS Cognito, Azure AD)  
- Social providers (Google OAuth, GitHub OAuth)