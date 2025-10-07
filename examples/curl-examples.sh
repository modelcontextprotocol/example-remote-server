#!/bin/bash

# =============================================================================
# MCP Server API Examples using curl - Manual Implementation
# =============================================================================
#
# This script demonstrates how to interact with the MCP server using curl
# WITHOUT using the MCP SDK. This is for educational purposes to show the
# underlying protocol mechanics.
#
# In production, you would use the MCP SDK client which handles:
# - SSE (Server-Sent Events) parsing
# - Session management and reconnection logic
# - Request/response correlation
# - Error handling and retries
#
# Before running, ensure both servers are running: npm run dev
#
# Three-step workflow:
#   1. ./curl-examples.sh                    → Register OAuth client, get setup instructions
#   2. ./curl-examples.sh <access_token>     → Initialize MCP session, get session ID
#   3. ./curl-examples.sh <token> <session>  → Run all MCP examples (tools, resources, prompts)
#
# Run with --help for detailed usage information
# =============================================================================

# Configuration
AUTH_SERVER="http://localhost:3001"
MCP_SERVER="http://localhost:3232"
CLIENT_NAME="curl-example-client"
REDIRECT_URI="http://localhost:3000/callback"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================

print_section() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Parse SSE response and extract JSON data
parse_sse_response() {
    local RESPONSE="$1"
    # Check if response is in SSE format
    if echo "$RESPONSE" | grep -q "^event:"; then
        # Extract JSON from SSE format (data: line)
        echo "$RESPONSE" | grep "^data: " | sed 's/^data: //'
    else
        # Return as-is if not SSE format
        echo "$RESPONSE"
    fi
}

# =============================================================================
# OAuth Client Registration
# =============================================================================

register_client() {
    print_section "Registering OAuth Client"

    RESPONSE=$(curl -s -X POST "$AUTH_SERVER/register" \
        -H "Content-Type: application/json" \
        -d "{
            \"client_name\": \"$CLIENT_NAME\",
            \"redirect_uris\": [\"$REDIRECT_URI\"]
        }")

    CLIENT_ID=$(echo "$RESPONSE" | grep -o '"client_id":"[^"]*' | cut -d'"' -f4)
    CLIENT_SECRET=$(echo "$RESPONSE" | grep -o '"client_secret":"[^"]*' | cut -d'"' -f4)

    if [ -n "$CLIENT_ID" ]; then
        print_success "Client registered successfully"
        echo "Client ID: $CLIENT_ID"
        echo "Client Secret: $CLIENT_SECRET"
    else
        print_error "Failed to register client"
        echo "Response: $RESPONSE"
        exit 1
    fi
}

# =============================================================================
# MCP Session Initialization
# =============================================================================

initialize_session() {
    local ACCESS_TOKEN=$1

    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "Access token required"
        print_info "Get a token using MCP Inspector or implement OAuth flow"
        return 1
    fi

    RESPONSE=$(curl -s -i -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{
            "jsonrpc": "2.0",
            "id": "init",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "curl-example",
                    "version": "1.0"
                }
            }
        }')

    # Extract session ID from response headers
    SESSION_ID=$(echo "$RESPONSE" | grep -i "^mcp-session-id:" | cut -d' ' -f2 | tr -d '\r\n')

    # Extract body from response (SSE format)
    BODY=$(echo "$RESPONSE" | sed -n '/^$/,$p' | tail -n +2)

    # Parse SSE response if present
    if echo "$BODY" | grep -q "^event:"; then
        # Extract JSON from SSE format (data: line)
        JSON_DATA=$(echo "$BODY" | grep "^data: " | sed 's/^data: //')
    else
        JSON_DATA="$BODY"
    fi

    # Check for error
    if echo "$JSON_DATA" | grep -q "error"; then
        print_error "Failed to initialize session"
        echo "$JSON_DATA" >&2
        return 1
    elif [ -n "$SESSION_ID" ]; then
        # Return session ID on stdout (for capture by caller)
        echo "$SESSION_ID"
        return 0
    else
        print_error "No session ID received"
        return 1
    fi
}

# =============================================================================
# MCP Tools Examples
# =============================================================================

list_tools() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Available Tools"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-tools",
            "method": "tools/list"
        }')

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

call_echo_tool() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local MESSAGE=${3:-"Hello from curl!"}

    print_section "Calling Echo Tool"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"echo-1\",
            \"method\": \"tools/call\",
            \"params\": {
                \"name\": \"echo\",
                \"arguments\": {
                    \"message\": \"$MESSAGE\"
                }
            }
        }")

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

call_add_tool() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local A=${3:-5}
    local B=${4:-3}

    print_section "Calling Add Tool"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"add-1\",
            \"method\": \"tools/call\",
            \"params\": {
                \"name\": \"add\",
                \"arguments\": {
                    \"a\": $A,
                    \"b\": $B
                }
            }
        }")

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

