import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { getFirstShttpTransport, getShttpTransport, isLive, shutdownSession, startServerListeningToRedis } from "../services/redisTransport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { createMcpServer } from "../services/mcp.js";


declare module "express-serve-static-core" {
  interface Request {
    /**
     * Information about the validated access token, if the `requireBearerAuth` middleware was used.
     */
    auth?: AuthInfo;
  }
}

export async function handleStreamableHTTP(req: Request, res: Response) {
  let shttpTransport: StreamableHTTPServerTransport | undefined = undefined;
  let cleanup: (() => Promise<void>) | undefined = undefined;
  try {
    // Handle DELETE requests for session termination
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      
      if (!sessionId) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session ID required for DELETE request',
          },
          id: null,
        });
        return;
      }

      // Check if session exists
      if (!(await isLive(sessionId))) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Session not found',
          },
          id: null,
        });
        return;
      }

      // Send shutdown control message to terminate the session
      await shutdownSession(sessionId);

      // Respond with success
      res.status(200).json({
        jsonrpc: '2.0',
        result: { status: 'Session terminated successfully' },
        id: null,
      });
      return;
    }

    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && await isLive(sessionId)) {
      // Reuse existing transport
      ({ shttpTransport, cleanup } = await getShttpTransport(sessionId));
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request - use JSON response mode
      const sessionId = randomUUID();
      
      const server = createMcpServer();
      
      await startServerListeningToRedis(server, sessionId);
      
      ({ shttpTransport, cleanup } = await getFirstShttpTransport(sessionId));
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with existing transport - no need to reconnect
    await shttpTransport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  } finally {
    // Set up cleanup when response is complete
    res.on('finish', async () => {
      await shttpTransport?.close();
      if (cleanup) {
        await cleanup();
      }
    });
  }
}
