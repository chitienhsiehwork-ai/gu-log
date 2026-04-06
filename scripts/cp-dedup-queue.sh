#!/usr/bin/env bash
set -euo pipefail

# CP Queue Dedup — removes candidates that already have published articles.
# Compares queue URLs against sourceUrl in all published posts.
#
# Usage:
#   bash scripts/cp-dedup-queue.sh [--dry-run]
#
# --dry-run: show what would be removed without modifying the queue file.

GU_LOG_DIR="${GU_LOG_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
QUEUE_FILE="$GU_LOG_DIR/scripts/cp-candidates-queue.yaml"
POSTS_DIR="$GU_LOG_DIR/src/content/posts"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [ ! -f "$QUEUE_FILE" ]; then
  echo "ERROR: Queue file not found: $QUEUE_FILE" >&2
  exit 1
fi

# Step 1: Extract all sourceUrls from published posts into a set
# Normalize: strip quotes, trailing slashes, lowercase
PUBLISHED_URLS=$(mktemp)
grep -rh '^sourceUrl:' "$POSTS_DIR"/*.mdx 2>/dev/null \
  | sed 's/^sourceUrl:[[:space:]]*//; s/^"//; s/"$//' \
  | sed 's:/$::' \
  | tr '[:upper:]' '[:lower:]' \
  | sort -u > "$PUBLISHED_URLS"

PUBLISHED_COUNT=$(wc -l < "$PUBLISHED_URLS")

# Also check briefing-history.md for URLs mentioned there
HISTORY_FILE="$GU_LOG_DIR/../memory/briefing-history.md"
HISTORY_URLS=$(mktemp)
if [ -f "$HISTORY_FILE" ]; then
  grep -oE 'https?://[^ )>]+' "$HISTORY_FILE" 2>/dev/null \
    | sed 's:/$::' \
    | tr '[:upper:]' '[:lower:]' \
    | sort -u > "$HISTORY_URLS"
fi

# Step 2: Extract candidate URLs from queue
# Parse YAML: find lines matching "- url:" pattern
CANDIDATE_URLS=$(mktemp)
grep -E '^\s*-?\s*url:' "$QUEUE_FILE" \
  | sed 's/.*url:[[:space:]]*//; s/^"//; s/"$//' \
  | sed "s/^'//; s/'$//" \
  | sed 's:/$::' > "$CANDIDATE_URLS"

TOTAL_CANDIDATES=$(wc -l < "$CANDIDATE_URLS")

# Step 3: Find duplicates
DUPES=$(mktemp)
while IFS= read -r url; do
  url_lower=$(echo "$url" | tr '[:upper:]' '[:lower:]')
  if grep -qF "$url_lower" "$PUBLISHED_URLS" 2>/dev/null || \
     grep -qF "$url_lower" "$HISTORY_URLS" 2>/dev/null; then
    echo "$url" >> "$DUPES"
  fi
done < "$CANDIDATE_URLS"

DUPE_COUNT=$(wc -l < "$DUPES")

if [ "$DUPE_COUNT" -eq 0 ]; then
  echo "✓ No duplicates found ($TOTAL_CANDIDATES candidates, $PUBLISHED_COUNT published posts)"
  rm -f "$PUBLISHED_URLS" "$HISTORY_URLS" "$CANDIDATE_URLS" "$DUPES"
  exit 0
fi

echo "Found $DUPE_COUNT duplicate(s) out of $TOTAL_CANDIDATES candidates:"
cat "$DUPES" | while read -r url; do
  echo "  - $url"
done

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "(dry-run: no changes made)"
else
  # Step 4: Remove duplicate entries from queue
  # Each candidate is a YAML block starting with "- url:" 
  # We remove the entire block (from "- url:" to next "- url:" or end)
  TEMP_QUEUE=$(mktemp)
  cp "$QUEUE_FILE" "$TEMP_QUEUE"
  
  while IFS= read -r dupe_url; do
    # Escape special chars for sed
    escaped_url=$(printf '%s\n' "$dupe_url" | sed 's/[&/\]/\\&/g; s/\./\\./g')
    
    # Use Python for reliable YAML block removal
    python3 -c "
import sys, re

with open('$TEMP_QUEUE', 'r') as f:
    content = f.read()

# Find and remove the candidate block containing this URL
# Pattern: from '- url: <this_url>' to next '- url:' or end of candidates
url = '''$dupe_url'''
lines = content.split('\n')
new_lines = []
skip = False
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('- url:') or stripped.startswith('url:'):
        # Check if this line contains our dupe URL
        line_url = stripped.split('url:', 1)[1].strip().strip('\"').strip(\"'\")
        if line_url == url:
            skip = True
            continue
        else:
            skip = False
    elif skip and (stripped.startswith('- url:') or stripped.startswith('- ') and not stripped.startswith('  ')):
        skip = False
    
    if skip and (stripped == '' or stripped.startswith(' ') or stripped.startswith('  ')):
        continue
    elif skip:
        skip = False
    
    new_lines.append(line)

with open('$TEMP_QUEUE', 'w') as f:
    f.write('\n'.join(new_lines))
" 2>/dev/null || echo "  WARN: failed to remove $dupe_url" >&2
  done < "$DUPES"
  
  cp "$TEMP_QUEUE" "$QUEUE_FILE"
  rm -f "$TEMP_QUEUE"
  
  REMAINING=$(grep -cE '^\s*-\s*url:' "$QUEUE_FILE" || echo 0)
  echo ""
  echo "✓ Removed $DUPE_COUNT duplicate(s). Queue: $REMAINING candidates remaining."
fi

rm -f "$PUBLISHED_URLS" "$HISTORY_URLS" "$CANDIDATE_URLS" "$DUPES"
