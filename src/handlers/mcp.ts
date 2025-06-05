import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import contentType from "content-type";
import { NextFunction, Request, Response } from "express";
import getRawBody from "raw-body";
import { randomUUID } from "node:crypto";
import { readMcpInstallation } from "../services/auth.js";
import { withContext } from "../context.js";
import { createMcpServer } from "../services/mcp.js";
import { redisClient } from "../redis.js";
import { SessionManager } from "../services/sessionManager.js";
import { MessageDelivery } from "../services/messageDelivery.js";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const MAXIMUM_MESSAGE_SIZE = "4mb";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Information about the validated access token, if the `requireBearerAuth` middleware was used.
     */
    auth?: AuthInfo;
  }
}

export async function authContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authInfo = req.auth

  if (!authInfo) {
    res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    res.status(401).json({ error: "Invalid access token" });
    return;
  }

  const token = authInfo.token;

  // Load UpstreamInstallation based on the access token
  const mcpInstallation = await readMcpInstallation(token);
  if (!mcpInstallation) {
    res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
    res.status(401).json({ error: "Invalid access token" });
    return;
  }

  // Wrap the rest of the request handling in the context
  withContext({ mcpAccessToken: token, fakeUpstreamInstallation: mcpInstallation.fakeUpstreamInstallation }, () =>
    next(),
  );
}

function redisChannelForSession(sessionId: string): string {
  return `mcp:${sessionId}`;
}

export async function handleSSEConnection(req: Request, res: Response) {
  const { server: mcpServer, cleanup: mcpCleanup }  = createMcpServer();
  const transport = new SSEServerTransport("/message", res);
  console.info(`[session ${transport.sessionId}] Received MCP SSE connection`);

  const redisCleanup = await redisClient.createSubscription(
    redisChannelForSession(transport.sessionId),
    (json) => {
      const message = JSON.parse(json);

      if (message.method) {
        if (message.method === "tools/call") {
          console.info(
            `[session ${transport.sessionId}] Processing ${message.method}, for tool ${message.params?.name}`,
          );
        } else {
          console.info(
            `[session ${transport.sessionId}] Processing ${message.method} method`,
          );
      }
      } else if (message.error) {
        console.warn(
          `[session ${transport.sessionId}] Received error message: ${message.error.message}, ${message.error.code}`,
        )
      }
      transport.handleMessage(message).catch((error) => {
        console.error(
          `[session ${transport.sessionId}] Error handling message:`,
          error,
        );
      });
    },
    (error) => {
      console.error(
        `[session ${transport.sessionId}] Disconnecting due to error in Redis subscriber:`,
        error,
      );
      transport
        .close()
        .catch((error) =>
          console.error(
            `[session ${transport.sessionId}] Error closing transport:`,
            error,
          ),
        );
    },
  );

  const cleanup = () => {
    void mcpCleanup();
    redisCleanup().catch((error) =>
      console.error(
        `[session ${transport.sessionId}] Error disconnecting Redis subscriber:`,
        error,
      ),
    );
  }

  // Clean up Redis subscription when the connection closes
  mcpServer.onclose = cleanup

  console.info(`[session ${transport.sessionId}] Listening on Redis channel`);
  await mcpServer.connect(transport);
}

export async function handleMessage(req: Request, res: Response) {
  const sessionId = req.query.sessionId;
  let body: string;
  try {
    if (typeof sessionId !== "string") {
      throw new Error("Only one sessionId allowed");
    }

    const ct = contentType.parse(req.headers["content-type"] ?? "");
    if (ct.type !== "application/json") {
      throw new Error(`Unsupported content-type: ${ct}`);
    }

    body = await getRawBody(req, {
      limit: MAXIMUM_MESSAGE_SIZE,
      encoding: ct.parameters.charset ?? "utf-8",
    });
  } catch (error) {
    res.status(400).json(error);
    console.error("Bad POST request:", error);
    return;
  }
  await redisClient.publish(redisChannelForSession(sessionId), body);
  res.status(202).end();
}

// Initialize session and message delivery services
const sessionManager = new SessionManager(redisClient);
const messageDelivery = new MessageDelivery(redisClient, sessionManager);

/**
 * Handler for the new streamable HTTP transport (/mcp endpoint)
 * Supports GET, POST, and DELETE methods with Redis-based session management
 */
