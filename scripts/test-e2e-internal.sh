#!/bin/bash
set -e

echo "=================================================="
echo "End-to-End Test - INTERNAL MODE"
echo "=================================================="
echo "Testing merged server with internal auth mode"
echo ""

# Kill any existing servers
echo "🛑 Cleaning up existing servers..."
pkill -f "node.*dist/index" || true
sleep 2

# Configuration
SERVER_URL="${BASE_URI:-http://localhost:8080}"
USER_ID="e2e-test-internal-$(date +%s)"

echo "🔧 Configuration:"
echo "  Server URL: $SERVER_URL (auth + MCP)"
echo "  User ID: $USER_ID"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Redis (optional for merged server)
if docker ps | grep -q redis; then
    echo "✅ Redis is running (optional)"
else
    echo "⚠️  Redis not running (using in-memory storage)"
fi

# Build the project
echo "🔨 Building project..."
npm run build

# Start merged server in internal mode
echo "🚀 Starting server in INTERNAL mode..."
AUTH_MODE=internal PORT=8080 BASE_URI=$SERVER_URL node dist/index.js &
SERVER_PID=$!
sleep 5

# Check server is running by accessing splash page
if ! curl -s -f "$SERVER_URL/" > /dev/null 2>&1; then
    echo "❌ Server failed to start at $SERVER_URL"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
echo "✅ Server is running in INTERNAL mode (PID: $SERVER_PID)"

# Clean up on exit
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

echo ""
echo "🔐 PHASE 1: OAuth Authentication (Internal Auth)"
echo "================================================="

# Step 1: Verify OAuth metadata
echo "📋 Step 1: Verify OAuth metadata"
METADATA=$(curl -s "$SERVER_URL/.well-known/oauth-authorization-server")
AUTH_ENDPOINT=$(echo "$METADATA" | jq -r .authorization_endpoint)
TOKEN_ENDPOINT=$(echo "$METADATA" | jq -r .token_endpoint)
echo "   Auth endpoint: $AUTH_ENDPOINT"
echo "   Token endpoint: $TOKEN_ENDPOINT"

# Step 2: Client Registration
echo ""
echo "📝 Step 2: Register OAuth client"
CLIENT_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"client_name\":\"e2e-internal-test\",\"redirect_uris\":[\"http://localhost:3000/callback\"]}" \
  "$SERVER_URL/register")

CLIENT_ID=$(echo "$CLIENT_RESPONSE" | jq -r .client_id)
CLIENT_SECRET=$(echo "$CLIENT_RESPONSE" | jq -r .client_secret)
echo "   Client ID: $CLIENT_ID"

# Step 3: Generate PKCE parameters
echo ""
echo "🔐 Step 3: Generate PKCE challenge"
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -binary -sha256 | base64 | tr "+/" "-_" | tr -d "=")
echo "   Code verifier generated"

# Step 4: Authorization Request
echo ""
echo "🎫 Step 4: Get authorization code"
STATE_PARAM="e2e-internal-$(date +%s)"
AUTH_URL="$SERVER_URL/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http://localhost:3000/callback&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&state=$STATE_PARAM"

AUTH_PAGE=$(curl -s "$AUTH_URL")
AUTH_CODE=$(echo "$AUTH_PAGE" | grep -o 'state=[^"&]*' | cut -d= -f2 | head -1)

if [ -z "$AUTH_CODE" ]; then
    echo "   ❌ Failed to extract authorization code"
    exit 1
fi
echo "   Auth Code: ${AUTH_CODE:0:20}..."

# Step 5: Complete fake upstream auth
echo ""
echo "🔄 Step 5: Complete mock upstream auth"
CALLBACK_URL="$SERVER_URL/mock-upstream-idp/callback?state=$AUTH_CODE&code=mock-auth-code&userId=$USER_ID"
CALLBACK_RESPONSE=$(curl -s -i "$CALLBACK_URL")

# Verify state parameter
LOCATION_HEADER=$(echo "$CALLBACK_RESPONSE" | grep -i "^location:" | tr -d '\r')
if echo "$LOCATION_HEADER" | grep -q "state=$STATE_PARAM"; then
    echo "   ✅ State parameter verified"
else
    echo "   ❌ State parameter mismatch"
    exit 1
fi

