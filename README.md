# MCP Feature Reference Server

This repository provides a complete MCP server implementation that 
* demonstrates all MCP protocol features (tools, resources, prompts, sampling)
* implements OAuth 2.0 authentication using the recommended [separate auth server](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization#roles) architectural pattern
* serves as a learning resource and starting template for building your own MCP servers

The [Model Context Protocol](https://modelcontextprotocol.io) enables seamless integration between AI applications and external data sources, tools, and services.

## Table of Contents

- [Quick Start](#quick-start)
- [MCP Features](#mcp-features)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Quick Start

To start exploring ASAP:

```bash
# Clone and install
git clone https://github.com/modelcontextprotocol/example-remote-server.git
cd example-remote-server
npm install

# Start the server with in-process auth and in-memory session management
npm run dev:internal

# In another terminal, run MCP Inspector
npx -y @modelcontextprotocol/inspector

# Inspector will open a browser window.
# Connect to http://localhost:3232/mcp to authenticate and explore server features
```

The server is now running a lightweight config with everything bundled in a single process:
- authentication is handled by an in-process module, rather than a separate server
- sessions are stored in memory, rather than in Redis

Other configurations are available: see [Development Setup](#development-setup), below.

## MCP Features

This server implements the complete MCP specification:

- **[Tools](https://modelcontextprotocol.io/docs/concepts/tools)**: 7 example tools including echo, add, long-running operations, and LLM sampling
- **[Resources](https://modelcontextprotocol.io/docs/concepts/resources)**: 100+ example resources with pagination and subscription support
- **[Prompts](https://modelcontextprotocol.io/docs/concepts/prompts)**: Simple and complex prompts with argument support
- **[Sampling](https://modelcontextprotocol.io/docs/concepts/sampling)**: LLM interaction capabilities
- **[Elicitation](https://modelcontextprotocol.io/docs/concepts/elicitation)**: User input elicitation with various field types
- **Transports**: Both Streamable HTTP (recommended) and SSE (legacy)

## Development Setup

### Prerequisites
- Node.js >= 16
- npm or yarn
- TypeScript (installed automatically via npm install, required for building)
- Docker (optional, for Redis)

### Running The Server

The codebase supports a number of configurations ranging from simple/exploratory to something closer to how a production deployment would look. 

#### Configuration Options Overview

| | Development/Exploration | Productionesque |
|--------|----------------------|------------|
| **Auto-restart** | `npm run dev:*` <br> • Auto-restarts on file changes <br> • Verbose logging <br> • Source maps enabled | `npm run start:*` <br> • Requires build step first <br> • Optimized performance <br> • No auto-restart |
| **Auth Mode** | `internal` <br> • OAuth in same process <br> • Single port (3232) <br> • Easier to debug | `external` <br> • Separate auth server <br> • Multiple ports (3001 + 3232) <br> • Can point to commercial auth provider instead |
| **Session Storage** | In-memory <br> • No dependencies <br> • Sessions lost on restart <br> • Single instance only | Redis <br> • Requires Docker/Redis <br> • Sessions persist <br> • Multi-instance ready |

Server configuration is determined by environment variables. To set up a non-default configuration, copy [`.env.example`](.env.example) to `.env` and edit as desired, or pass non-defaults on the command line.

Some example commands for different configurations are listed below. See the [Authentication Config](#authentication-config) and [Session Management Config](#session-management-config) sections below for detailed instructions on changing those configurations.

```bash
# Development mode - watches for file changes and auto-restarts
npm run dev:internal    # Internal auth
# or
npm run dev:external    # External auth

# Production mode - optimized build, no auto-restart
npm run build          # Build TypeScript to JavaScript first
# then
npm run start:internal    # Internal auth
# or
npm run start:external    # External auth

# Redis-backed sessions
docker compose up -d   # Start Redis first
# configure REDIS_URL or pass on command line - see Session Management Config below - e.g.
REDIS_URL=redis://localhost:6379 npm run dev:internal
# Sessions will now persist across restarts

# Verify Redis is being used
npm run dev:internal 2>&1 | grep -i redis
# Should show: "Redis client connected successfully" or similar
```

## Authentication Config

This repo implements the [separate auth server](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization#roles) architecture pattern described in the MCP specification, in which the MCP server is the "resource server", and authorization functionality is hosted separately. (The architecture in which resource and authorization server functions are tightly integrated within the MCP server is **deprecated**, and is not demonstrated in this codebase.)

For convenience and simplicity during exploration, the server supports an **internal auth mode**, in which OAuth 2.0 endpoints are hosted in the same *process* as the MCP server. However, it remains architecturally separate from the MCP server itself: there is no entanglement of MCP and authorization functionality in the codebase. To run the server in this mode, use `npm run dev:internal`.

**External auth mode** is the standard configuration in which the MCP server and authentication servers run as separate processes. A demonstration authorization server is provided in this repo, and you can also point to commercial providers like Auth0 or Okta by updating the relevant config options. To run the MCP server in external mode, use `npm run dev:external`: this command will also start the separate demo auth server.

**Note:** choice of mode and OAuth server does **not** affect the MCP server's interaction with clients during authorization. It simply determines the authorization server endpoints returned in [Protected Resource Metadata](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization#authorization-server-location).

**Authentication Environment Variables:**

- `AUTH_MODE` - Sets the authentication mode:
  - `internal` (default) - Auth endpoints run in-process with the MCP server
  - `external` - Auth endpoints run on a separate server

- `AUTH_SERVER_URL` - URL of the external auth server (required when `AUTH_MODE=external`, ignored when `AUTH_MODE=internal`)
  - Example for local demo: `http://localhost:3001`
  - Example for Auth0: `https://your-tenant.auth0.com`
  - Example for Okta: `https://your-domain.okta.com`

## Session Management Config

By default, the server uses in-memory session storage for development and local single-session testing. This simplifies getting the server up and running for exploration, but confines sessions to a single server instance and destroys them on server restarts. 

For multi-instance testing and persistent sessions, the server also supports Redis-managed session storage.

**Setting up Redis:**

1. **Install Docker** (if not already installed):
   - macOS: [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
   - Windows: [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
   - Linux: [Docker Engine](https://docs.docker.com/engine/install/)

2. **Start Redis** using Docker Compose:
   ```bash
   docker compose up -d  # Starts Redis in the background
   ```

   To stop Redis later:
   ```bash
   docker compose down
   ```

3. **Configure the server** to use Redis by setting environment variables:

    **Session Storage Environment Variables:**

    - `REDIS_URL` - Redis connection URL (optional)
      - When set: Sessions are stored in Redis (persistent across restarts)
      - When not set: Sessions use in-memory storage (lost on restart)
      - Default: Not set (in-memory storage)
      - Example: `redis://localhost:6379` (Redis default port)

    - `REDIS_TLS` - Enable TLS for Redis connection
      - Set to `1` or `true` to enable TLS
      - Default: `0` (disabled)

    - `REDIS_PASSWORD` - Redis password for authentication (if required)

    - `NODE_ENV` - Controls Redis connection failure behavior:
      - `development` (default) - Server continues with warning if Redis fails
      - `production` - Server exits if Redis connection fails

    Note: Docker container config can be found in `.devcontainer/docker-compose.yml`. 

### Testing Features With MCP Inspector

As noted above, MCP Inspector is the recommended way to explore the server's capabilities:

```bash
# With server running
npx -y @modelcontextprotocol/inspector

# 1. Connect to http://localhost:3232/mcp (adjust port to match current config is needed)
# 2. Go through authorization steps
# 3. Explore OAuth authentication in the Auth tab
# 4. Test tools, resources, and prompts interactively
```

### Example Scripts

The `examples/` directory contains scripts that interact with MCP endpoints directly, without use of SDK functionality. These can help build intuition for how the protocol works under the hood:
- `client.js` - Node.js client demonstrating OAuth and MCP operations
- `curl-examples.sh` - Shell script showing raw HTTP usage

### Running Tests

```bash
npm run lint      # Code linting
npm run typecheck # Type checking
npm test          # Unit tests
npm run test:e2e  # End-to-end tests
```

## Project Structure

```
.
├── src/                      # Source code
│   ├── index.ts              # Server entry point
│   ├── config.ts             # Configuration management
│   ├── interfaces/
│   │   └── auth-validator.ts # Clean auth/MCP boundary
│   ├── modules/
│   │   ├── auth/             # Demo OAuth 2.0 implementation
│   │   │   ├── auth/         # Core auth logic and providers
│   │   │   ├── handlers/     # Mock upstream IdP handler
│   │   │   ├── services/     # Auth and Redis-backed session services
│   │   │   ├── static/       # OAuth frontend assets
│   │   │   ├── index.ts      # Auth module router
│   │   │   └── types.ts      # Auth type definitions
│   │   ├── mcp/              # MCP protocol implementation
│   │   │   ├── handlers/     # Streamable HTTP and SSE handlers
│   │   │   ├── services/     # MCP core and Redis transport
│   │   │   ├── index.ts      # MCP module router
│   │   │   └── types.ts      # MCP type definitions
│   │   └── shared/           # Shared utilities
│   │       ├── logger.ts     # Logging configuration
│   │       └── redis.ts      # Redis client with mock fallback
│   └── static/               # Static web assets
├── examples/                 # Example client implementations
│   ├── client.js             # Node.js client with OAuth flow
│   └── curl-examples.sh      # Shell script with curl examples
├── docs/                     # Additional Documentation
├── tests/                    # Test files
├── .env.example              # Environment variable template
├── docker-compose.yml        # Docker setup for Redis
├── package.json              # Node.js dependencies
└── tsconfig.json             # TypeScript configuration
```

## Documentation

Additional documentation can be found in the `docs/` directory:

- [OAuth Implementation](docs/oauth-implementation.md) - Complete OAuth 2.0 + PKCE guide with architecture, flows, and commercial provider integration
- [Session Ownership](docs/session-ownership.md) - Multi-user session isolation and Redis-backed ownership tracking

### Other Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.
