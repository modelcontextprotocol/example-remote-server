#!/usr/bin/env node

/**
 * Simple Node.js MCP Client Example - Manual Implementation
 *
 * This demonstrates how to interact with the MCP server programmatically
 * WITHOUT using the MCP SDK client. This is for educational purposes to
 * show the underlying protocol mechanics.
 *
 * In production, you would use the MCP SDK client which handles:
 * - SSE (Server-Sent Events) parsing
 * - Session management and reconnection logic
 * - Request/response correlation
 * - Error handling and retries
 *
 * For SDK usage, see:
 * @modelcontextprotocol/sdk/client/streamableHttp.js
 *
 * Prerequisites:
 * - Both servers running: npm run dev
 * - Node.js installed
 *
 * Usage:
 * node client.js
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import readline from 'readline';
import crypto from 'crypto';

// Configuration
const MCP_SERVER = 'http://localhost:3232';
const REDIRECT_URI = 'http://localhost:3232/callback';

// AUTH_SERVER will be discovered dynamically from OAuth metadata
// This allows the client to work with both internal and external auth modes
let AUTH_SERVER = null;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Utility functions
const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  section: (msg) => console.log(`\n${colors.bright}${colors.blue}=== ${msg} ===${colors.reset}`)
};

/**
 * Simple HTTP request helper
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Check if this is an SSE response
        if (data.startsWith('event:') || data.includes('\ndata: ')) {
          // Parse SSE format
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6));
                resolve({ status: res.statusCode, headers: res.headers, data: json });
                return;
              } catch {
                // Continue to next line
              }
            }
          }
          // If no JSON found in SSE, return raw data
          resolve({ status: res.statusCode, headers: res.headers, data });
        } else {
          // Try to parse as regular JSON
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, headers: res.headers, data: json });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, data });
          }
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Discover OAuth endpoints from metadata
 */
