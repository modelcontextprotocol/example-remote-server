#!/usr/bin/env node

/**
 * Simple Node.js MCP Client Example
 *
 * This demonstrates how to interact with the MCP server programmatically.
 * It handles the OAuth flow and makes MCP requests.
 *
 * Prerequisites:
 * - Both servers running: npm run dev
 * - Node.js installed
 *
 * Usage:
 * node client.js
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const readline = require('readline');

// Configuration
const AUTH_SERVER = 'http://localhost:3001';
const MCP_SERVER = 'http://localhost:3232';
const REDIRECT_URI = 'http://localhost:8080/callback';

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
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data });
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
 * Step 1: Register OAuth client
 */
async function registerClient() {
  log.section('Registering OAuth Client');

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
    throw new Error(`Registration failed: ${JSON.stringify(response.data)}`);
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

  // Generate PKCE challenge (simplified for demo)
  const codeVerifier = Buffer.from(Math.random().toString()).toString('base64url');
  const codeChallenge = Buffer.from(codeVerifier).toString('base64url');

  const authUrl = `${AUTH_SERVER}/authorize?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `code_challenge=${codeChallenge}&` +
    `code_challenge_method=plain&` +
    `state=demo-state`;

  console.log('1. Open this URL in your browser:');
  console.log(`   ${colors.cyan}${authUrl}${colors.reset}\n`);

  console.log('2. Complete the authentication flow');
  console.log('3. You\'ll be redirected to a URL like:');
  console.log(`   ${REDIRECT_URI}?code=AUTHORIZATION_CODE&state=demo-state\n`);

  // Get authorization code from user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('4. Paste the AUTHORIZATION_CODE here: ', async (code) => {
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
      'Content-Type': 'application/json'
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
    // In a real implementation, extract session ID from headers
    return response.headers['mcp-session-id'] || 'demo-session-id';
  } else {
    throw new Error(`Initialization failed: ${JSON.stringify(response.data)}`);
  }
}

/**
 * Step 4: Demonstrate MCP features
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
      'Content-Type': 'application/json'
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
  }

  // Call the echo tool
  log.info('\nCalling echo tool...');
  const echoResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json'
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
  }

  // Call the add tool
  log.info('\nCalling add tool (5 + 3)...');
  const addResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json'
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
  }

  // List resources
  log.info('\nFetching available resources...');
  const resourcesResponse = await makeRequest(`${MCP_SERVER}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Mcp-Session-Id': sessionId,
      'Content-Type': 'application/json'
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
  }
}

/**
 * Main function
 */
async function main() {
  console.log(`${colors.bright}${colors.blue}MCP Node.js Client Example${colors.reset}`);
  console.log('==========================\n');

  try {
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

  } catch (error) {
    log.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the example
main();