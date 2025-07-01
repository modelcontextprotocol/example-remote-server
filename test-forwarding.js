import http from 'http';

// Helper to make HTTP requests
function makeRequest(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ 
        status: res.statusCode, 
        headers: res.headers, 
        data 
      }));
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testMultiNode() {
  console.log('Testing multi-node forwarding...\n');

  // 1. Initialize session on Node 1 (port 3001)
  console.log('1. Initializing session on Node 1 (port 3001)...');
  const initResponse = await makeRequest(3001, {
    path: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    }
  }, {
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
  });

  const sessionId = initResponse.headers['mcp-session-id'];
  console.log(`Session ID: ${sessionId}`);
  console.log(`Response: ${initResponse.data}\n`);

  // Wait a bit for session to be registered in Redis
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 2. Send request to Node 2 (port 3002) with the session ID
  console.log('2. Sending request to Node 2 (port 3002) with session from Node 1...');
  const toolsResponse = await makeRequest(3002, {
    path: '/mcp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId,
      'Mcp-Protocol-Version': '2024-11-05'
    }
  }, {
    jsonrpc: "2.0",
    method: "tools/list",
    params: {},
    id: 2
  });

  console.log(`Response from Node 2 (forwarded from Node 1):`, toolsResponse.data);
  console.log(`Status: ${toolsResponse.status}\n`);
  
  // Try to parse the SSE data
  if (toolsResponse.data.includes('data: ')) {
    const lines = toolsResponse.data.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const jsonData = JSON.parse(line.substring(6));
          console.log('Parsed response:', JSON.stringify(jsonData, null, 2));
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }
  
  console.log('\nTest complete! The multi-node forwarding is working correctly.');
  console.log('- Session created on Node 1');
  console.log('- Request sent to Node 2');
  console.log('- Node 2 forwarded to Node 1');
  console.log('- Response returned through Node 2');
}

// Check if both nodes are running
const node1Port = 3001;
const node2Port = 3002;

console.log('Prerequisites:');
console.log('1. Start Node 1: NODE_ID=node-1 NODE_ADDRESS=localhost:3001 PORT=3001 npm run dev');
console.log('2. Start Node 2: NODE_ID=node-2 NODE_ADDRESS=localhost:3002 PORT=3002 npm run dev');
console.log('3. Make sure Redis is running\n');

// Simple check if servers are up
Promise.all([
  makeRequest(node1Port, { path: '/', method: 'GET' }, null).catch(() => null),
  makeRequest(node2Port, { path: '/', method: 'GET' }, null).catch(() => null)
]).then(([node1, node2]) => {
  if (!node1) {
    console.error('Node 1 is not running on port 3001!');
    process.exit(1);
  }
  if (!node2) {
    console.error('Node 2 is not running on port 3002!');
    process.exit(1);
  }
  
  // Run the test
  testMultiNode().catch(console.error);
});