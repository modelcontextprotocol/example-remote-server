#!/usr/bin/env node
/**
 * Stdio entrypoint for the MCP example server.
 * This allows running the server locally via stdio transport.
 *
 * Usage:
 *   npx tsx src/stdio.ts
 *   # or after building:
 *   node dist/stdio.js
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./modules/mcp/services/mcp.js";

async function main() {
  const { server, cleanup } = createMcpServer();

  const transport = new StdioServerTransport();

  // Handle cleanup on exit
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
