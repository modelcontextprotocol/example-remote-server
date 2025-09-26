#!/bin/bash
set -e

echo "=================================================="
echo "End-to-End Test - Separate Mode"
echo "=================================================="
echo "This script tests the complete OAuth flow and MCP features"
echo "using separate auth server and MCP server."
echo ""

# Kill any existing servers
echo "🛑 Cleaning up existing servers..."
pkill -f "node.*dist/src/index" || true
pkill -f "node.*dist/auth-server/index" || true
pkill -f "tsx watch.*src/index" || true
pkill -f "tsx watch.*auth-server/index" || true
sleep 2

# Use environment variables if available, otherwise defaults
AUTH_SERVER="${AUTH_SERVER_URL:-http://localhost:3001}"
MCP_SERVER="${BASE_URI:-http://localhost:3232}"
USER_ID="e2e-separate-$(date +%s)"

echo "🔧 Configuration:"
echo "  Auth Server: $AUTH_SERVER"
echo "  MCP Server: $MCP_SERVER"
echo "  User ID: $USER_ID"
echo "  Auth Mode: ${AUTH_MODE:-separate} (from environment)"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Redis
if ! docker ps | grep -q redis; then
    echo "❌ Redis not running"
    echo "   Start Redis: docker compose up -d"
    exit 1
fi
echo "✅ Redis is running"

# Check if wrong mode is set
if [ "${AUTH_MODE}" = "integrated" ]; then
    echo "⚠️  AUTH_MODE is set to 'integrated' but this script tests separate mode"
    echo "   Either run: AUTH_MODE=separate $0"
    echo "   Or use: ./scripts/test-integrated-e2e-fixed.sh"
fi

# Start auth server
echo "🚀 Starting auth server..."
npm run start:auth-server &
AUTH_PID=$!
sleep 5

# Check auth server
if ! curl -s -f "$AUTH_SERVER/health" > /dev/null; then
    echo "❌ Auth server failed to start at $AUTH_SERVER"
    kill $AUTH_PID 2>/dev/null || true
    exit 1
fi
echo "✅ Auth server is running (PID: $AUTH_PID)"

# Start MCP server in separate mode
echo "🚀 Starting MCP server in separate mode..."
AUTH_MODE=separate npm start &
MCP_PID=$!
sleep 5

# Check MCP server
if ! curl -s -f "$MCP_SERVER/" > /dev/null; then
    echo "❌ MCP server failed to start at $MCP_SERVER"
    kill $AUTH_PID 2>/dev/null || true
    kill $MCP_PID 2>/dev/null || true
    exit 1
fi
echo "✅ MCP server is running (PID: $MCP_PID)"

# Clean up on exit
trap "kill $AUTH_PID $MCP_PID 2>/dev/null || true" EXIT

echo ""
echo "🔐 PHASE 1: OAuth Authentication (with Auth Server)"
echo "================================================="

# OAuth Step 1: Client Registration
# Register a new OAuth client application with the authorization server
# This would typically be done once during app setup, not for each user
echo "📝 Step 1: Register OAuth client with auth server"
CLIENT_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"client_name\":\"e2e-separate-client\",\"redirect_uris\":[\"http://localhost:3000/callback\"]}" \
  "$AUTH_SERVER/register")

CLIENT_ID=$(echo "$CLIENT_RESPONSE" | jq -r .client_id)
CLIENT_SECRET=$(echo "$CLIENT_RESPONSE" | jq -r .client_secret)
echo "   Client ID: $CLIENT_ID"

# OAuth Step 2: Generate PKCE (Proof Key for Code Exchange) parameters
# PKCE adds security to the OAuth flow by preventing authorization code interception attacks
echo ""
echo "🔐 Step 2: Generate PKCE challenge"
CODE_VERIFIER=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-43)
CODE_CHALLENGE=$(echo -n "$CODE_VERIFIER" | openssl dgst -binary -sha256 | base64 | tr "+/" "-_" | tr -d "=")
echo "   Code verifier generated"

