#!/usr/bin/env bash
# Tribunal — Shared helper functions
# Source this file: source scripts/tribunal-helpers.sh

# Extract ticketId from a post file (handles both single and double quotes)
# Usage: ticket_id=$(get_ticket_id "src/content/posts/file.mdx")
get_ticket_id() {
  local file="$1"
  # Match ticketId: "XX-N" or ticketId: 'XX-N' or ticketId: XX-N
  grep -m1 'ticketId' "$file" 2>/dev/null \
    | sed -E "s/.*ticketId:[[:space:]]*[\"']?([^\"']+)[\"']?.*/\1/" \
    | tr -d '[:space:]'
}

# Validate vibe scorer JSON output — returns 0 if valid, 1 if not
# Expects tribunal vibe-opus-scorer schema: { dimensions: { persona, clawdNote, vibe, clarity, narrative }, ... }
# Usage: validate_score_json "/tmp/vibe-score-SP-110.json" "sp-110-file.mdx"
validate_score_json() {
  local json_file="$1"
  local expected_file="$2"

  # File exists?
  [ -f "$json_file" ] || return 1

  # Strip markdown code fences anywhere (LLM may add preamble before fences)
  sed -i '/^```/d' "$json_file"

  # Valid JSON?
  jq empty "$json_file" 2>/dev/null || return 1

  # Required keys exist and scores are integers 0-10?
  local p c v
  p=$(jq -r '.dimensions.persona // empty' "$json_file" 2>/dev/null)
  c=$(jq -r '.dimensions.clawdNote // empty' "$json_file" 2>/dev/null)
  v=$(jq -r '.dimensions.vibe // empty' "$json_file" 2>/dev/null)

  # All three must be non-empty integers
  [[ "$p" =~ ^[0-9]+$ ]] || return 1
  [[ "$c" =~ ^[0-9]+$ ]] || return 1
  [[ "$v" =~ ^[0-9]+$ ]] || return 1

  # Range check 0-10
  [ "$p" -ge 0 ] && [ "$p" -le 10 ] || return 1
  [ "$c" -ge 0 ] && [ "$c" -le 10 ] || return 1
  [ "$v" -ge 0 ] && [ "$v" -le 10 ] || return 1

  return 0
}

# Read scores from validated JSON (tribunal vibe schema)
# Usage: read_scores "/tmp/vibe-score-SP-110.json"
# Sets: SCORE_P, SCORE_C, SCORE_V
read_scores() {
  local json_file="$1"
  SCORE_P=$(jq -r '.dimensions.persona' "$json_file")
  SCORE_C=$(jq -r '.dimensions.clawdNote' "$json_file")
  SCORE_V=$(jq -r '.dimensions.vibe' "$json_file")
}

# Stamp translatedBy with tribunal pipeline info
# Usage: stamp_ralph_signature "src/content/posts/file.mdx"
stamp_ralph_signature() {
  local file="$1"
  [ -f "$file" ] || return 0

  # Detect model string
  local model_str="Opus 4.6"
  if command -v node &>/dev/null && [ -f "scripts/detect-model.mjs" ]; then
    model_str=$(node scripts/detect-model.mjs claude-opus-4-6 2>/dev/null || echo "Opus 4.6")
  fi

  # Replace the translatedBy block using node for reliable YAML manipulation
  # Fallback: use sed to replace model and harness lines, remove pipeline block
  node -e "
    const fs = require('fs');
    const f = process.argv[1];
    let content = fs.readFileSync(f, 'utf8');

    // Find the frontmatter boundaries
    const parts = content.split('---');
    if (parts.length < 3) process.exit(0);

    let fm = parts[1];

    // Replace translatedBy block
    const tbRegex = /translatedBy:[\s\S]*?(?=\n[a-zA-Z]|\n---)/;
    const newTB = \`translatedBy:
  model: \"${model_str}\"
  harness: \"Claude Code\"
  pipeline:
    - role: \"Scored\"
      model: \"${model_str}\"
      harness: \"Claude Code (vibe-opus-scorer)\"
    - role: \"Rewritten\"
      model: \"${model_str}\"
      harness: \"Claude Code\"
    - role: \"Orchestrated\"
      model: \"${model_str}\"
      harness: \"Tribunal Batch Runner\"
  pipelineUrl: \"https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/tribunal-batch-runner.sh\"\`;

    if (tbRegex.test(fm)) {
      fm = fm.replace(tbRegex, newTB);
    }

    parts[1] = fm;
    fs.writeFileSync(f, parts.join('---'));
  " "$file" 2>/dev/null || true
}

# Recompute stats from posts (idempotent)
# Usage: recompute_stats "$PROGRESS"
recompute_stats() {
  local progress="$1"
  jq '
    .stats = {
      total: (.stats.total // 323),
      processed: ([.posts | to_entries[] | select(.value.status != null)] | length),
      passed: ([.posts | to_entries[] | select(.value.status == "PASS")] | length),
      rewritten: ([.posts | to_entries[] | select(.value.attempts > 1 and .value.status == "PASS")] | length),
      failed: ([.posts | to_entries[] | select(.value.status | test("TRIED|ERROR|SCORER_ERROR|WRITER_ERROR|BUILD_ERROR"))] | length),
      skipped: ([.posts | to_entries[] | select(.value.status == "SKIPPED")] | length)
    }
  ' "$progress" > "${progress}.tmp" && mv "${progress}.tmp" "$progress"
}

# Set up an isolated tmp work-dir for spawning `claude -p` from. Sidesteps
# the CCC sandbox bug where claude auto-discovers the parent CLAUDE.md and
# follows its instructions ("first run detect-env.sh", etc) instead of the
# tribunal prompt — derails on long inputs and silently exits 1 with empty
# stderr (see PR #177 SP-pipeline work-dir fix for the same root cause).
#
# The returned dir contains a `.claude/` symlink so `--agent <name>` still
# resolves to the repo's agent definitions. Caller should pass
# `--add-dir "$REPO"` to the claude invocation to grant tool access to
# repo files referenced in the prompt.
#
# Usage:
#   work_dir="$(tribunal_claude_work_dir)"
#   trap 'rm -rf "$work_dir"' EXIT
#   ( cd "$work_dir" && claude -p --agent ... --add-dir "$REPO_ROOT" ... )
#
# REPO_ROOT defaults to the repo root inferred from the script's location;
# callers can override via the global REPO_ROOT variable before sourcing.
tribunal_claude_work_dir() {
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local d
  d="$(mktemp -d -t tribunal-claude-XXXXXX)"
  ln -s "$REPO_ROOT/.claude" "$d/.claude"
  echo "$d"
}
