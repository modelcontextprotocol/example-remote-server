import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { createMcpServer } from "../services/mcp.js";
import { redisClient } from "../redis.js";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import http from "http";

// Configuration
const NODE_ID = process.env.NODE_ID || randomUUID();
const REDIS_PREFIX = "mcp:streamable";

// Session registry for multi-node support
class RedisSessionRegistry {
  async registerSession(sessionId: string): Promise<void> {
    const key = `${REDIS_PREFIX}:session:${sessionId}`;
    const value = JSON.stringify({
      nodeId: NODE_ID,
      createdAt: Date.now(),
      lastActivity: Date.now()
    });
    await redisClient.setEx(key, 3600, value); // 1 hour TTL
  }

  async getSessionNode(sessionId: string): Promise<string | null> {
    const key = `${REDIS_PREFIX}:session:${sessionId}`;
    const data = await redisClient.get(key);
    if (!data) return null;
    const parsed = JSON.parse(data);
    return parsed.nodeId;
  }

  async touchSession(sessionId: string): Promise<void> {
    const key = `${REDIS_PREFIX}:session:${sessionId}`;
    const data = await redisClient.get(key);
    if (data) {
      const parsed = JSON.parse(data);
      parsed.lastActivity = Date.now();
      await redisClient.setEx(key, 3600, JSON.stringify(parsed));
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    const key = `${REDIS_PREFIX}:session:${sessionId}`;
    await redisClient.del(key);
  }
}

const sessionRegistry = new RedisSessionRegistry();
const transports = new Map<string, StreamableHTTPServerTransport>();

// Node registry for discovering other nodes
const nodeRegistry = new Map<string, string>(); // nodeId -> address

// Register this node (in production, this would come from config)
async function registerNode() {
  const nodeAddress = process.env.NODE_ADDRESS || `localhost:${process.env.PORT || 3000}`;
  await redisClient.setEx(
    `${REDIS_PREFIX}:node:${NODE_ID}`,
    120, // 2 minute TTL, refreshed by heartbeat
    nodeAddress
  );

  // Heartbeat to keep node registration alive
  setInterval(async () => {
    await redisClient.setEx(`${REDIS_PREFIX}:node:${NODE_ID}`, 120, nodeAddress);
  }, 60000); // Every minute
}

// Discover other nodes
async function discoverNodes() {
  const keys = await redisClient.keys(`${REDIS_PREFIX}:node:*`);
  for (const key of keys) {
    const nodeId = key.split(':').pop()!;
    if (nodeId !== NODE_ID) {
      const address = await redisClient.get(key);
      if (address) {
        nodeRegistry.set(nodeId, address);
      }
    }
  }
}

// Initialize node discovery after Redis connects
let nodeDiscoveryInitialized = false;

export async function initializeNodeDiscovery() {
  if (!nodeDiscoveryInitialized) {
    nodeDiscoveryInitialized = true;
    await registerNode();
    await discoverNodes();
    setInterval(discoverNodes, 30000); // Every 30 seconds
  }
}

// Removed auth context - authentication is now optional

// Forward request to another node
async function forwardRequest(
  targetNodeAddress: string,
  req: Request,
  res: Response
): Promise<void> {
  const url = `http://${targetNodeAddress}${req.originalUrl}`;
  
  console.log(`[node ${NODE_ID}] Forwarding ${req.method} to ${url}`);
  console.log(`[node ${NODE_ID}] Original headers:`, req.headers);
  console.log(`[node ${NODE_ID}] Body:`, req.body);

  // Clean up headers for forwarding
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['host'];
  delete forwardHeaders['content-length'];
  delete forwardHeaders['transfer-encoding'];
  
  const proxyReq = http.request(url, {
    method: req.method,
    headers: {
      ...forwardHeaders,
      'x-forwarded-for': req.ip || req.connection.remoteAddress,
      'x-forwarded-by': NODE_ID,
      'host': targetNodeAddress.split(':')[0]
    }
  });

  // Handle errors
  proxyReq.on('error', (err) => {
    console.error(`[node ${NODE_ID}] Proxy error:`, err);
    if (!res.headersSent) {
      res.status(502).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Proxy error' },
        id: req.body?.id || null
      });
    }
  });

  // Write request body if present
  if (req.body) {
    const bodyStr = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
    proxyReq.write(bodyStr);
  }
  proxyReq.end();

  // Stream response back
  proxyReq.on('response', (proxyRes) => {
    console.log(`[node ${NODE_ID}] Forwarding response: ${proxyRes.statusCode}`);
    
    // Capture error responses for debugging
    if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
      let errorBody = '';
      proxyRes.on('data', chunk => errorBody += chunk);
      proxyRes.on('end', () => {
        console.log(`[node ${NODE_ID}] Error response body:`, errorBody);
        res.status(proxyRes.statusCode).send(errorBody);
      });
    } else {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    }
  });
}

// Main handler for all HTTP methods
export async function handleStreamableHTTP(req: Request, res: Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Check if we need to forward this request
  if (sessionId && !transports.has(sessionId)) {
    console.info(`[node ${NODE_ID}] Session ${sessionId} not found locally, checking session registry...`);
    const ownerNode = await sessionRegistry.getSessionNode(sessionId);

    if (ownerNode && ownerNode !== NODE_ID) {
      const targetAddress = nodeRegistry.get(ownerNode);
      if (targetAddress) {
        console.info(`[node ${NODE_ID}] Forwarding request for session ${sessionId} to node ${ownerNode}`);
        await forwardRequest(targetAddress, req, res);
        return;
      } else {
        // Node not found in registry
        res.status(503).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Session node unavailable' },
          id: req.body?.id || null
        });
        return;
      }
    } else if (!ownerNode) {
      // Session not found
      res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Session not found' },
        id: req.body?.id || null
      });
      return;
    }
  }

  // Handle locally
  if (req.method === 'POST') {
    await handlePostRequest(req, res);
  } else if (req.method === 'GET') {
    await handleGetRequest(req, res);
  } else if (req.method === 'DELETE') {
    await handleDeleteRequest(req, res);
  } else {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null
    });
  }
}

async function handlePostRequest(req: Request, res: Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    // Existing session
    transport = transports.get(sessionId)!;
    await sessionRegistry.touchSession(sessionId);
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New session
    const { server: mcpServer, cleanup: mcpCleanup } = createMcpServer();

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (newSessionId) => {
        console.info(`[node ${NODE_ID}] Session initialized: ${newSessionId}`);
        transports.set(newSessionId, transport);
        await sessionRegistry.registerSession(newSessionId);
      }
    });

    transport.onclose = async () => {
      const sid = transport.sessionId;
      if (sid) {
        console.info(`[node ${NODE_ID}] Session closed: ${sid}`);
        transports.delete(sid);
        await sessionRegistry.removeSession(sid);
        await mcpCleanup();
      }
    };

    await mcpServer.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: sessionId ? 'Session not found' : 'No session ID provided'
      },
      id: req.body?.id || null
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
}

async function handleGetRequest(req: Request, res: Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports.get(sessionId)!;
  await sessionRegistry.touchSession(sessionId);
  await transport.handleRequest(req, res);
}

async function handleDeleteRequest(req: Request, res: Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.info(`[node ${NODE_ID}] Shutting down...`);

  // Close all transports
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`[node ${NODE_ID}] Error closing transport for session ${sessionId}:`, error);
    }
  }

  // Remove node from registry
  await redisClient.del(`${REDIS_PREFIX}:node:${NODE_ID}`);

  process.exit(0);
});