async function discoverOAuthMetadata() {
  log.section('Discovering OAuth Configuration');

  try {
    const response = await makeRequest(`${MCP_SERVER}/.well-known/oauth-authorization-server`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (response.status === 200 && response.data) {
      log.success('OAuth metadata retrieved');

      // Extract the base URL from the issuer or authorization_endpoint
      const authEndpoint = response.data.authorization_endpoint;
      if (authEndpoint) {
        const url = new URL(authEndpoint);
        AUTH_SERVER = `${url.protocol}//${url.host}`;
        log.info(`Auth server discovered at: ${AUTH_SERVER}`);
      } else {
        throw new Error('No authorization_endpoint found in metadata');
      }

      return response.data;
    } else {
      throw new Error(`Metadata discovery failed (HTTP ${response.status})`);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to MCP server at ${MCP_SERVER}. Make sure it's running (npm run dev).`);
    }
    throw error;
  }
}

/**
 * Step 1: Register OAuth client
 */
async function registerClient() {
  log.section('Registering OAuth Client');

  try {
    const response = await makeRequest(`${AUTH_SERVER}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'node-example-client',
        redirect_uris: [REDIRECT_URI]
      })
    });

    if (response.status === 200 || response.status === 201) {
      log.success('Client registered successfully');
      return {
        clientId: response.data.client_id,
        clientSecret: response.data.client_secret
      };
    } else {
      throw new Error(`Registration failed (HTTP ${response.status}): ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to auth server at ${AUTH_SERVER}. Make sure it's running (npm run dev).`);
    }
    throw error;
  }
}

/**
 * Step 2: Simple OAuth flow (manual for demonstration)
 * In production, use a proper OAuth library
 */
async function performOAuthFlow(clientId, clientSecret) {
  log.section('OAuth Authorization Flow');

  log.info('For this demo, we need you to manually complete the OAuth flow.');
  log.info('In a production app, this would be automated.\n');

  // Generate PKCE challenge (proper S256 implementation)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const authUrl = `${AUTH_SERVER}/authorize?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `code_challenge=${codeChallenge}&` +
    `code_challenge_method=S256&` +
    `state=demo-state`;

  console.log('1. Open this URL in your browser:');
  console.log(`   ${colors.cyan}${authUrl}${colors.reset}\n`);

  console.log('2. Complete the authentication flow');
  console.log('3. You\'ll be redirected to a URL like:');
  console.log(`   ${REDIRECT_URI}?code=AUTHORIZATION_CODE&state=demo-state`);
  console.log(`   ${colors.yellow}(You'll see "Cannot GET /callback" - this is expected!)${colors.reset}\n`);

  console.log('4. Copy the authorization code from the URL in your browser\'s address bar');
  console.log('   The code is the long string after "code=" and before "&state="\n');

  // Get authorization code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('5. Paste the AUTHORIZATION_CODE here: ', async (code) => {
      rl.close();

      // Exchange code for token
      log.info('Exchanging authorization code for access token...');

      const tokenResponse = await makeRequest(`${AUTH_SERVER}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&` +
              `code=${code}&` +
              `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
              `client_id=${clientId}&` +
              `client_secret=${clientSecret}&` +
              `code_verifier=${codeVerifier}`
      });

      if (tokenResponse.data.access_token) {
        log.success('Access token obtained!');
        resolve(tokenResponse.data.access_token);
      } else {
        throw new Error(`Token exchange failed: ${JSON.stringify(tokenResponse.data)}`);
      }
    });
  });
}

/**
 * Step 3: Initialize MCP session
 */
async function initializeMCPSession(accessToken) {
  log.section('Initializing MCP Session');

  const response = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'node-example',
          version: '1.0'
        }
      }
    })
  });

  if (response.data.result) {
    log.success('MCP session initialized');
    const sessionId = response.headers['mcp-session-id'];
    if (!sessionId) {
      throw new Error('No session ID received in headers');
    }
    return sessionId;
  } else if (response.data.error) {
    throw new Error(`Initialization failed: ${response.data.error.message}`);
  } else {
    throw new Error(`Initialization failed: ${JSON.stringify(response.data)}`);
  }
}

/**
 * Step 4: Demonstrate MCP features (tools, resources, prompts)
 */
async function demonstrateMCPFeatures(accessToken, sessionId) {
  log.section('Demonstrating MCP Features');

  // List available tools
  log.info('Fetching available tools...');
  const toolsResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-tools',
      method: 'tools/list'
    })
  });

  if (toolsResponse.data.result && toolsResponse.data.result.tools) {
    console.log(`Found ${toolsResponse.data.result.tools.length} tools:`);
    toolsResponse.data.result.tools.forEach(tool => {
      console.log(`  - ${colors.cyan}${tool.name}${colors.reset}: ${tool.description}`);
    });
  } else if (toolsResponse.data.error) {
    log.error(`Failed to list tools: ${toolsResponse.data.error.message}`);
    return;
  }

  // Call the echo tool
  log.info('\nCalling echo tool...');
  const echoResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'echo-1',
      method: 'tools/call',
      params: {
        name: 'echo',
        arguments: {
          message: 'Hello from Node.js client!'
        }
      }
    })
  });

  if (echoResponse.data.result) {
    console.log('Echo response:', echoResponse.data.result.content);
  } else if (echoResponse.data.error) {
    log.error(`Echo tool failed: ${echoResponse.data.error.message}`);
  }

  // Call the add tool
  log.info('\nCalling add tool (5 + 3)...');
  const addResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'add-1',
      method: 'tools/call',
      params: {
        name: 'add',
        arguments: { a: 5, b: 3 }
      }
    })
  });

  if (addResponse.data.result) {
    console.log('Add result:', addResponse.data.result.content);
  } else if (addResponse.data.error) {
    log.error(`Add tool failed: ${addResponse.data.error.message}`);
  }

  // List resources
  log.info('\nFetching available resources...');
  const resourcesResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-resources',
      method: 'resources/list'
    })
  });

  if (resourcesResponse.data.result && resourcesResponse.data.result.resources) {
    console.log(`Found ${resourcesResponse.data.result.resources.length} resources (showing first 5):`);
    resourcesResponse.data.result.resources.slice(0, 5).forEach(resource => {
      console.log(`  - ${colors.cyan}${resource.uri}${colors.reset}: ${resource.name}`);
    });
  } else if (resourcesResponse.data.error) {
    log.error(`Failed to list resources: ${resourcesResponse.data.error.message}`);
  }

  // List prompts
  log.info('\nFetching available prompts...');
  const promptsResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-prompts',
      method: 'prompts/list'
    })
  });

  if (promptsResponse.data.result && promptsResponse.data.result.prompts) {
    console.log(`Found ${promptsResponse.data.result.prompts.length} prompts:`);
    promptsResponse.data.result.prompts.forEach(prompt => {
      console.log(`  - ${colors.cyan}${prompt.name}${colors.reset}: ${prompt.description}`);
    });
  } else if (promptsResponse.data.error) {
    log.error(`Failed to list prompts: ${promptsResponse.data.error.message}`);
  }

  // Get a specific prompt
  log.info('\nGetting simple_prompt...');
  const getPromptResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'get-prompt',
      method: 'prompts/get',
      params: {
        name: 'simple_prompt'
      }
    })
  });

  if (getPromptResponse.data.result && getPromptResponse.data.result.messages) {
    console.log('Prompt messages:');
    getPromptResponse.data.result.messages.forEach(message => {
      console.log(`  [${message.role}]: ${message.content.text || message.content}`);
    });
  } else if (getPromptResponse.data.error) {
    log.error(`Failed to get prompt: ${getPromptResponse.data.error.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log(`${colors.bright}${colors.blue}MCP Node.js Client Example${colors.reset}`);
  console.log('==========================\n');

  try {
    // Step 0: Discover OAuth metadata
    await discoverOAuthMetadata();

    // Step 1: Register client
    const { clientId, clientSecret } = await registerClient();
    console.log(`Client ID: ${clientId}`);
    console.log(`Client Secret: ${clientSecret}\n`);

    // Step 2: OAuth flow
    const accessToken = await performOAuthFlow(clientId, clientSecret);

    // Step 3: Initialize MCP session
    const sessionId = await initializeMCPSession(accessToken);

    // Step 4: Demonstrate features
    await demonstrateMCPFeatures(accessToken, sessionId);

    log.success('\nExample completed successfully!');

    // Show how to use curl-examples.sh as an alternative
    console.log(`\n${colors.bright}${colors.cyan}Try curl-examples.sh (alternative to this script):${colors.reset}`);
    console.log('─'.repeat(50));
    console.log(`\n${colors.green}Your credentials:${colors.reset}`);
    console.log(`  Access Token: ${colors.yellow}${accessToken}${colors.reset}`);
    console.log(`  Session ID:   ${colors.yellow}${sessionId}${colors.reset}`);
    console.log(`\n${colors.cyan}Create a new session with curl:${colors.reset}`);
    console.log(`  ./examples/curl-examples.sh ${accessToken}`);
    console.log(`\n${colors.cyan}Reuse this session with curl:${colors.reset}`);
    console.log(`  ./examples/curl-examples.sh ${accessToken} ${sessionId}\n`);

  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      log.error('Connection refused - Is the auth server running?');
      log.error(`Could not connect to ${error.address || 'server'}:${error.port || 'unknown'}`);
      console.log('\nMake sure to start the servers first:');
      console.log('  npm run dev');
    } else if (error.message) {
      log.error(`Error: ${error.message}`);
    } else {
      log.error(`Error: ${JSON.stringify(error)}`);
    }
    process.exit(1);
  }
}

// Run the example
main();