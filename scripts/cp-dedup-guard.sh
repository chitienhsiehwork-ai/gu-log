#!/bin/bash
# ============================================================================
# CP Dedup Guard — Three-layer duplicate detection for CP candidate queue
# ============================================================================
#
# Layer 1: URL Normalization + Exact Match
# Layer 2: Keyword Jaccard Similarity (title + summary vs published articles)
# Layer 3: Published entry auto-remove (called after successful publish)
#
# Usage:
#   cp-dedup-guard.sh check <url> <title> [summary]   → check single candidate
#   cp-dedup-guard.sh scan                             → scan entire queue
#   cp-dedup-guard.sh clean                            → remove dupes from queue
#   cp-dedup-guard.sh rebuild-cache                    → rebuild published articles cache
#
# Exit codes:
#   0 = pass (no duplicate found)
#   1 = duplicate detected (auto-reject)
#   2 = potential overlap (flag for review)
#   3 = error
#
# Environment:
#   DEDUP_THRESHOLD_REJECT=0.30   (keyword similarity >= this → reject)
#   DEDUP_THRESHOLD_FLAG=0.18     (keyword similarity >= this → flag)
#   GEMINI_API_KEY_FILE=~/.secrets/gemini-api-key (future: vector embeddings)
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POSTS_DIR="$PROJECT_DIR/src/content/posts"
QUEUE_FILE="$PROJECT_DIR/scripts/cp-candidates-queue.yaml"
CACHE_FILE="$PROJECT_DIR/scripts/.dedup-cache.json"

# Thresholds
REJECT_THRESHOLD="${DEDUP_THRESHOLD_REJECT:-0.30}"
FLAG_THRESHOLD="${DEDUP_THRESHOLD_FLAG:-0.18}"

# ============================================================================
# Layer 1: URL Normalization
# ============================================================================

normalize_url() {
    python3 -c "
import sys, re
from urllib.parse import urlparse, urlunparse

url = sys.argv[1].strip().strip('\"').strip(\"'\")

# Parse
p = urlparse(url)

# Strip www.
host = p.netloc.lower()
if host.startswith('www.'):
    host = host[4:]

# Strip trailing slash from path
path = p.path.rstrip('/')

# Strip common tracking params
# Keep query for now but strip utm_* and ref params
query = '&'.join(
    part for part in p.query.split('&')
    if part and not part.startswith(('utm_', 'ref=', 'source='))
)

# Known domain aliases (same content, different URL)
ALIASES = {
    ('claude.com', '/blog/auto-mode'): ('anthropic.com', '/engineering/claude-code-auto-mode'),
    ('anthropic.com', '/news/'): None,  # anthropic.com/news/* may alias /research/*
}

# Apply alias normalization
for (alias_host, alias_path), target in [(k,v) for k,v in ALIASES.items() if v]:
    if host == alias_host and path.startswith(alias_path):
        host, path = target
        break

# Rebuild
normalized = urlunparse(('https', host, path, '', query, ''))
print(normalized)
" "$1"
}

# ============================================================================
# Layer 2: Keyword Jaccard Similarity (pure Python, zero dependencies)
# ============================================================================

check_similarity() {
    local candidate_title="$1"
    local candidate_summary="${2:-}"
    
    python3 "$SCRIPT_DIR/cp-dedup-similarity.py" \
        --cache "$CACHE_FILE" \
        --posts-dir "$POSTS_DIR" \
        --reject-threshold "$REJECT_THRESHOLD" \
        --flag-threshold "$FLAG_THRESHOLD" \
        --title "$candidate_title" \
        --summary "$candidate_summary"
}

# ============================================================================
# Build / Rebuild published articles cache
# ============================================================================

rebuild_cache() {
    python3 "$SCRIPT_DIR/cp-dedup-similarity.py" \
        --cache "$CACHE_FILE" \
        --posts-dir "$POSTS_DIR" \
        --rebuild-cache
}

# ============================================================================
# Commands
# ============================================================================

cmd_check() {
    local url="${1:-}"
    local title="${2:-}"
    local summary="${3:-}"
    
    if [ -z "$url" ] || [ -z "$title" ]; then
        echo "Usage: cp-dedup-guard.sh check <url> <title> [summary]" >&2
        exit 3
    fi
    
    # Ensure cache exists
    if [ ! -f "$CACHE_FILE" ]; then
        echo "Building dedup cache..." >&2
        rebuild_cache
    fi
    
    # Layer 1: URL match
    local normalized
    normalized=$(normalize_url "$url")
    
    # Check against published sourceUrls
    local url_match
    url_match=$(python3 -c "
import json, sys
with open('$CACHE_FILE') as f:
    cache = json.load(f)
normalized = sys.argv[1]
for article in cache.get('articles', []):
    if article.get('normalized_url', '') == normalized:
        print(f\"URL_MATCH|{article['file']}|{article['title']}\")
        sys.exit(0)
print('NO_MATCH')
" "$normalized")
    
    if [[ "$url_match" == URL_MATCH* ]]; then
        local match_file match_title
        match_file=$(echo "$url_match" | cut -d'|' -f2)
        match_title=$(echo "$url_match" | cut -d'|' -f3-)
        echo "🔴 REJECT (Layer 1: URL match)"
        echo "  Candidate: $title"
        echo "  Matches:   $match_title"
        echo "  File:      $match_file"
        return 1
    fi
    
    # Layer 2: Keyword similarity
    local sim_result
    sim_result=$(check_similarity "$title" "$summary")
    local sim_exit=$?
    
    echo "$sim_result"
    return $sim_exit
}

cmd_scan() {
    # Ensure cache exists
    if [ ! -f "$CACHE_FILE" ]; then
        echo "Building dedup cache..." >&2
        rebuild_cache
    fi
    
    python3 "$SCRIPT_DIR/cp-dedup-similarity.py" \
        --cache "$CACHE_FILE" \
        --posts-dir "$POSTS_DIR" \
        --reject-threshold "$REJECT_THRESHOLD" \
        --flag-threshold "$FLAG_THRESHOLD" \
        --scan-queue "$QUEUE_FILE"
}

cmd_clean() {
    # Scan and auto-remove rejects
    echo "Scanning queue for duplicates..."
    
    python3 "$SCRIPT_DIR/cp-dedup-similarity.py" \
        --cache "$CACHE_FILE" \
        --posts-dir "$POSTS_DIR" \
        --reject-threshold "$REJECT_THRESHOLD" \
        --flag-threshold "$FLAG_THRESHOLD" \
        --clean-queue "$QUEUE_FILE"
}

cmd_rebuild() {
    echo "Rebuilding dedup cache from published articles..."
    rebuild_cache
    echo "✅ Cache rebuilt: $CACHE_FILE"
}

# ============================================================================
# Main
# ============================================================================

case "${1:-}" in
    check)
        shift
        cmd_check "$@"
        ;;
    scan)
        cmd_scan
        ;;
    clean)
        cmd_clean
        ;;
    rebuild-cache)
        cmd_rebuild
        ;;
    *)
        echo "Usage: cp-dedup-guard.sh {check|scan|clean|rebuild-cache}" >&2
        echo ""
        echo "  check <url> <title> [summary]  — check single candidate"
        echo "  scan                            — scan entire queue"
        echo "  clean                           — remove dupes from queue"
        echo "  rebuild-cache                   — rebuild published articles cache"
        exit 3
        ;;
esac
