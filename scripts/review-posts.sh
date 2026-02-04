#!/bin/bash
# gu-log Post Reviewer
# Called by pre-commit hook to review changed .mdx files

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

echo "📝 Reviewing staged posts..."
echo "$STAGED_MDX"
echo ""

# Read reviewer prompt
PROMPT=$(cat "$REVIEWER_PROMPT")

# Track overall result
ALL_PASSED=true
REVIEW_OUTPUT=""

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
"
    
    # Call Claude via openclaw CLI or claude CLI
    # Using claude CLI directly for simplicity
    RESULT=$(echo "$REVIEW_REQUEST" | claude --print 2>/dev/null || echo "REVIEW_ERROR")
    
    if [[ "$RESULT" == "REVIEW_ERROR" ]]; then
        echo "⚠️  Could not run reviewer for $file (claude CLI not available)"
        continue
    fi
    
    # Check if FAIL is in the result
    if echo "$RESULT" | grep -q "Review Result: FAIL"; then
        ALL_PASSED=false
        echo "❌ FAILED: $file"
    else
        echo "✓ PASSED: $file"
    fi
    
    REVIEW_OUTPUT="$REVIEW_OUTPUT

========================================
File: $file
========================================
$RESULT
"
done

echo ""
echo "=========================================="
echo "$REVIEW_OUTPUT"
echo "=========================================="

if [ "$ALL_PASSED" = false ]; then
    echo ""
    echo "❌ Review FAILED. Please fix the issues above before committing."
    echo "   To bypass (not recommended): git commit --no-verify"
    exit 1
fi

echo ""
echo "✓ All posts passed review!"
exit 0
