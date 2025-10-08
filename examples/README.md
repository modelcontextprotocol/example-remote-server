# MCP Server Examples

These examples demonstrate interaction with the MCP server, covering OAuth authentication, session management, and MCP operations (tools, resources, prompts).

**Authentication is the most complex part** of using an MCP server with OAuth. The examples demonstrate authentication interactions using two different step-by-step approaches:
- **client.js**: runs the server's end-to-end auth flow in the browser
- **curl-examples.sh**: uses raw HTTP interactions (requires obtaining an access token separately)

See below for details.

## Prerequisites

Before running any examples, ensure:
1. Redis is running: `docker compose up -d`
2. Both servers are running: `npm run dev`
3. Servers are accessible at:
   - Auth Server: http://localhost:3001
   - MCP Server: http://localhost:3232

## Available Examples

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
- Requires an access token (get from MCP Inspector or `node client.js`)
- Each step explains what to do next

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