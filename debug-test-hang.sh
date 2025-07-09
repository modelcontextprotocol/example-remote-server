#!/bin/bash

# Script to debug why Jest tests hang after completion

echo "=== Starting Jest test hang debugging ==="
echo "Expected: Tests should exit within 5 seconds"
echo "Actual: Tests hang indefinitely"
echo ""

# Run tests with timeout and capture output
echo "Running tests with 10 second timeout..."
timeout 10s npm test > test_output.log 2>&1 &
TEST_PID=$!

# Monitor the test process
sleep 1
echo "Test process PID: $TEST_PID"

# Wait for either completion or timeout
wait $TEST_PID
EXIT_CODE=$?

echo ""
echo "=== Test Results ==="
if [ $EXIT_CODE -eq 124 ]; then
    echo "❌ TESTS TIMED OUT (hung after 10 seconds)"
else
    echo "✅ Tests completed normally with exit code: $EXIT_CODE"
fi

echo ""
echo "=== Test Output (last 20 lines) ==="
tail -20 test_output.log

echo ""
echo "=== Checking for Jest hanging indicators ==="
if grep -q "Jest did not exit one second after the test run has completed" test_output.log; then
    echo "❌ Found Jest hanging message"
    
    echo ""
    echo "=== Common causes of Jest hanging ==="
    echo "1. Unclosed database connections"
    echo "2. Open timers/intervals"
    echo "3. Open file handles"
    echo "4. Unresolved promises"
    echo "5. WebSocket connections"
    echo "6. Event listeners not cleaned up"
    
    echo ""
    echo "=== Analyzing test files for potential issues ==="
    
    # Check for Redis connections
    echo "Checking for Redis connection issues..."
    grep -r "redisClient" src/ --include="*.test.ts" | head -5
    
    # Check for timers
    echo ""
    echo "Checking for setTimeout/setInterval..."
    grep -r "setTimeout\|setInterval" src/ --include="*.test.ts" | head -5
    
    # Check for event listeners
    echo ""
    echo "Checking for event listeners..."
    grep -r "addEventListener\|on(" src/ --include="*.test.ts" | head -5
    
    echo ""
    echo "=== Suggested fixes ==="
    echo "1. Add --detectOpenHandles to Jest config"
    echo "2. Ensure all Redis connections are closed in afterAll/afterEach"
    echo "3. Clear all timers in test cleanup"
    echo "4. Add explicit process.exit() if needed"
    
else
    echo "✅ No Jest hanging message found"
fi

echo ""
echo "=== Running with --detectOpenHandles ==="
echo "This will show what's keeping Node.js alive..."
timeout 15s npm test -- --detectOpenHandles > detect_handles.log 2>&1 &
DETECT_PID=$!
wait $DETECT_PID
DETECT_EXIT=$?

if [ $DETECT_EXIT -eq 124 ]; then
    echo "❌ --detectOpenHandles also timed out"
else
    echo "✅ --detectOpenHandles completed"
fi

echo ""
echo "=== Open handles output ==="
tail -30 detect_handles.log

echo ""
echo "=== Cleanup ==="
rm -f test_output.log detect_handles.log
echo "Debug complete!"