#!/bin/bash

# =============================================================================
# MCP Server API Examples using curl
# =============================================================================
#
# This script demonstrates how to interact with the MCP server using curl.
# Before running, ensure both servers are running: npm run dev
#
# Usage: ./curl-examples.sh [access_token]
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
        echo
        echo "Save these credentials - you'll need them for the OAuth flow"
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

    print_section "Initializing MCP Session"

    if [ -z "$ACCESS_TOKEN" ]; then
        print_error "Access token required"
        print_info "Get a token using MCP Inspector or implement OAuth flow"
        return 1
    fi

    RESPONSE=$(curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
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

    # Extract session ID from response headers (would need -i flag)
    # For demonstration, we'll parse from response
    echo "Response: $RESPONSE"

    # Check for error
    if echo "$RESPONSE" | grep -q "error"; then
        print_error "Failed to initialize session"
        return 1
    else
        print_success "Session initialized"
        print_info "Save the Mcp-Session-Id header for subsequent requests"
        return 0
    fi
}

# =============================================================================
# MCP Tools Examples
# =============================================================================

list_tools() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Available Tools"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-tools",
            "method": "tools/list"
        }' | python3 -m json.tool
}

call_echo_tool() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local MESSAGE=${3:-"Hello from curl!"}

    print_section "Calling Echo Tool"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
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
        }" | python3 -m json.tool
}

call_add_tool() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local A=${3:-5}
    local B=${4:-3}

    print_section "Calling Add Tool"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
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
        }" | python3 -m json.tool
}

# =============================================================================
# MCP Resources Examples
# =============================================================================

list_resources() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Resources (First Page)"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-resources",
            "method": "resources/list"
        }' | python3 -m json.tool
}

read_resource() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local RESOURCE_URI=${3:-"example://resource/1"}

    print_section "Reading Resource: $RESOURCE_URI"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"read-resource\",
            \"method\": \"resources/read\",
            \"params\": {
                \"uri\": \"$RESOURCE_URI\"
            }
        }" | python3 -m json.tool
}

# =============================================================================
# MCP Prompts Examples
# =============================================================================

list_prompts() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2

    print_section "Listing Available Prompts"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -d '{
            "jsonrpc": "2.0",
            "id": "list-prompts",
            "method": "prompts/list"
        }' | python3 -m json.tool
}

get_prompt() {
    local ACCESS_TOKEN=$1
    local SESSION_ID=$2
    local PROMPT_NAME=${3:-"simple_prompt"}

    print_section "Getting Prompt: $PROMPT_NAME"

    curl -s -X POST "$MCP_SERVER/mcp" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Mcp-Session-Id: $SESSION_ID" \
        -H "Content-Type: application/json" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": \"get-prompt\",
            \"method\": \"prompts/get\",
            \"params\": {
                \"name\": \"$PROMPT_NAME\"
            }
        }" | python3 -m json.tool
}

# =============================================================================
# Main Script
# =============================================================================

main() {
    echo -e "${BLUE}MCP Server API Examples${NC}"
    echo "================================="

    # Check if access token is provided
    ACCESS_TOKEN=$1
    SESSION_ID=$2

    if [ -z "$ACCESS_TOKEN" ]; then
        print_info "No access token provided"
        print_info "Usage: $0 <access_token> [session_id]"
        echo
        print_section "Step 1: Register OAuth Client"
        register_client
        echo
        print_info "To continue, you need to:"
        print_info "1. Complete OAuth flow to get an access token"
        print_info "2. Run: $0 <your_access_token>"
        print_info ""
        print_info "Use MCP Inspector for easy OAuth flow:"
        print_info "npx -y @modelcontextprotocol/inspector"
        print_info "Connect to: http://localhost:3232/mcp"
        exit 0
    fi

    # If we have a token, demonstrate API calls
    if [ -z "$SESSION_ID" ]; then
        initialize_session "$ACCESS_TOKEN"
        print_info "Rerun with: $0 $ACCESS_TOKEN <session_id>"
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