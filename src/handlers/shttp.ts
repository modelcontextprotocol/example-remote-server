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

    // if no userid, return 401, we shouldn't get here ideally
    if (!userId) {
      logger.warning('Request without user ID', {
        sessionId,
        hasAuth: !!req.auth
      });
      res.status(401)
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
        res.status(401)
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

      const sessionId = randomUUID();
      shttpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        onsessionclosed,
        onsessioninitialized,
      });
      shttpTransport.onclose = await redisRelayToMcpServer(sessionId, shttpTransport);
    } else {
      // Invalid request - no session ID and not initialization request
      logger.warning('Invalid request: no session ID and not initialization', {
        hasSessionId: !!sessionId,
        isInitRequest: false,
        userId,
        method: req.method
      });
      res.status(400)
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
      res.status(500)
    }
  }
}
