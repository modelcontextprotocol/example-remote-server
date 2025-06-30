import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { getFirstShttpTransport, getShttpTransport, isLive, startServerListeningToRedis } from "../services/redisTransport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { createMcpServer } from "../services/mcp.js";
import getRawBody from "raw-body";


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
  
  let transport: StreamableHTTPServerTransport | undefined = undefined;
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    console.log('Session ID from headers:', sessionId);

    if (sessionId && await isLive(sessionId)) {
      console.log('Session is live, reusing existing transport for session:', sessionId);
      // Reuse existing transport
      transport = await getShttpTransport(sessionId)
      console.log('Retrieved transport from Redis for session:', sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log('New initialization request detected, creating new session');
      // New initialization request - use JSON response mode
      const sessionId = randomUUID();
      console.log('Generated new session ID:', sessionId);
      
      const server = createMcpServer();
      console.log('Created MCP server instance');
      
      startServerListeningToRedis(server.server, sessionId)
      console.log('Started server listening to Redis for session:', sessionId);
      
      transport = await getFirstShttpTransport(sessionId);
      console.log('Retrieved first transport for session:', sessionId);
      console.log('Transport object:', transport.constructor.name, 'sessionId:', transport.sessionId);

      // Connect the transport to the MCP server BEFORE handling the request
      console.log('Connecting transport to MCP server...');
      await server.server.connect(transport);
      console.log('Transport connected successfully');
      
      console.log('Handling initialization request...');
      await transport.handleRequest(req, res, req.body);
      console.log('Initialization request handled successfully');
      console.log('=== handleStreamableHTTP END (initialization) ===');
      return; // Already handled
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
    console.log('Transport object:', transport.constructor.name, 'sessionId:', transport.sessionId);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    await transport.handleRequest(req, res, req.body);
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
    // if (transport) {
    //   console.log('Closing transport in finally block');
    //   // Close transports because they are ephemeral in this setup.
    //   transport.close();
    //   console.log('Transport closed');
    // }
    console.log('=== handleStreamableHTTP END ===');
  }
}
