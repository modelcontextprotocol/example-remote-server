#!/usr/bin/env npx tsx
/**
 * Test script to verify the stdio server works correctly.
 * Connects to the server, lists resources, and reads the MCP App resource.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  console.log("Starting stdio client test...\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/stdio.ts"],
  });

  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("Connected to server\n");

  // Initialize
  const serverInfo = client.getServerVersion();
  console.log("Server info:", serverInfo);
  console.log();

  // List resources
  console.log("Listing resources...");
  const resources = await client.listResources();
  console.log(`Found ${resources.resources.length} resources:`);
  for (const resource of resources.resources) {
    console.log(`  - ${resource.name} (${resource.uri})`);
  }
  console.log();

  // Find and read the MCP App resource
  const mcpAppResource = resources.resources.find((r) =>
    r.uri.startsWith("ui://")
  );
  if (mcpAppResource) {
    console.log(`Reading MCP App resource: ${mcpAppResource.uri}`);
    const content = await client.readResource({ uri: mcpAppResource.uri });
    const textContent = content.contents[0];
    if ("text" in textContent) {
      console.log(`  MIME type: ${textContent.mimeType}`);
      console.log(`  Content length: ${textContent.text.length} bytes`);
      console.log(`  First 200 chars: ${textContent.text.slice(0, 200)}...`);
    }
    console.log();
  }

  // List tools
  console.log("Listing tools...");
  const tools = await client.listTools();
  console.log(`Found ${tools.tools.length} tools:`);
  for (const tool of tools.tools) {
    const meta = tool._meta as Record<string, unknown> | undefined;
    const uiUri = meta?.["ui/resourceUri"];
    console.log(
      `  - ${tool.name}${uiUri ? ` (UI: ${uiUri})` : ""}`
    );
  }
  console.log();

  console.log("All tests passed!");
  await client.close();
  // Give the server a moment to clean up before we exit
  setTimeout(() => process.exit(0), 100);
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