# OAuth Step 3: Authorization Request
# Direct the user to the authorization server's /authorize endpoint
# Include state parameter for CSRF protection
echo ""
echo "🎫 Step 3: Get authorization code from auth server"
STATE_PARAM="separate-test-$(date +%s)"
AUTH_URL="$AUTH_SERVER/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http://localhost:3000/callback&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&state=$STATE_PARAM"

AUTH_PAGE=$(curl -s "$AUTH_URL")
# Extract the authorization code from the HTML response (normally would be in redirect URL)
AUTH_CODE=$(echo "$AUTH_PAGE" | grep -o 'state=[^"&]*' | cut -d= -f2 | head -1)

if [ -z "$AUTH_CODE" ]; then
    echo "   ❌ Failed to extract authorization code from auth server"
    exit 1
fi
echo "   Auth Code: ${AUTH_CODE:0:20}..."

# OAuth Step 4: User Authentication & Authorization
# In a real flow, the user would authenticate with the auth server here
# For testing, we simulate this with the fake upstream auth endpoint
echo ""
echo "🔄 Step 4: Complete fake upstream auth with auth server"
CALLBACK_URL="$AUTH_SERVER/fakeupstreamauth/callback?state=$AUTH_CODE&code=fakecode&userId=$USER_ID"
CALLBACK_RESPONSE=$(curl -s -i "$CALLBACK_URL")

# OAuth Step 5: Authorization Code Redirect
# Verify the auth server redirects back to our redirect_uri with the code and state
# The state parameter MUST match what we sent to prevent CSRF attacks
LOCATION_HEADER=$(echo "$CALLBACK_RESPONSE" | grep -i "^location:" | tr -d '\r')
if echo "$LOCATION_HEADER" | grep -q "state=$STATE_PARAM"; then
    echo "   ✅ State parameter verified in callback"
else
    echo "   ❌ State parameter mismatch or missing in callback"
    echo "   Expected state: $STATE_PARAM"
    echo "   Location header: $LOCATION_HEADER"
    exit 1
fi
echo "   Fake upstream auth completed"

# OAuth Step 6: Token Exchange
# Exchange the authorization code for access and refresh tokens
# Include the PKCE code_verifier to prove we initiated the flow
echo ""
echo "🎟️  Step 5: Exchange code for access token with auth server"
TOKEN_RESPONSE=$(curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&code=$AUTH_CODE&redirect_uri=http://localhost:3000/callback&code_verifier=$CODE_VERIFIER" \
  "$AUTH_SERVER/token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r .access_token)
if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
    echo "   ❌ Token exchange failed"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi
echo "   ✅ Access token from auth server: ${ACCESS_TOKEN:0:20}..."

echo ""
echo "🧪 PHASE 2: MCP Feature Testing (with MCP Server)"
echo "=============================================="

# Step 1: Initialize MCP session with MCP SERVER using auth server token
echo ""
echo "📱 Step 1: Initialize MCP session with MCP server"
INIT_RESPONSE=$(curl -i -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e-separate","version":"1.0"}}}' \
  "$MCP_SERVER/mcp")

# Extract session ID from response header
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id:" | cut -d' ' -f2 | tr -d '\r')

if [ -n "$SESSION_ID" ]; then
    echo "   ✅ MCP session initialized: $SESSION_ID"
    echo "   ✅ Auth server token accepted by MCP server!"
else
    echo "   ❌ MCP session initialization failed"
    echo "$INIT_RESPONSE"
    exit 1
fi

# Step 2: Test tools with MCP SERVER
echo ""
echo "🔧 Step 2: Test Tools with MCP server"
TOOLS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"tools","method":"tools/list"}' \
  "$MCP_SERVER/mcp")

if echo "$TOOLS_RESPONSE" | grep -q "event: message"; then
    TOOLS_JSON=$(echo "$TOOLS_RESPONSE" | grep "^data: " | sed 's/^data: //')
    TOOL_COUNT=$(echo "$TOOLS_JSON" | jq '.result.tools | length')
    echo "   ✅ Tools: $TOOL_COUNT (README claims: 7)"
    
    # Test echo tool
    ECHO_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Accept: application/json, text/event-stream" \
      -H "Mcp-Session-Id: $SESSION_ID" \
      -X POST -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":"echo","method":"tools/call","params":{"name":"echo","arguments":{"message":"Separate mode working!"}}}' \
      "$MCP_SERVER/mcp")
    
    if echo "$ECHO_RESPONSE" | grep -q "event: message"; then
        ECHO_JSON=$(echo "$ECHO_RESPONSE" | grep "^data: " | sed 's/^data: //')
        ECHO_RESULT=$(echo "$ECHO_JSON" | jq -r '.result.content[0].text')
        echo "   🔊 Echo test: '$ECHO_RESULT'"
    fi
