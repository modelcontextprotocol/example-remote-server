import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { getFirstShttpTransport, getShttpTransport, isLive, startServerListeningToRedis } from "../services/redisTransport.js";
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
  console.log('=== handleStreamableHTTP START ===');
  console.log('Received MCP request:', JSON.stringify(req.body, null, 2));
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  
  let shttpTransport: StreamableHTTPServerTransport | undefined = undefined;
  let cleanup: (() => Promise<void>) | undefined = undefined;
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    console.log('Session ID from headers:', sessionId);

    if (sessionId && await isLive(sessionId)) {
      console.log('Session is live, reusing existing transport for session:', sessionId);
      // Reuse existing transport
      ({ shttpTransport, cleanup } = await getShttpTransport(sessionId));

      console.log('Created transport for session:', sessionId);
      console.log('Retrieved transport from Redis for session:', sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log('New initialization request detected, creating new session');
      // New initialization request - use JSON response mode
      const sessionId = randomUUID();
      console.log('Generated new session ID:', sessionId);
      
      const server = createMcpServer();
      console.log('Created MCP server instance');
      
      await startServerListeningToRedis(server, sessionId)
      console.log('Started server listening to Redis for session:', sessionId);
      
      ({ shttpTransport, cleanup } = await getFirstShttpTransport(sessionId));
      console.log('Retrieved first transport for session:', sessionId);
      console.log('Transport object:', shttpTransport.constructor.name, 'sessionId:', shttpTransport.sessionId);
    } else {
      console.log('Invalid request - no session ID and not an initialization request');
      console.log('Session ID present:', !!sessionId);
      console.log('Is initialize request:', isInitializeRequest(req.body));
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      console.log('Sent 400 Bad Request response');
      console.log('=== handleStreamableHTTP END (bad request) ===');
      return;
    }

    // Handle the request with existing transport - no need to reconnect
    console.log('Handling request with existing transport for session:', sessionId);
    console.log('Transport object:', shttpTransport.constructor.name, 'sessionId:', shttpTransport.sessionId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));    
    await shttpTransport.handleRequest(req, res, req.body);
    console.log('Request handled successfully');
  } catch (error) {
    console.error('=== ERROR in handleStreamableHTTP ===');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Error handling MCP request:', error);
    
    if (!res.headersSent) {
      console.log('Sending 500 Internal Server Error response');
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    } else {
      console.log('Response headers already sent, cannot send error response');
    }
  } finally {
    // Set up cleanup when response is complete
    res.on('finish', async () => {
      console.log('HTTP response finished, closing transport');
      await shttpTransport?.close();
      if (cleanup) {
        await cleanup();
      }
      console.log('Transport closed after response');
    });
    console.log('=== handleStreamableHTTP END ===');
  }
}
