#!/bin/bash
set -e

echo "=============================================="
echo "End-to-End Test Suite - All Modes"
echo "=============================================="
echo ""

# Parse command line arguments
MODE="${1:-all}"

case "$MODE" in
    internal)
        echo "🔧 Running INTERNAL mode tests only..."
        bash scripts/test-e2e-internal.sh
        ;;
    external)
        echo "🔧 Running EXTERNAL mode tests only..."
        bash scripts/test-e2e-external.sh
        ;;
    all|"")
        echo "🔧 Running tests for ALL modes..."
        echo ""

        # Run internal mode tests
        echo "▶️  Testing INTERNAL mode..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        if bash scripts/test-e2e-internal.sh; then
            INTERNAL_RESULT="✅ PASSED"
        else
            INTERNAL_RESULT="❌ FAILED"
        fi

        echo ""
        echo ""

        # Run external mode tests
        echo "▶️  Testing EXTERNAL mode..."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        if bash scripts/test-e2e-external.sh; then
            EXTERNAL_RESULT="✅ PASSED"
        else
            EXTERNAL_RESULT="❌ FAILED"
        fi

        # Summary
        echo ""
        echo "=============================================="
        echo "E2E TEST SUITE SUMMARY"
        echo "=============================================="
        echo "Internal Mode: $INTERNAL_RESULT"
        echo "External Mode: $EXTERNAL_RESULT"
        echo ""

        # Exit with error if any test failed
        if [[ "$INTERNAL_RESULT" == *"FAILED"* ]] || [[ "$EXTERNAL_RESULT" == *"FAILED"* ]]; then
            echo "❌ Some tests failed"
            exit 1
        else
            echo "✅ All tests passed!"
        fi
        ;;
    *)
        echo "❌ Invalid mode: $MODE"
        echo "Usage: $0 [internal|external|all]"
        echo "  internal - Test internal mode only"
        echo "  external - Test external mode only"
        echo "  all      - Test both modes (default)"
        exit 1
        ;;
esac