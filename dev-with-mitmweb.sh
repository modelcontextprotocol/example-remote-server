#!/bin/bash
# Easy script to run MCP server with mitmproxy web interface

echo "🚀 Starting MCP server with mitmproxy web UI..."
echo ""
echo "This will:"
echo "  1. Start your MCP server on port 3232"
echo "  2. Start mitmproxy with web UI on port 8081"
echo "  3. Proxy client traffic through port 8080"
echo ""
echo "📡 Connect your MCP client to: http://localhost:8080/mcp"
echo "🌐 View traffic in browser at: http://localhost:8081"
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

# Start mitmweb in reverse proxy mode
mitmweb --mode reverse:http://localhost:3232 --listen-port 8080 --web-port 8081

# This line won't be reached until mitmweb exits
wait
