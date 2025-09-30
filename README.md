# MCP Everything Server

_Note: these docs were AI generated based on a claude code transcript, and then edited manually for accuracy_

A comprehensive example implementation of a scalable Model Context Protocol (MCP) server that demonstrates all MCP functionality with full authentication support and horizontal scalability.

## Overview

The Everything Server is an open-source reference implementation that showcases:
- **Complete [MCP Protocol](https://modelcontextprotocol.io/specification) Support**: All MCP features including tools, resources, prompts, sampling, completions, and logging
- **Multiple [Transport Methods](https://modelcontextprotocol.io/docs/concepts/transports)**: Streamable HTTP (SHTTP) and Server-Sent Events (SSE)
- **Dual Authentication Modes**: Integrated and separate authorization server support
- **Horizontal Scalability**: Redis-backed session management for multi-instance deployments

This server serves as both primarily as a learning resource, and an example implementation of a scalable remote MCP server.

## Quick Start

Get the server running in 5 minutes:

```bash
# 1. Prerequisites
brew install orbstack       # macOS: Install OrbStack (skip if already installed)
orbctl start                # macOS: Start OrbStack daemon
# OR install Docker Desktop and start it (Windows/Linux/macOS alternative)

# 2. Setup
git clone https://github.com/modelcontextprotocol/example-remote-server.git
cd example-remote-server
npm install
cp .env.integrated .env     # Configure for integrated mode (see Authentication Modes for details)

# 3. Start services
docker compose up -d        # Start Redis
npm run dev                 # Start server

# 4. Test with Inspector
npx -y @modelcontextprotocol/inspector
# Connect to http://localhost:3232/mcp
```

For detailed instructions, see [Installation](#installation).

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Authentication Modes](#authentication-modes)
- [Development](#development)
  - [Testing with MCP Inspector](#testing-with-mcp-inspector)
  - [Automated End-to-End Testing](#automated-end-to-end-testing)
  - [Interactive Testing](#interactive-testing)
- [Troubleshooting](#troubleshooting)
- [Architecture & Technical Details](#architecture--technical-details)
- [API Reference](#api-reference)
- [Security](#security)
- [Monitoring & Debugging](#monitoring--debugging)
- [Contributing](#contributing)

## Features

### MCP Protocol Features
- **[Tools](https://modelcontextprotocol.io/docs/concepts/tools)**: 7 demonstration tools including echo, add, long-running operations, LLM sampling, image handling, annotations, and resource references
- **[Resources](https://modelcontextprotocol.io/docs/concepts/resources)**: 100 example resources with pagination, templates, and subscription support
- **[Prompts](https://modelcontextprotocol.io/docs/concepts/prompts)**: Simple and complex prompts with argument support and resource embedding
- **[Sampling](https://modelcontextprotocol.io/docs/concepts/sampling)**: Integration with MCP sampling for LLM interactions
- **Completions**: Auto-completion support for prompt arguments
- **Logging**: Multi-level logging with configurable verbosity
- **Notifications**: Progress updates, resource updates, and stderr messages

### Transport & Infrastructure
- **[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)**: Full implementation with GET/POST/DELETE support
- **[SSE Transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#server-sent-events)**: Backwards-compatible Server-Sent Events
- **Redis Integration**: Pub/sub message routing and session state management
- **Session Management**: 5-minute TTL with automatic cleanup
- **Horizontal Scaling**: Any instance can handle any request

### Authentication & Security
- **Dual Mode Support**: Run with integrated or separate authorization server
- **[OAuth 2.0](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)**: Complete authorization flow with PKCE support
- **External Auth Ready**: Demonstrates integration with external OAuth providers
- **Session Ownership**: User isolation and access control  
- **Security Headers**: CSP, HSTS, X-Frame-Options, and more
- **Bearer Token Auth**: Middleware for protected endpoints

## Installation

### Prerequisites
- Node.js >= 16
- npm or yarn
- Docker runtime (for Redis)

### Step 1: Install Docker Runtime
Choose one option:

**macOS (Recommended: OrbStack)**
```bash
brew install orbstack
# Start OrbStack daemon (required before using Docker commands)
orbctl start
# Or download from https://orbstack.dev/download
```

**Windows/Linux: Docker Desktop**
- Download from https://www.docker.com/products/docker-desktop
- Start Docker Desktop after installation

**Alternative: Local Redis Installation**
```bash
# macOS
brew install redis && brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server && sudo systemctl start redis
```

### Step 2: Clone and Install Dependencies
```bash
git clone https://github.com/modelcontextprotocol/example-remote-server.git
cd example-remote-server
npm install
```

### Step 3: Configure Environment
```bash
# Use integrated mode (default, simpler setup)
cp .env.integrated .env

# OR use separate mode (for testing external auth)
cp .env.separate .env
```

### Step 4: Start Redis
```bash
# Ensure Docker/OrbStack is running first!
docker compose up -d

# Verify Redis is running
docker compose ps
```

### Step 5: Verify Installation
```bash
# Run the development server
npm run dev

# Server should start on http://localhost:3232
```

## Configuration

Environment variables (`.env` file):
```bash
# Server Configuration
PORT=3232                          # MCP server port
BASE_URI=http://localhost:3232     # Base URI for OAuth redirects

# Redis Configuration  
REDIS_URL=redis://localhost:6379   # Redis connection URL

# Authentication Mode (integrated | separate)
AUTH_MODE=integrated               # Default: integrated mode

# Separate Mode Configuration (only used when AUTH_MODE=separate)
AUTH_SERVER_URL=http://localhost:3001  # External auth server URL
AUTH_SERVER_PORT=3001              # Auth server port (for standalone server)
```

**Pre-configured environment files:**
- `.env.integrated` - Configuration for integrated mode
- `.env.separate` - Configuration for separate mode

```bash
# Use integrated mode
cp .env.integrated .env

# Use separate mode  
cp .env.separate .env
```

## Authentication Modes

The Everything Server supports two authentication modes to demonstrate different MCP deployment patterns:

### Integrated Mode (Default)
The MCP server acts as its own OAuth 2.0 authorization server. This configuration is simpler to deploy but requires the MCP server to host its own authorization logic. The implementation provided here is for demonstration purposes only.

```bash
npm run dev:integrated
```

### Separate Mode
The MCP server delegates authentication to a standalone authorization server. This demonstrates how MCP servers can integrate with existing OAuth infrastructure. See [auth-server/README.md](auth-server/README.md) for more details about the standalone auth server.

```bash
# Start both the auth server and MCP server
npm run dev:with-separate-auth

# Or run them separately:
# Terminal 1: Start the authorization server
npm run dev:auth-server

# Terminal 2: Start the MCP server in separate mode
npm run dev:separate
```

In production, the separate authorization server would typically be replaced with:
- Corporate SSO (Auth0, Okta)
- Cloud providers (AWS Cognito, Azure AD)
- Social providers (Google, GitHub)

## Development

### Quick Start
If you've completed installation, you're ready to develop:

```bash
# Integrated mode (MCP server handles auth)
npm run dev:integrated

# Separate mode (external auth server)
npm run dev:with-separate-auth
```

### Development Commands
```bash
# Start development server with hot reload
npm run dev

# Start in integrated mode (MCP server as OAuth server)
npm run dev:integrated

# Start in separate mode (external auth server)
npm run dev:separate

# Start standalone authorization server
npm run dev:auth-server

# Start both auth server and MCP server in separate mode
npm run dev:with-separate-auth

# Start development server with debugging
npm run dev:break
```

#### Build & Production
```bash
# Build TypeScript to JavaScript (builds both servers)
npm run build

# Run production server
npm start

# Run production auth server
npm run start:auth-server
```

#### Testing & Quality
```bash
# Run linting
npm run lint

# Run unit tests
npm test

# Run end-to-end tests (automated server management)
npm run test:e2e:integrated    # Test integrated mode OAuth + features
npm run test:e2e:separate      # Test separate mode OAuth + features
```

### Testing with MCP Inspector

The MCP Inspector is a web-based tool for testing MCP servers.

#### Prerequisites
1. Ensure Docker/OrbStack is running
2. Ensure Redis is running: `docker compose ps`
3. Ensure environment is configured: Check `.env` file exists

#### Test Integrated Mode
```bash
# 1. Start the server (Redis must already be running)
npm run dev:integrated

# 2. Launch MCP Inspector in a new terminal
npx -y @modelcontextprotocol/inspector

# 3. Connect to: http://localhost:3232/mcp
# 4. Navigate to Auth tab and complete OAuth flow
```

#### Test Separate Mode
```bash
# 1. Start both servers (Redis must already be running)
npm run dev:with-separate-auth

# 2. Launch MCP Inspector in a new terminal
npx -y @modelcontextprotocol/inspector

# 3. Connect to: http://localhost:3232/mcp
# 4. Auth flow will redirect to :3001 for authentication
```

### Running Tests
```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="User Session Isolation"
npm test -- --testNamePattern="session ownership"

# Run with coverage
npm test -- --coverage
```

### Test Categories
- **Unit Tests**: Individual component testing
- **Integration Tests**: Transport and Redis integration
- **Auth Tests**: OAuth flow and session ownership
- **Multi-user Tests**: User isolation and access control

### Automated End-to-End Testing

The `scripts/` directory contains automated test scripts that verify the complete OAuth flow and all MCP features:

#### Scripts
- **`test-integrated-e2e.sh`** - Tests integrated mode (MCP server as OAuth server)
- **`test-separate-e2e.sh`** - Tests separate mode (external auth server)

#### What the scripts test:
- Complete OAuth 2.0 + PKCE flow from client registration to token usage
- All MCP features: tools (7), resources (100 with pagination), prompts (3)
- Session management and proper error handling
- README claim verification

#### Usage
```bash
# Recommended: Automated testing (handles server lifecycle)
npm run test:e2e:integrated    # Tests integrated mode
npm run test:e2e:separate      # Tests separate mode

# Advanced: Manual script execution (requires manual server setup)  
./scripts/test-integrated-e2e.sh
./scripts/test-separate-e2e.sh
```

The npm scripts automatically start required servers, run tests, and clean up. Manual scripts require you to start Redis and servers first.

### Interactive Testing
Use the MCP Inspector for interactive testing and debugging of OAuth flows, tool execution, and resource access.

## Troubleshooting

### Common Issues

**"Cannot connect to Docker daemon"**
- Ensure Docker Desktop or OrbStack daemon is running
- macOS with OrbStack: `orbctl start` (verify with `orbctl status`)
- Windows/Linux/macOS with Docker Desktop: Start Docker Desktop application

**"Redis connection refused"**
- Check Redis is running: `docker compose ps`
- If not running: `docker compose up -d`
- Ensure Docker/OrbStack is started first

**"Missing .env file"**
- Run `cp .env.integrated .env` for default setup
- Or `cp .env.separate .env` for separate auth mode

**"Port already in use"**
- Check for existing processes: `lsof -i :3232` or `lsof -i :3001`
- Kill existing processes or change PORT in .env

**"npm install fails"**
- Ensure Node.js >= 16 is installed: `node --version`
- Clear npm cache: `npm cache clean --force`
- Delete node_modules and package-lock.json, then retry

**"Authentication flow fails"**
- Check the server logs for error messages
- Ensure Redis is running and accessible
- Verify .env configuration matches your setup mode

## Architecture & Technical Details

### Authentication Architecture

#### Integrated Mode
```mermaid
graph TD
    Client["MCP Client<br/>(Inspector)"]
    MCP["MCP Server<br/>(port 3232)<br/>• OAuth Server<br/>• Resource Server"]

    Client <-->|"OAuth flow & MCP resources"| MCP
```

#### Separate Mode
```mermaid
graph TD
    Client["MCP Client<br/>(Inspector)"]
    MCP["MCP Server<br/>(port 3232)<br/>Resource Server"]
    Auth["Auth Server<br/>(port 3001)<br/>OAuth Server"]

    Client <-->|"1. Discover metadata"| MCP
    Client <-->|"2. OAuth flow<br/>(register, authorize, token)"| Auth
    Client <-->|"3. Use tokens for MCP resources"| MCP
    MCP <-->|"Token validation<br/>(introspect)"| Auth
```

### OAuth 2.0 + PKCE Flow Analysis

The server implements a complete OAuth 2.0 authorization code flow with PKCE. Here's how each step maps to data storage and expiry:

**1. Client Registration** (app setup - happens once)
```
App → Auth Server: "I want to use OAuth, here's my info"
Auth Server → App: "OK, your client_id is XYZ, client_secret is ABC"
```
- **Storage**: Client credentials for future OAuth flows
- **Expiry**: 30 days (long-lived app credentials)

**2. Authorization Request** (starts each OAuth flow)
```
User → App: "I want to connect to MCP server"
App → Auth Server: "User wants access, here's my PKCE challenge"
Auth Server: Stores pending authorization, shows auth page
```
- **Storage**: `PENDING_AUTHORIZATION` - temporary state during flow
- **Expiry**: 10 minutes (short-lived temporary state)

**3. Authorization Code Exchange** (completes OAuth flow)
```
User → Auth Server: "I approve this app"
Auth Server → App: "Here's your authorization code"
App → Auth Server: "Exchange code + PKCE verifier for tokens"
Auth Server → App: "Here are your access/refresh tokens"
```
- **Storage**: `TOKEN_EXCHANGE` - prevents replay attacks
- **Expiry**: 10 minutes (single-use, consumed immediately)

**4. Token Storage** (long-term user session)
```
Auth Server: Issues access_token + refresh_token
Server: Stores user installation with tokens
```
- **Storage**: `UPSTREAM_INSTALLATION` - the actual user session
- **Expiry**: 7 days (balances security vs usability)

**5. Token Refresh** (extends user session)
```
App → Auth Server: "My access token expired, here's my refresh token"
Auth Server → App: "Here's a new access token"
```
- **Storage**: `REFRESH_TOKEN` - mapping for token rotation
- **Expiry**: 7 days (matches installation lifetime)

#### Data Lifecycle Hierarchy

**Timeline (shortest to longest expiry):**
1. **OAuth flow state** (10 minutes) - very temporary
2. **User sessions** (7 days) - medium-term
3. **Client credentials** (30 days) - long-term

This creates a logical hierarchy where each layer outlives the layers it supports.

### Project Structure
```
├── src/                          # MCP server code
│   ├── index.ts                 # Express app setup and routes
│   ├── config.ts                # Configuration management
│   ├── redis.ts                 # Redis client setup
│   ├── auth/
│   │   ├── provider.ts          # OAuth auth provider implementation
│   │   └── external-verifier.ts # External token verification
│   ├── handlers/
│   │   ├── shttp.ts             # Streamable HTTP handler
│   │   ├── sse.ts               # SSE transport handler
│   │   ├── fakeauth.ts          # Fake upstream auth handler
│   │   └── common.ts            # Shared middleware
│   ├── services/
│   │   ├── mcp.ts               # MCP server implementation
│   │   ├── auth.ts              # Auth service wrappers
│   │   └── redisTransport.ts    # Redis-backed transport
│   └── utils/
│       └── logger.ts            # Structured logging
├── auth-server/                 # Standalone authorization server
│   ├── index.ts                 # Auth server main entry point
│   ├── README.md                # Auth server documentation
│   └── tsconfig.json            # TypeScript configuration
├── shared/                      # Shared between both servers
│   ├── auth-core.ts             # Core auth logic
│   ├── redis-auth.ts            # Redis auth operations
│   └── types.ts                 # Shared type definitions
├── scripts/                     # End-to-end testing scripts
│   ├── test-integrated-e2e.sh   # OAuth + feature verification (integrated)
│   └── test-separate-e2e.sh     # OAuth + feature verification (separate)
├── docs/
│   ├── streamable-http-design.md  # SHTTP implementation details
│   └── user-id-system.md          # Authentication flow documentation
└── dist/                          # Compiled JavaScript output
```

### Scalability Architecture

The server is designed for horizontal scaling using Redis as the backbone:

#### Session State Management
- **Redis Storage**: All session state stored in Redis
- **5-minute TTL**: Automatic session cleanup
- **Session Ownership**: User isolation via Redis keys
- **Stateless Servers**: Any instance can handle any request

#### Message Routing
- **Pub/Sub Channels**: Redis channels for message distribution
- **Message Buffering**: Reliable delivery for disconnected clients
- **Connection State**: Tracked via pub/sub subscription counts
- **Automatic Cleanup**: No explicit cleanup required

#### Redis Key Structure

##### MCP Session Keys
```
session:{sessionId}:owner                    # Session ownership
mcp:shttp:toserver:{sessionId}              # Client→Server messages
mcp:shttp:toclient:{sessionId}:{requestId}  # Server→Client responses
mcp:control:{sessionId}                     # Control messages
```

##### OAuth/Auth Keys
```
auth:client:{clientId}                      # OAuth client registrations
auth:pending:{authCode}                     # Pending authorizations
auth:installation:{accessToken}             # Active MCP installations
auth:exch:{authCode}                        # Token exchanges
auth:refresh:{refreshToken}                 # Refresh tokens
```

Note: The `auth:` prefix ensures complete namespace isolation between auth and MCP functions in both integrated and separate modes.

### Transport Methods

#### Streamable HTTP (Recommended)
Modern [transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) supporting bidirectional communication over HTTP:
- Single endpoint for all operations
- Session management via headers
- Efficient message buffering
- Automatic reconnection support

See [docs/streamable-http-design.md](docs/streamable-http-design.md) for implementation details.

#### Server-Sent Events (Legacy)
Backwards-compatible [transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#server-sent-events) using SSE:
- Separate endpoints for SSE streams and messages
- Session management via URL parameters
- Redis-backed message routing
- Real-time event delivery

## API Reference

### MCP Endpoints
- `GET/POST/DELETE /mcp` - Streamable HTTP transport endpoint
  - `POST`: Initialize sessions or send messages
  - `GET`: Establish SSE streams
  - `DELETE`: Terminate sessions
- `GET /sse` - Legacy SSE transport endpoint
- `POST /message` - Legacy message endpoint for SSE transport

### Authentication Endpoints (Integrated Mode Only)
- `GET /fakeupstreamauth/authorize` - Fake OAuth authorization page
- `GET /fakeupstreamauth/callback` - OAuth redirect handler
- OAuth 2.0 endpoints provided by MCP SDK auth router

### Headers
- `Mcp-Session-Id`: Session identifier for Streamable HTTP
- `Authorization: Bearer <token>`: OAuth access token
- Standard MCP headers as per protocol specification

## Security

### Implemented Security Measures
- **Authentication**: [OAuth 2.0](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) with bearer tokens
- **Authorization**: User-based session ownership
- **Session Isolation**: Users can only access their own sessions
- **Security Headers**: 
  - Content Security Policy (CSP)
  - Strict Transport Security (HSTS)
  - X-Frame-Options
  - X-Content-Type-Options
- **Input Validation**: Zod schemas for all inputs
- **Error Handling**: Sanitized error responses

### Security Best Practices
1. Always use HTTPS in production
2. Configure proper CORS origins
3. Use strong client secrets
4. Enable all security headers
5. Monitor session lifetimes
6. Implement rate limiting
7. Use structured logging

## Monitoring & Debugging

### Logging
Structured JSON logging with sanitized outputs:
- HTTP request/response logging
- Authentication events
- Session lifecycle events
- Redis operations
- Error tracking

### Redis Monitoring
```bash
# Monitor session ownership
redis-cli KEYS "session:*:owner"

# Watch real-time operations
redis-cli MONITOR | grep "session:"

# Check active sessions
redis-cli PUBSUB CHANNELS "mcp:shttp:toserver:*"

# Debug specific session
redis-cli GET "session:{sessionId}:owner"
```

### Debug Tools
- MCP Inspector for interactive debugging
- Comprehensive test suite
- Hot-reload development mode
- Source maps for debugging
- Redis monitoring commands

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Run linting and fix issues
7. Submit a pull request

### Code Style
- TypeScript with strict mode
- ESLint configuration included
- Prettier formatting recommended
- Comprehensive type definitions

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built by the Model Context Protocol team as a reference implementation for the MCP ecosystem.

## Links

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP Concepts](https://modelcontextprotocol.io/docs/concepts)
  - [Tools](https://modelcontextprotocol.io/docs/concepts/tools)
  - [Resources](https://modelcontextprotocol.io/docs/concepts/resources)
  - [Prompts](https://modelcontextprotocol.io/docs/concepts/prompts)
  - [Sampling](https://modelcontextprotocol.io/docs/concepts/sampling)
  - [Transports](https://modelcontextprotocol.io/docs/concepts/transports)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Example Servers](https://github.com/modelcontextprotocol/servers)