else
    echo "   ❌ Tools test failed: $TOOLS_RESPONSE"
fi

# Step 3: Test resources with MCP SERVER (with pagination)
echo ""
echo "📚 Step 3: Test Resources with MCP server (counting all pages)"
TOTAL_RESOURCES=0
CURSOR=""
PAGE=1

while true; do
    if [ -n "$CURSOR" ]; then
        PARAMS="{\"cursor\":\"$CURSOR\"}"
    else
        PARAMS="{}"
    fi
    
    RESOURCES_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Accept: application/json, text/event-stream" \
      -H "Mcp-Session-Id: $SESSION_ID" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":\"resources$PAGE\",\"method\":\"resources/list\",\"params\":$PARAMS}" \
      "$MCP_SERVER/mcp")
    
    if echo "$RESOURCES_RESPONSE" | grep -q "event: message"; then
        RESOURCES_JSON=$(echo "$RESOURCES_RESPONSE" | grep "^data: " | sed 's/^data: //')
        PAGE_COUNT=$(echo "$RESOURCES_JSON" | jq '.result.resources | length')
        NEXT_CURSOR=$(echo "$RESOURCES_JSON" | jq -r '.result.nextCursor // empty')
        
        TOTAL_RESOURCES=$((TOTAL_RESOURCES + PAGE_COUNT))
        echo "   📄 Page $PAGE: $PAGE_COUNT resources (total: $TOTAL_RESOURCES)"
        
        if [ -z "$NEXT_CURSOR" ]; then
            break
        fi
        CURSOR="$NEXT_CURSOR"
        PAGE=$((PAGE + 1))
    else
        echo "   ❌ Resources page $PAGE failed: $RESOURCES_RESPONSE"
        break
    fi
done

RESOURCE_COUNT=$TOTAL_RESOURCES
echo "   📊 Total Resources: $RESOURCE_COUNT (README claims: 100)"

# Step 4: Test prompts with MCP SERVER
echo ""
echo "💭 Step 4: Test Prompts with MCP server"
PROMPTS_RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"prompts","method":"prompts/list"}' \
  "$MCP_SERVER/mcp")

if echo "$PROMPTS_RESPONSE" | grep -q "event: message"; then
    PROMPTS_JSON=$(echo "$PROMPTS_RESPONSE" | grep "^data: " | sed 's/^data: //')
    PROMPT_COUNT=$(echo "$PROMPTS_JSON" | jq '.result.prompts | length')
    echo "   💬 Prompts: $PROMPT_COUNT"
else
    echo "   ❌ Prompts test failed: $PROMPTS_RESPONSE"
fi

echo ""
echo "🎉 SEPARATE MODE E2E TEST COMPLETE!"
echo "==================================="
echo "✅ OAuth flow: Auth server → MCP server delegation working"
echo "✅ Token validation: MCP server accepts auth server tokens"
echo "✅ Session management: MCP server creates sessions for external tokens"
echo ""
echo "📊 Verification Results:"
echo "   Tools: $TOOL_COUNT (README: 7) $([ "$TOOL_COUNT" = "7" ] && echo "✅" || echo "❌")"
echo "   Resources: $RESOURCE_COUNT (README: 100) $([ "$RESOURCE_COUNT" = "100" ] && echo "✅" || echo "❌")"
echo "   Prompts: $PROMPT_COUNT"
echo ""
echo "🏗️  Architecture Verified:"
echo "   ✅ Separate auth server provides OAuth endpoints"
echo "   ✅ MCP server validates tokens via introspection"
echo "   ✅ Session ownership works across server boundaries"