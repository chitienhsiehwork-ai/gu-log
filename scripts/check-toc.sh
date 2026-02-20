#!/bin/bash
# Check for broken TOC in built HTML files
# Now that TOC is build-time generated, we can verify its content

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"

if [ ! -d "$DIST_DIR" ]; then
    echo "❌ dist/ not found. Run 'pnpm run build' first."
    exit 1
fi

echo "🔍 Checking TOC in built posts..."

BROKEN_COUNT=0
CHECKED_COUNT=0

# Find all post HTML files
for html_file in "$DIST_DIR"/posts/*/index.html "$DIST_DIR"/en/posts/*/index.html; do
    [ -f "$html_file" ] || continue
    
    CHECKED_COUNT=$((CHECKED_COUNT + 1))
    
    # Count h2 headings in post-content
    HEADING_COUNT=$(awk '
        /class="post-content"/ { inside=1 }
        inside && /<h2/ { count++ }
        /<\/article>/ { inside=0 }
        END { print count+0 }
    ' "$html_file")
    
    # Count TOC links (build-time generated)
    # Use grep -o | wc -l because HTML is minified (all on one line)
    TOC_LINK_COUNT=$(grep -o 'class="toc-link' "$html_file" | wc -l || echo "0")
    # Divide by 2 because mobile + desktop each have the same links
    TOC_LINK_COUNT=$((TOC_LINK_COUNT / 2))
    
    # Get relative path for display
    REL_PATH="${html_file#$DIST_DIR/}"
    
    if [ "$HEADING_COUNT" -ge 2 ]; then
        # Should have TOC
        if [ "$TOC_LINK_COUNT" -eq 0 ]; then
            echo "  ❌ $REL_PATH (h2: $HEADING_COUNT, TOC links: 0) - BROKEN!"
            BROKEN_COUNT=$((BROKEN_COUNT + 1))
        elif [ "$TOC_LINK_COUNT" -lt "$((HEADING_COUNT - 2))" ]; then
            # Allow up to 2 difference (TOC title, Toggle headings, etc.)
            echo "  ⚠ $REL_PATH (h2: $HEADING_COUNT, TOC links: $TOC_LINK_COUNT) - SIGNIFICANT MISMATCH"
        fi
    else
        # Should NOT have TOC (or TOC should be hidden)
        if [ "$TOC_LINK_COUNT" -gt 0 ]; then
            echo "  ⚠ $REL_PATH (h2: $HEADING_COUNT, TOC links: $TOC_LINK_COUNT) - TOC shown but few headings"
        fi
    fi
done

echo ""
echo "=========================================="
echo "Checked: $CHECKED_COUNT posts"
echo "Broken TOC: $BROKEN_COUNT"

if [ "$BROKEN_COUNT" -gt 0 ]; then
    echo "❌ Found $BROKEN_COUNT posts with broken TOC!"
    exit 1
fi

echo "✓ All TOCs OK!"
exit 0
