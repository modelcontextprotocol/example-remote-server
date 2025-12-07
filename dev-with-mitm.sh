#!/bin/bash
# Easy script to run MCP server with mitmproxy intercepting client traffic

echo "🚀 Starting MCP server with mitmproxy..."
echo ""
echo "This will:"
echo "  1. Start your MCP server on port 3232"
echo "  2. Start mitmproxy reverse proxy on port 8080"
echo "  3. Intercept all client → server traffic"
echo ""
echo "📡 Connect your MCP client to: http://localhost:8080/mcp"
echo "🔍 View traffic in mitmproxy TUI"
echo ""
echo "Press Ctrl+C to stop both processes"
echo ""

# Trap Ctrl+C to kill both processes
trap 'kill 0' EXIT

# Start the MCP server in background
npm run dev &
SERVER_PID=$!

# Give server time to start
sleep 3

# Start mitmproxy in reverse proxy mode (foreground so we see the TUI)
mitmproxy --mode reverse:http://localhost:3232 --listen-port 8080

# This line won't be reached until mitmproxy exits
wait
