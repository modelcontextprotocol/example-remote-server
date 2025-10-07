# Customization Guide

This reference implementation includes demo functionality to showcase MCP features. Here's how to adapt it for your own use case.

## Overview: What to Customize vs. Keep

**Replace with your own:**
- MCP tools, resources, and prompts (your business logic)
- Authentication provider (use commercial OAuth provider)

**Keep as-is (infrastructure):**
- Redis transport and session management
- HTTP handlers and routing
- Security middleware and rate limiting
- Logging infrastructure

---

## Customizing MCP Functionality

All MCP feature implementations live in **`mcp-server/src/services/mcp.ts`**. This is where you define what your server can do.

### Tools

Replace the 7 demo tools (echo, add, etc.) with your actual tools:

**Location:** `createMcpServer()` function, look for the `CallToolRequestSchema` handler

**What to change:**
- Tool definitions: name, description, input schema (using Zod)
- Tool execution logic: what happens when the tool is called
- Return format: text, images, or embedded resources

**Pattern:** Each tool validates input with a Zod schema and returns content in MCP format.

### Resources

Replace the 100 fake resources with your actual data sources:

**Location:** `createMcpServer()` function, resource-related handlers:
- `ListResourcesRequestSchema` - List available resources
- `ReadResourceRequestSchema` - Read specific resources
- `SubscribeRequestSchema` / `UnsubscribeRequestSchema` - Resource updates

**What to change:**
- Resource URIs and names
- Data fetching logic
- Pagination if needed
- Update notifications for subscribed resources

**Pattern:** Resources use URIs (e.g., `db://users/123`) and return content as text, JSON, or binary.

### Prompts

Replace the 3 demo prompts with useful prompts for your domain:

**Location:** `createMcpServer()` function, prompt-related handlers:
- `ListPromptsRequestSchema` - List available prompts
- `GetPromptRequestSchema` - Return prompt content

**What to change:**
- Prompt names and descriptions
- Prompt arguments and validation
- Prompt content and embedded resources

**Pattern:** Prompts can include dynamic arguments and reference resources.

---

## Customizing Authentication

**Replace the demo auth server** with a commercial OAuth provider (Auth0, Okta, Azure AD, AWS Cognito, Google, GitHub, etc.).

See [OAuth Architecture Patterns](oauth-architecture-patterns.md#using-a-commercial-auth-provider) for detailed integration steps.

**Do not repurpose the demo auth server** - it's designed for development/testing only. Commercial providers offer better security, reliability, and user management.

---

## Configuration

Update environment variables for your deployment:

**MCP Server** (`mcp-server/.env`):
```bash
BASE_URI=https://your-mcp-server.com
PORT=443
AUTH_SERVER_URL=https://your-tenant.auth0.com
REDIS_URL=redis://your-redis-server:6379
```

**Auth Server** (only if using the demo server for development):
```bash
AUTH_SERVER_URL=http://localhost:3001
BASE_URI=https://your-mcp-server.com
```

---

## Testing Your Customizations

1. **Unit tests:** Add tests for your tools/resources in `mcp-server/src/services/`
2. **Integration tests:** Test with MCP Inspector or client.js
3. **Build and lint:** Run `npm run build && npm run lint`
4. **End-to-end:** Use the examples to verify OAuth and MCP flows

---

## Next Steps

1. Fork/clone this repository
2. Replace tools, resources, and prompts in `mcp-server/src/services/mcp.ts`
3. Integrate with your OAuth provider (see OAuth Architecture Patterns doc)
4. Update environment variables for your deployment
5. Test thoroughly before deploying

For questions about the MCP protocol itself, see the [MCP specification](https://modelcontextprotocol.io/specification).
