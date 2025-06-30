import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import contentType from "content-type";
import { Request, Response } from "express";
import getRawBody from "raw-body";
import { redisClient } from "../redis.js";
import { createMcpServer } from "../services/mcp.js";
import { logMcpMessage } from "./common.js";

const MAXIMUM_MESSAGE_SIZE = "4mb";

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
  console.info(`[session ${transport.sessionId}] Received MCP SSE connection`);

  const redisCleanup = await redisClient.createSubscription(
    redisChannelForSession(transport.sessionId),
    (json) => {
      // TODO handle DELETE messages
      // TODO set timeout to kill the session

      const message = JSON.parse(json);
      logMcpMessage(message, transport.sessionId);
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