export async function handleStreamableHTTP(req: Request, res: Response) {
  const method = req.method;
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (method === 'POST') {
      await handleStreamableHTTPPost(req, res, sessionId);
    } else if (method === 'GET') {
      await handleStreamableHTTPGet(req, res, sessionId);
    } else if (method === 'DELETE') {
      await handleStreamableHTTPDelete(req, res, sessionId);
    } else {
      res.writeHead(405, { "Allow": "GET, POST, DELETE" }).end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      }));
    }
  } catch (error) {
    console.error(`Error handling streamable HTTP ${method} request:`, error);
    if (!res.headersSent) {
      res.writeHead(500).end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      }));
    }
  }
}

/**
 * Handle POST requests (initialization or message sending)
 */
async function handleStreamableHTTPPost(req: Request, res: Response, sessionId: string | undefined) {
  // Parse request body
  const ct = req.headers["content-type"];
  if (!ct || !ct.includes("application/json")) {
    res.writeHead(415).end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unsupported Media Type: Content-Type must be application/json" },
      id: null
    }));
    return;
  }

  const parsedCt = contentType.parse(ct);
  const body = await getRawBody(req, {
    limit: MAXIMUM_MESSAGE_SIZE,
    encoding: parsedCt.parameters.charset ?? "utf-8",
  });
  const parsedBody = JSON.parse(body.toString());

  if (isInitializeRequest(parsedBody) && !sessionId) {
    // New session initialization
    const newSessionId = randomUUID();
    const authInfo = req.auth;

    console.log(`[streamable-http] Initializing new session: ${newSessionId}`);

    // Create session in Redis
    await sessionManager.createSession(newSessionId, authInfo?.clientId || 'unknown');

    // Create transport with the new session ID
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });

    // Create MCP server and connect transport
    const { server: mcpServer, cleanup: mcpCleanup } = createMcpServer();
    await mcpServer.connect(transport);

    // Handle the initialization request
    await transport.handleRequest(req, res, parsedBody);

    // Clean up after request completes
    res.on('close', mcpCleanup);

  } else if (sessionId) {
    // Existing session - validate and handle request
    const sessionValid = await sessionManager.refreshSession(sessionId);
    if (!sessionValid) {
      res.writeHead(404).end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null
      }));
      return;
    }

    console.log(`[streamable-http] Handling request for existing session: ${sessionId}`);

    // Create ephemeral transport for this request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    // Create MCP server and connect transport
    const { server: mcpServer, cleanup: mcpCleanup } = createMcpServer();
    await mcpServer.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, parsedBody);

    // Clean up after request completes
    res.on('close', mcpCleanup);

  } else {
    // Invalid request - no session ID and not initialization
    res.writeHead(400).end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Session ID required for non-initialization requests" },
      id: null
    }));
  }
}

/**
 * Handle GET requests (SSE stream establishment)
 */
async function handleStreamableHTTPGet(req: Request, res: Response, sessionId: string | undefined) {
  if (!sessionId) {
    res.writeHead(400).end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Session ID required" },
      id: null
    }));
    return;
  }

  // Validate session exists and refresh TTL
  const sessionValid = await sessionManager.refreshSession(sessionId);
  if (!sessionValid) {
    res.writeHead(404).end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null
    }));
    return;
  }

  console.log(`[streamable-http] Establishing SSE stream for session: ${sessionId}`);

  // Create transport for SSE stream
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  // Mark connection as active
  await sessionManager.setConnectionState(sessionId, true);

  // Deliver any buffered messages first
  await messageDelivery.deliverBufferedMessages(sessionId, transport);

  // Set up Redis subscription for live messages
  const redisCleanup = await messageDelivery.setupRedisSubscription(sessionId, transport);

  // Handle connection cleanup when client disconnects
  res.on('close', async () => {
    console.log(`[streamable-http] SSE connection closed for session: ${sessionId}`);
    await sessionManager.setConnectionState(sessionId, false);
    await redisCleanup();
  });

  // Start the SSE stream
  await transport.handleRequest(req, res);
}

/**
 * Handle DELETE requests (session termination)
 */
async function handleStreamableHTTPDelete(req: Request, res: Response, sessionId: string | undefined) {
  if (!sessionId) {
    res.writeHead(400).end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Session ID required" },
      id: null
    }));
    return;
  }

  console.log(`[streamable-http] Deleting session: ${sessionId}`);

  // Delete session from Redis
  await sessionManager.deleteSession(sessionId);
  res.writeHead(200).end();
}