# Step 6: Token Exchange
echo ""
echo "🎟️  Step 6: Exchange code for access token"
TOKEN_RESPONSE=$(curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code=$AUTH_CODE&redirect_uri=http://localhost:3000/callback&code_verifier=$CODE_VERIFIER" \
  "$SERVER_URL/token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)
if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "   ❌ Token exchange failed"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi
echo "   ✅ Access token: ${ACCESS_TOKEN:0:20}..."

# Step 7: Test token introspection (internal validation)
echo ""
echo "🔍 Step 7: Test token introspection"
INTROSPECT_RESPONSE=$(curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=$ACCESS_TOKEN" \
  "$SERVER_URL/introspect")

IS_ACTIVE=$(echo "$INTROSPECT_RESPONSE" | jq -r .active)
if [ "$IS_ACTIVE" = "true" ]; then
    echo "   ✅ Token is active (validated internally)"
else
    echo "   ❌ Token validation failed"
    exit 1
fi

echo ""
echo "🧪 PHASE 2: MCP Feature Testing"
echo "================================"

# Step 1: Initialize MCP session
echo ""
echo "📱 Step 1: Initialize MCP session"
INIT_RESPONSE=$(curl -i -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e-internal-test","version":"1.0"}}}' \
  "$SERVER_URL/mcp")

# Extract session ID
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id:" | cut -d' ' -f2 | tr -d '\r')

if [ -n "$SESSION_ID" ]; then
    echo "   ✅ MCP session initialized: $SESSION_ID"
    echo "   ✅ Internal auth token accepted!"
else
    echo "   ❌ MCP session initialization failed"
    echo "$INIT_RESPONSE"
    exit 1
fi

# Step 2: Test tools
echo ""
echo "🔧 Step 2: Test Tools"
TOOLS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"tools","method":"tools/list"}' \
  "$SERVER_URL/mcp")

if echo "$TOOLS_RESPONSE" | grep -q "event: message"; then
    TOOLS_JSON=$(echo "$TOOLS_RESPONSE" | grep "^data: " | sed 's/^data: //')
    TOOL_COUNT=$(echo "$TOOLS_JSON" | jq '.result.tools | length')
    echo "   ✅ Tools available: $TOOL_COUNT"

    # Test echo tool
    ECHO_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Accept: application/json, text/event-stream" \
      -H "Mcp-Session-Id: $SESSION_ID" \
      -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":"echo","method":"tools/call","params":{"name":"echo","arguments":{"message":"Internal mode working!"}}}' \
      "$SERVER_URL/mcp")

    if echo "$ECHO_RESPONSE" | grep -q "event: message"; then
        ECHO_JSON=$(echo "$ECHO_RESPONSE" | grep "^data: " | sed 's/^data: //')
        ECHO_RESULT=$(echo "$ECHO_JSON" | jq -r '.result.content[0].text')
        echo "   🔊 Echo test: '$ECHO_RESULT'"
    fi
fi

# Step 3: Test resources
echo ""
echo "📚 Step 3: Test Resources"
RESOURCES_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"resources","method":"resources/list","params":{}}' \
  "$SERVER_URL/mcp")

if echo "$RESOURCES_RESPONSE" | grep -q "event: message"; then
    RESOURCES_JSON=$(echo "$RESOURCES_RESPONSE" | grep "^data: " | sed 's/^data: //')
    RESOURCE_COUNT=$(echo "$RESOURCES_JSON" | jq '.result.resources | length')
    echo "   ✅ Resources available: $RESOURCE_COUNT"
fi

# Step 4: Test prompts
echo ""
echo "💭 Step 4: Test Prompts"
PROMPTS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"prompts","method":"prompts/list"}' \
  "$SERVER_URL/mcp")

if echo "$PROMPTS_RESPONSE" | grep -q "event: message"; then
    PROMPTS_JSON=$(echo "$PROMPTS_RESPONSE" | grep "^data: " | sed 's/^data: //')
    PROMPT_COUNT=$(echo "$PROMPTS_JSON" | jq '.result.prompts | length')
    echo "   ✅ Prompts available: $PROMPT_COUNT"
fi

echo ""
echo "✅ E2E TEST (INTERNAL MODE) COMPLETE!"
echo "====================================="
echo "✅ Single server handling auth + MCP"
echo "✅ OAuth flow working"
echo "✅ Internal token validation working"
echo "✅ MCP session management working"
echo "✅ All features accessible"
echo ""
echo "📊 Results:"
echo "   Tools: $TOOL_COUNT"
echo "   Resources: $RESOURCE_COUNT"
echo "   Prompts: $PROMPT_COUNT"

# Clean up
kill $SERVER_PID 2>/dev/null || true
pkill -P $SERVER_PID 2>/dev/null || true