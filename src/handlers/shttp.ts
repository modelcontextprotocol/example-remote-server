import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { getShttpTransport, isSessionOwnedBy, redisRelayToMcpServer, ServerRedisTransport, setSessionOwner, shutdownSession } from "../services/redisTransport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { createMcpServer } from "../services/mcp.js";
import { logger } from "../utils/logger.js";


declare module "express-serve-static-core" {
  interface Request {
    /**
     * Information about the validated access token, if the `requireBearerAuth` middleware was used.
     */
    auth?: AuthInfo;
  }
}

function getUserIdFromAuth(auth?: AuthInfo): string | null {
  return auth?.extra?.userId as string || null;
}

// TODO: Document Streamable HTTP implementation choices:
// 1. STATEFUL: Requires clients to initialize sessions and track session IDs
//    - First request must be 'initialize' without Mcp-Session-Id header
//    - Server returns session ID, client must include it in subsequent requests
//    - Alternative: Could implement STATELESS mode (each request independent)
// 2. SSE RESPONSES: Returns results via Server-Sent Events stream, not JSON responses
//    - Requires Accept: application/json, text/event-stream header
//    - Responses formatted as: event: message\ndata: {...}
//    - Alternative: Could use JSON response mode (check StreamableHTTPServerTransport options)

export async function handleStreamableHTTP(req: Request, res: Response) {
  let shttpTransport: StreamableHTTPServerTransport | undefined = undefined;

  res.on('finish', async () => {
    await shttpTransport?.close();
  });

  const onsessionclosed = async (sessionId: string) => {
    logger.info('Session closed callback triggered', {
      sessionId,
      userId: getUserIdFromAuth(req.auth)
    });
    await shutdownSession(sessionId);
  }

  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const userId = getUserIdFromAuth(req.auth);

    logger.debug('SHTTP request received', {
      method: req.method,
      sessionId,
      userId,
      hasAuth: !!req.auth,
      authExtra: req.auth?.extra
    });

    // if no userid, return 401, we shouldn't get here ideally
    if (!userId) {
      logger.warning('Request without user ID', {
        sessionId,
        hasAuth: !!req.auth
      });
      res.status(401).json({
        "jsonrpc": "2.0",
        "error": {
          "code": -32002,
          "message": "User ID required"
        }
      });
      return;
    }

    const isGetRequest = req.method === 'GET';

    // incorrect session for the authed user, return 401
    if (sessionId) {
      if (!(await isSessionOwnedBy(sessionId, userId))) {
        logger.warning('Session ownership mismatch', {
          sessionId,
          userId,
          requestMethod: req.method
        });
        res.status(401).json({
          "jsonrpc": "2.0",
          "error": {
            "code": -32001,
            "message": "Session not found or access denied"
          }
        });
        return;
      }
      // Reuse existing transport for owned session
      logger.info('Reusing existing session', {
        sessionId,
        userId,
        isGetRequest
      });
      shttpTransport = await getShttpTransport(sessionId, onsessionclosed, isGetRequest);
    } else if (isInitializeRequest(req.body)) {
      // New initialization request - use JSON response mode
      logger.debug('Processing initialize request', {
        body: req.body,
        userId,
        headerSessionId: sessionId, // This is the sessionId from header (should be undefined for init)
        isInitializeRequest: true
      });
      
      const onsessioninitialized = async (sessionId: string) => {
        logger.info('Initializing new session', {
          sessionId,
          userId
        });
        
        const { server, cleanup: mcpCleanup } = createMcpServer();

        const serverRedisTransport = new ServerRedisTransport(sessionId);
        serverRedisTransport.onclose = mcpCleanup;
        await server.connect(serverRedisTransport)
      
        // Set session ownership
        await setSessionOwner(sessionId, userId);
        
        logger.info('Session initialized successfully', {
          sessionId,
          userId
        });
      }

      const newSessionId = randomUUID();
      shttpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessionclosed,
        onsessioninitialized,
      });
      shttpTransport.onclose = await redisRelayToMcpServer(newSessionId, shttpTransport);
    } else {
      // Invalid request - no session ID and not initialization request
      logger.warning('Invalid request: no session ID and not initialization', {
        hasSessionId: !!sessionId,
        isInitRequest: false,
        userId,
        method: req.method
      });
      res.status(400).json({
        "jsonrpc": "2.0",
        "error": {
          "code": -32600,
          "message": "Invalid request method for existing session"
        }
      });
      return;
    }
    // Handle the request with existing transport - no need to reconnect
    await shttpTransport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('Error handling MCP request', error as Error, {
      sessionId: req.headers['mcp-session-id'] as string | undefined,
      method: req.method,
      userId: getUserIdFromAuth(req.auth)
    });
    
    if (!res.headersSent) {
      res.status(500).json({
        "jsonrpc": "2.0",
        "error": {
          "code": -32603,
          "message": "Internal error during request processing"
        }
      });
    }
  }
}
