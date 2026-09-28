#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$BIN_DIR/claude" <<'SCRIPT'
#!/usr/bin/env bash
printf 'Claude CLI must not run while resolving judges: %s\n' "$*" >&2
exit 72
SCRIPT
chmod +x "$BIN_DIR/codex" "$BIN_DIR/claude"

export PATH="$BIN_DIR:$PATH"
export REPO_ROOT="$ROOT_DIR"
export TRIBUNAL_RUNTIME_PROFILE=vm-codex
export TRIBUNAL_STRICT_ROLE_PROVIDERS=1

# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

TRIBUNAL_REVIEWER_REMAINING_PCT=50
export TRIBUNAL_REVIEWER_REMAINING_PCT
[ "$(tribunal_judge_provider fact-checker)" = codex ]
[ "$(tribunal_llm_model_id fact-checker)" = gpt-5.6-sol ]
[ "$(tribunal_runner_label fact-checker)" = codex-gpt-5.6-sol-xhigh ]

TRIBUNAL_REVIEWER_REMAINING_PCT=19
export TRIBUNAL_REVIEWER_REMAINING_PCT
[ "$(tribunal_llm_model_id fact-checker)" = gpt-5.6-luna ]
[ "$(tribunal_runner_label fact-checker)" = codex-gpt-5.6-luna-max ]

expected_vibe_model="$(jq -r '.profiles["vm-codex"].vibeScorer.model' "$ROOT_DIR/config/llm-pipeline.json")"
expected_vibe_effort="$(jq -r '.profiles["vm-codex"].vibeScorer.reasoningEffort' "$ROOT_DIR/config/llm-pipeline.json")"
[ "$(tribunal_judge_provider vibe-opus-scorer)" = codex ]
[ "$(tribunal_llm_model_id vibe-opus-scorer)" = "$expected_vibe_model" ]
[ "$(tribunal_runner_label vibe-opus-scorer)" = \
  "codex-$expected_vibe_model-$expected_vibe_effort" ]

writer_pin="$(tribunal_claude_agent_model tribunal-writer)"
tribunal_writer_provenance_complete claude "$writer_pin" "$writer_pin"
if tribunal_writer_provenance_complete codex gpt-5.6-sol codex-gpt-5.6-sol-xhigh ||
   tribunal_writer_provenance_complete claude '' "$writer_pin"; then
  printf 'writer provenance guard accepted a non-Claude or incomplete writer\n' >&2
  exit 1
fi

# The source-distance aligner keeps its own pin; it never equals the writer pin
# and resolving judges never reads it.
aligner_pin="$(tribunal_claude_frontmatter_model "$ROOT_DIR/.claude/agents/source-aligner.md")"
[ -n "$aligner_pin" ] && [ "${aligner_pin%\[1m\]}" != "${writer_pin%\[1m\]}" ] || {
  printf 'source aligner pin %s must exist and differ from the writer pin %s\n' \
    "$aligner_pin" "$writer_pin" >&2
  exit 1
}

printf 'ok VM routing: Codex judges, Claude-only writer provenance, separate aligner pin\n'
