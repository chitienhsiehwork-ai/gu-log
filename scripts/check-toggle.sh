#!/bin/bash
# Check that toggle buttons work correctly
# This tests by checking if the event delegation script exists in the build output

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"

if [ ! -d "$DIST_DIR" ]; then
    echo "❌ dist/ not found. Run 'npm run build' first."
    exit 1
fi

echo "🔍 Checking toggle button scripts..."

# Check for event delegation pattern in the built JS
# Note: minified JS uses o.target.closest pattern
DELEGATION_PATTERN='\.target\.closest\("\.toggle-header"\)'

# Find a post that HAS toggle-container (not all posts have Toggle components)
SAMPLE_FILE=$(grep -l 'toggle-container' "$DIST_DIR"/posts/*/index.html | head -1)

if [ -z "$SAMPLE_FILE" ]; then
    echo "⚠ No posts with toggle-container found, skipping delegation check"
else
    # Check if the event delegation pattern exists
    if grep -qE "$DELEGATION_PATTERN" "$SAMPLE_FILE"; then
        echo "✓ Event delegation pattern found in: ${SAMPLE_FILE#$DIST_DIR/}"
    else
        echo "❌ Event delegation pattern NOT found!"
        echo "  Toggle buttons may not work correctly."
        echo "  Expected pattern: document.addEventListener('click', ...) with closest('.toggle-header')"
        echo "  Sample file: $SAMPLE_FILE"
        exit 1
    fi
fi

# Check that all toggle-containers have toggle-headers
echo "🔍 Checking toggle HTML structure..."

BROKEN_COUNT=0
for html_file in "$DIST_DIR"/posts/*/index.html; do
    [ -f "$html_file" ] || continue
    
    # Count toggle-containers
    CONTAINER_COUNT=$(grep -o 'class="toggle-container' "$html_file" | wc -l || echo "0")
    
    # Count toggle-headers
    HEADER_COUNT=$(grep -o 'class="toggle-header' "$html_file" | wc -l || echo "0")
    
    if [ "$CONTAINER_COUNT" -ne "$HEADER_COUNT" ]; then
        REL_PATH="${html_file#$DIST_DIR/}"
        echo "  ⚠ $REL_PATH (containers: $CONTAINER_COUNT, headers: $HEADER_COUNT)"
        BROKEN_COUNT=$((BROKEN_COUNT + 1))
    fi
done

echo ""
if [ "$BROKEN_COUNT" -gt 0 ]; then
    echo "⚠ Found $BROKEN_COUNT files with mismatched toggle structure"
fi

echo "✓ Toggle check complete!"
exit 0
