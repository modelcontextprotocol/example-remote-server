# MCP Server Examples

This directory contains example code demonstrating how to interact with the MCP server.

## Prerequisites

Before running any examples, ensure:
1. Redis is running: `docker compose up -d`
2. Both servers are running: `npm run dev`
3. Servers are accessible at:
   - Auth Server: http://localhost:3001
   - MCP Server: http://localhost:3232

## Available Examples

### curl-examples.sh

Shell script demonstrating API interactions using curl.

**Features:**
- OAuth client registration
- MCP session initialization
- Tool calls (echo, add)
- Resource listing and reading
- Prompt operations

**Three-step workflow:**
```bash
# Make executable
chmod +x curl-examples.sh

# Step 1: Setup - Register OAuth client and get instructions
./curl-examples.sh

# Step 2: Create session - Get an access token (via Inspector or client.js), then:
./curl-examples.sh YOUR_ACCESS_TOKEN
# → Initializes MCP session and displays session ID

# Step 3: Run examples - Use both access token and session ID:
./curl-examples.sh YOUR_ACCESS_TOKEN YOUR_SESSION_ID
# → Demonstrates all MCP features (tools, resources, prompts)
```

**Quick reference:**
- Run `./curl-examples.sh --help` for detailed usage
- Get access token from MCP Inspector or `node client.js`
- Each step explains what to do next

### client.js

Node.js client showing programmatic interaction with the MCP server.

**Features:**
- Complete OAuth flow demonstration
- Automatic client registration
- MCP session management
- Tool and resource operations

**Usage:**
```bash
# Run the example
node client.js

# Or make it executable
chmod +x client.js
./client.js
```

**Note:** When you complete the OAuth flow in your browser, you'll be redirected to `http://localhost:8080/callback` which will show "site can't be reached". This is expected! Simply copy the authorization code from the URL in your browser's address bar (the long string after `code=`). The script will exchange this for an access token and display it for use with other tools.

## Understanding OAuth Tokens

**Authorization Code** vs **Access Token**:
- **Authorization Code**: The temporary code you get from the browser redirect (e.g., `302a80e8...`)
  - One-time use only
  - Must be exchanged for an access token
  - Expires quickly (usually within minutes)
- **Access Token**: The actual bearer token for API authentication (e.g., `mcp_at_...`)
  - Used in the `Authorization: Bearer` header
  - Valid for 7 days
  - What you need for `curl-examples.sh`

## Getting an Access Token

### Option 1: MCP Inspector (Easiest)

```bash
# Launch inspector
npx -y @modelcontextprotocol/inspector

# Connect to http://localhost:3232/mcp
# Complete OAuth flow in the Auth tab
# Copy the access token from the debug console
```

### Option 2: Manual OAuth Flow

1. Register a client (see examples)
2. Navigate to authorization URL
3. Complete authentication
4. Exchange authorization code for token
5. Use token in API calls

## Common Patterns

### Making MCP Requests

All MCP requests follow this pattern:

```javascript
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "category/action",
  "params": { /* method-specific parameters */ }
}
```

### Required Headers

```
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
Mcp-Session-Id: YOUR_SESSION_ID  // After initialization
```

### Session Lifecycle

1. **Initialize**: Create a new session
2. **Use**: Make requests with session ID
3. **Terminate**: Optional cleanup (auto-expires after 5 min)

## Troubleshooting

### "401 Unauthorized"
- Token may be expired (7-day TTL)
- Token may be invalid
- Get a new token via OAuth flow

### "Session not found"
- Session expired (5-minute TTL)
- Re-initialize with the same token

### "Cannot connect"
- Ensure servers are running: `npm run dev`
- Check Redis is running: `docker compose ps`
- Verify URLs are correct

## Additional Resources

- [MCP Protocol Documentation](https://modelcontextprotocol.io)
- [OAuth Flow Documentation](../docs/oauth-flow.md)
- [API Endpoints Reference](../docs/endpoints.md)
- [Main README](../README.md)