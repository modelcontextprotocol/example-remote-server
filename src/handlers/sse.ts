import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import contentType from "content-type";
import { Request, Response } from "express";
import { redisClient } from "../redis.js";
import { createMcpServer } from "../services/mcp.js";
import { logMcpMessage } from "./common.js";
import { logger } from "../utils/logger.js";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Information about the validated access token, if the `requireBearerAuth` middleware was used.
     */
    auth?: AuthInfo;
  }
}

function redisChannelForSession(sessionId: string): string {
  return `mcp:${sessionId}`;
}

export async function handleSSEConnection(req: Request, res: Response) {
  const { server: mcpServer, cleanup: mcpCleanup }  = createMcpServer();
  const transport = new SSEServerTransport("/message", res);
  logger.info('Received MCP SSE connection', {
    sessionId: transport.sessionId
  });

  const redisCleanup = await redisClient.createSubscription(
    redisChannelForSession(transport.sessionId),
    (json) => {
      // TODO handle DELETE messages
      // TODO set timeout to kill the session

      const message = JSON.parse(json);
      logMcpMessage(message, transport.sessionId);
      transport.handleMessage(message).catch((error) => {
        logger.error('Error handling message', error as Error, {
          sessionId: transport.sessionId
        });
      });
    },
    (error) => {
      logger.error('Disconnecting due to error in Redis subscriber', error as Error, {
        sessionId: transport.sessionId
      });
      transport
        .close()
        .catch((error) =>
          logger.error('Error closing transport', error as Error, {
            sessionId: transport.sessionId
          }),
        );
    },
  );

  const cleanup = () => {
    void mcpCleanup();
    redisCleanup().catch((error) =>
      logger.error('Error disconnecting Redis subscriber', error as Error, {
        sessionId: transport.sessionId
      }),
    );
  }

  // Clean up Redis subscription when the connection closes
  mcpServer.onclose = cleanup

  logger.info('Listening on Redis channel', {
    sessionId: transport.sessionId,
    channel: redisChannelForSession(transport.sessionId)
  });
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

    body = JSON.stringify(req.body);
  } catch (error) {
    res.status(400).json(error);
    logger.error('Bad POST request', error as Error, {
      sessionId,
      contentType: req.headers['content-type']
    });
    return;
  }
  await redisClient.publish(redisChannelForSession(sessionId), body);
  res.status(202).end();
}
