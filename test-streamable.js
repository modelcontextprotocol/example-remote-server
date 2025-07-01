// Simple test for streamable HTTP endpoint
const http = require('http');

// Test initialization request
const initRequest = {
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  },
  id: 1
};

const options = {
  hostname: 'localhost',
  port: 3232,
  path: '/mcp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(JSON.stringify(initRequest))
  }
};

console.log('Sending initialization request to /mcp...');

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers:`, res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', data);
    
    // Extract session ID if present
    const sessionId = res.headers['mcp-session-id'];
    if (sessionId) {
      console.log(`\nSession ID: ${sessionId}`);
      console.log('Use this session ID for subsequent requests');
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(JSON.stringify(initRequest));
req.end();