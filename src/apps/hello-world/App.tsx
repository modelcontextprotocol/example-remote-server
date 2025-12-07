/**
 * Simple Hello World MCP App demonstrating the ext-apps SDK with React.
 */
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

const IMPLEMENTATION = { name: "Hello World App", version: "1.0.0" };

function HelloWorldApp() {
  const [toolInput, setToolInput] = useState<Record<string, unknown> | null>(null);
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);

  const { app, error } = useApp({
    appInfo: IMPLEMENTATION,
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = async (input) => {
        console.log("[HelloWorldApp] Received tool input:", input);
        setToolInput(input.arguments ?? {});
      };

      app.ontoolresult = async (result) => {
        console.log("[HelloWorldApp] Received tool result:", result);
        setToolResult(result);
      };

      app.onerror = (err) => console.error("[HelloWorldApp] Error:", err);
    },
  });

  if (error) {
    return (
      <div style={styles.container}>
        <h1 style={styles.error}>Error</h1>
        <p>{error.message}</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div style={styles.container}>
        <p>Connecting to host...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Hello World MCP App</h1>

      <section style={styles.section}>
        <h2>Tool Input</h2>
        {toolInput ? (
          <pre style={styles.code}>{JSON.stringify(toolInput, null, 2)}</pre>
        ) : (
          <p style={styles.muted}>Waiting for tool input...</p>
        )}
      </section>

      <section style={styles.section}>
        <h2>Tool Result</h2>
        {toolResult ? (
          <pre style={styles.code}>{JSON.stringify(toolResult, null, 2)}</pre>
        ) : (
          <p style={styles.muted}>Waiting for tool result...</p>
        )}
      </section>

      <section style={styles.section}>
        <h2>Actions</h2>
        <button
          style={styles.button}
          onClick={() => app.sendMessage({
            role: "user",
            content: [{ type: "text", text: "Hello from MCP App!" }]
          })}
        >
          Send Message to Chat
        </button>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: "1rem",
    maxWidth: "600px",
  },
  title: {
    margin: "0 0 1rem 0",
    fontSize: "1.5rem",
  },
  section: {
    marginBottom: "1.5rem",
  },
  code: {
    background: "#f4f4f4",
    padding: "0.75rem",
    borderRadius: "4px",
    fontSize: "0.875rem",
    overflow: "auto",
  },
  muted: {
    color: "#666",
    fontStyle: "italic",
  },
  button: {
    padding: "0.5rem 1rem",
    fontSize: "1rem",
    cursor: "pointer",
  },
  error: {
    color: "#c00",
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelloWorldApp />
  </StrictMode>
);
