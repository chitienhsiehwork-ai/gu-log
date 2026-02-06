#!/bin/bash
# gu-log Post Reviewer
# Called by pre-commit hook to review changed .mdx files
# Uses OpenClaw agent to run the review

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REVIEWER_PROMPT="$SCRIPT_DIR/reviewer-prompt.md"

# Get list of staged .mdx files
STAGED_MDX=$(git diff --cached --name-only --diff-filter=ACM | grep '\.mdx$' || true)

if [ -z "$STAGED_MDX" ]; then
    echo "✓ No .mdx files to review"
    exit 0
fi

echo "📝 Reviewing staged posts via OpenClaw..."
echo "$STAGED_MDX"
echo ""

# Read reviewer prompt
PROMPT=$(cat "$REVIEWER_PROMPT")

# Track overall result
ALL_PASSED=true

for file in $STAGED_MDX; do
    echo "🔍 Reviewing: $file"
    
    # Get file content
    CONTENT=$(cat "$PROJECT_DIR/$file")
    
    # Build the review request
    REVIEW_REQUEST="$PROMPT

---

## 請審查以下文章：

檔案：$file

\`\`\`mdx
$CONTENT
\`\`\`

請用指定的格式輸出審查結果。"
    
    # Call OpenClaw agent
    # Using --local to run embedded (faster, uses local API key)
    # Using dedicated session for reviews
    RESULT=$(openclaw agent --local --session-id "gu-log-reviewer" --message "$REVIEW_REQUEST" --timeout 120 2>&1) || {
        echo "⚠️  OpenClaw agent failed for $file"
        echo "$RESULT"
        continue
    }
    
    echo ""
    echo "--- Review Result ---"
    echo "$RESULT"
    echo "--- End Review ---"
    echo ""
    
    # Check if FAIL or WARNING is in the result
    # Both CRITICAL and WARNING will block commit
    if echo "$RESULT" | grep -qi "Review Result.*FAIL\|CRITICAL\|WARNING"; then
        ALL_PASSED=false
        echo "❌ FAILED: $file"
    else
        echo "✓ PASSED: $file"
    fi
    
    echo ""
done

if [ "$ALL_PASSED" = false ]; then
    echo ""
    echo "❌ Review FAILED. Please fix the issues above before committing."
    exit 1
fi

echo ""
echo "✓ All posts passed review!"
exit 0