# =============================================================================
# MCP Resources Examples
# =============================================================================

list_resources() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Resources (First Page)"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-resources",
            "method": "resources/list"
        }')

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

read_resource() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local RESOURCE_URI=${3:-"example://resource/1"}

    print_section "Reading Resource: $RESOURCE_URI"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"read-resource\",
            \"method\": \"resources/read\",
            \"params\": {
                \"uri\": \"$RESOURCE_URI\"
            }
        }")

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

# =============================================================================
# MCP Prompts Examples
# =============================================================================

list_prompts() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Available Prompts"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-prompts",
            "method": "prompts/list"
        }')

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

get_prompt() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local PROMPT_NAME=${3:-"simple_prompt"}

    print_section "Getting Prompt: $PROMPT_NAME"

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"get-prompt\",
            \"method\": \"prompts/get\",
            \"params\": {
                \"name\": \"$PROMPT_NAME\"
            }
        }")

    # Parse SSE response if needed and pretty print
    parse_sse_response "$RESPONSE" | python3 -m json.tool
}

# =============================================================================
# Main Script
# =============================================================================

show_usage() {
    echo -e "${BLUE}MCP Server API Examples - Usage${NC}"
    echo "================================="
    echo
    echo "This script demonstrates MCP API interactions in three steps:"
    echo
    echo -e "  ${GREEN}Step 1: Register OAuth client${NC}"
    echo "    ./curl-examples.sh"
    echo "    → Registers a client and shows how to get an access token"
    echo
    echo -e "  ${GREEN}Step 2: Initialize MCP session${NC}"
    echo "    ./curl-examples.sh <access_token>"
    echo "    → Creates an MCP session and returns a session ID"
    echo
    echo -e "  ${GREEN}Step 3: Run MCP examples${NC}"
    echo "    ./curl-examples.sh <access_token> <session_id>"
    echo "    → Demonstrates tools, resources, and prompts"
    echo
    echo "Options:"
    echo "  --help, -h    Show this help message"
    echo
}

main() {
    # Check for help flag
    if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
        show_usage
        exit 0
    fi

    echo -e "${BLUE}MCP Server API Examples${NC}"
    echo "================================="

    # Check if access token is provided
    ACCESS_TOKEN=$1
    SESSION_ID=$2

    if [ -z "$ACCESS_TOKEN" ]; then
        print_section "Getting Started"
        print_info "This script requires an OAuth access token to demonstrate MCP operations."
        print_info "Since you don't have one yet, let's help you get started!"
        echo
        print_info "First, we'll register an OAuth client for you..."
        echo
        register_client
        echo
        print_section "Next Steps"
        print_info "Now you need to get an access token. You have two options:"
        echo
        print_info "Option 1: Use MCP Inspector (recommended):"
        print_info "  npx -y @modelcontextprotocol/inspector"
        print_info "  Connect to: http://localhost:3232/mcp"
        print_info "  Complete the OAuth flow in the Auth tab"
        echo
        print_info "Option 2: Use the client.js example:"
        print_info "  node examples/client.js"
        echo
        print_info "Once you have an access token, run:"
        print_info "  $0 <your_access_token>"
        exit 0
    fi

    # If we have a token but no session, initialize session
    if [ -z "$SESSION_ID" ]; then
        print_section "Initializing MCP Session"
        RETURNED_SESSION_ID=$(initialize_session "$ACCESS_TOKEN")

        if [ $? -eq 0 ] && [ -n "$RETURNED_SESSION_ID" ]; then
            echo
            print_success "MCP session initialized successfully"
            print_info "Session ID: $RETURNED_SESSION_ID"
            echo
            print_info "To run all MCP examples (tools, resources, prompts), use:"
            echo -e "  ${CYAN}$0 $ACCESS_TOKEN $RETURNED_SESSION_ID${NC}"
            echo
            print_info "For help:"
            echo -e "  ${CYAN}$0 --help${NC}"
        fi
        exit 0
    fi

    # Demonstrate various MCP features
    list_tools "$ACCESS_TOKEN" "$SESSION_ID"
    echo

    call_echo_tool "$ACCESS_TOKEN" "$SESSION_ID" "Hello, MCP!"
    echo

    call_add_tool "$ACCESS_TOKEN" "$SESSION_ID" 10 25
    echo

    list_resources "$ACCESS_TOKEN" "$SESSION_ID"
    echo

    read_resource "$ACCESS_TOKEN" "$SESSION_ID" "example://resource/1"
    echo

    list_prompts "$ACCESS_TOKEN" "$SESSION_ID"
    echo

    get_prompt "$ACCESS_TOKEN" "$SESSION_ID" "simple_prompt"

    print_success "Examples completed!"
}

# Run main function
main "$@"