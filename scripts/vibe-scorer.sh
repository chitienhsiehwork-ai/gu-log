#!/usr/bin/env bash
# Vibe Scorer — Independent review via Claude Code subagent (vibe-opus-scorer)
# Usage: ./vibe-scorer.sh <post-filename> [output-path]
#   ./vibe-scorer.sh "sp-110-xxx.mdx"
#   ./vibe-scorer.sh "sp-110-xxx.mdx" "/tmp/vibe/run-1/score.json"
# Exit: 0 = success (valid JSON written), 1 = error

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/tribunal-helpers.sh

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

# Extract ticketId using shared helper
TICKET_ID=$(get_ticket_id "$POST_PATH")
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"

# Output path: explicit arg or default
OUT_FILE="${2:-/tmp/vibe-score-${TICKET_ID}.json}"

# Ensure output dir exists
mkdir -p "$(dirname "$OUT_FILE")"

# Clean previous score file
rm -f "$OUT_FILE"

# Run independent Claude Code instance with the vibe-opus-scorer subagent.
# Timeout: 10 minutes per score. Opus 4.6 (pinned) on decorative-trap posts
# can need 10+ turns to do strip test + read standard + write JSON.
# Max-turns 30 gives scorer enough space; real cost is still bounded by timeout.
#
# Spawned from a tmp work-dir (NOT the repo) so claude's CLAUDE.md
# auto-discovery walk-up terminates at /tmp without picking up the gu-log
# CLAUDE.md. Inside the repo, the auto-discovered CLAUDE.md tells claude to
# "first run detect-env.sh", etc — the agent then follows those orders
# instead of the scoring prompt and either returns text analysis without
# JSON, or silently exits 1 on long inputs (see PR #177).
#
# The work-dir has a `.claude/` symlink so --agent vibe-opus-scorer still
# resolves; --add-dir grants the agent read access to the repo so it can
# load the post + scoring standard + glossary.
#
# Permission mode: refuses bypassPermissions under root (CCC), so use
# acceptEdits there. Non-root keeps bypassPermissions for full freedom.
WORK_DIR="$(tribunal_claude_work_dir)"
trap 'rm -rf "$WORK_DIR"' EXIT
REPO_ABS="$(pwd)"

scorer_cmd=(timeout 600 claude -p --agent vibe-opus-scorer --max-turns 30 --add-dir "$REPO_ABS")
if [ "$(id -u)" = "0" ]; then
  scorer_cmd+=(--permission-mode acceptEdits)
else
  scorer_cmd+=(--permission-mode bypassPermissions)
fi

# Score JSON path must be inside WORK_DIR for acceptEdits to auto-approve
# the agent's Write tool call. We then move it to the caller-requested
# OUT_FILE after the agent finishes.
WORK_SCORE="$WORK_DIR/score.json"
( cd "$WORK_DIR" && "${scorer_cmd[@]}" \
  "Score this post: $REPO_ABS/src/content/posts/$POST_FILE
Write your JSON output to exactly this path: $WORK_SCORE" || true )

if [ -f "$WORK_SCORE" ]; then
  mkdir -p "$(dirname "$OUT_FILE")"
  mv "$WORK_SCORE" "$OUT_FILE"
fi

# Validate output
if validate_score_json "$OUT_FILE" "$POST_FILE"; then
  cat "$OUT_FILE"
  exit 0
else
  echo "ERROR: Scorer output missing or invalid at $OUT_FILE" >&2
  [ -f "$OUT_FILE" ] && echo "Content: $(cat "$OUT_FILE")" >&2
  exit 1
fi
