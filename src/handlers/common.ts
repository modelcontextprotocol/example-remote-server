import { NextFunction, Request, Response } from "express";
import { withContext } from "../context.js";
import { readMcpInstallation } from "../services/auth.js";

import { JSONRPCError, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";

export function logMcpMessage(
  message: JSONRPCError | JSONRPCNotification | JSONRPCRequest | JSONRPCResponse,
  sessionId: string,
) {
  // check if message has a method field
  if ("method" in message) {
    if (message.method === "tools/call") {
      console.info(
        `[session ${sessionId}] Processing ${message.method}, for tool ${message.params?.name}`,
      );
    } else {
      console.info(
        `[session ${sessionId}] Processing ${message.method} method`,
      );
  }
  } else if ("error" in message) {
    console.warn(
      `[session ${sessionId}] Received error message: ${message.error.message}, ${message.error.code}`,
    )
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
