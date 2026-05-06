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
# Expects tribunal vibe scorer schema: { dimensions: { persona, clawdNote, vibe, clarity, narrative }, ... }
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

  local model_str="GPT-5.5"

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
  harness: \"Codex CLI\"
  pipeline:
    - role: \"Scored\"
      model: \"${model_str}\"
      harness: \"Codex CLI (vibe scorer)\"
    - role: \"Rewritten\"
      model: \"${model_str}\"
      harness: \"Codex CLI\"
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

# Set up an isolated tmp work-dir for spawning LLM subprocesses. Keep this
# outside the repo so Codex does not inherit unrelated repo-local instructions
# and scratch runs avoid trusted-directory checks.
tribunal_llm_work_dir() {
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local d
  d="$(mktemp -d -t tribunal-llm-XXXXXX)"
  ln -s "$REPO_ROOT/.claude" "$d/.claude"
  echo "$d"
}

# Backward-compatible alias for older scripts still calling the old helper.
tribunal_claude_work_dir() {
  tribunal_llm_work_dir
}

tribunal_codex_cmd() {
  if command -v codex >/dev/null 2>&1 && codex exec --help >/dev/null 2>&1; then
    printf '%s\n' codex
    return 0
  fi
  local bundled="/usr/lib/node_modules/@openai/codex/bin/codex.js"
  if command -v node >/dev/null 2>&1 && [ -r "$bundled" ]; then
    printf '%s\n' "node $bundled"
    return 0
  fi
  return 1
}

# Run a repo-local agent spec through Codex. Codex custom agents live in
# `.codex/agents/*.toml`, but `codex exec` has no stable `--agent` flag for this
# non-interactive tribunal path, so we inline the project-scoped Codex agent
# config. The legacy `.claude/agents/*.md` files remain Claude Code setup files;
# when present, we include them only as detailed rubric text and instruct Codex
# to ignore their YAML frontmatter runtime fields.
tribunal_codex_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local codex_agent_file="$REPO_ROOT/.codex/agents/$agent_name.toml"
  local legacy_agent_file="$REPO_ROOT/.claude/agents/$agent_name.md"
  local codex_agent_spec=""
  local legacy_agent_spec=""
  if [ -f "$codex_agent_file" ]; then
    codex_agent_spec="$(cat "$codex_agent_file")"
  fi
  if [ -f "$legacy_agent_file" ]; then
    legacy_agent_spec="$(cat "$legacy_agent_file")"
  fi
  local prompt
  prompt="$(cat <<PROMPT
You are running inside the gu-log tribunal automation.

## Codex agent config: $agent_name
$codex_agent_spec

## Legacy Claude Code rubric: $agent_name
The following file is included only as detailed rubric text. Ignore YAML
frontmatter runtime fields such as model and tools; those are for Claude Code,
not this Codex tribunal run.

$legacy_agent_spec

## Repo root
$REPO_ROOT

## User task
$user_prompt
PROMPT
)"
  local reasoning_effort="${TRIBUNAL_CODEX_REASONING:-medium}"
  local timeout_sec="${TRIBUNAL_CODEX_TIMEOUT_SEC:-3600}"
  local codex_cmd
  codex_cmd="$(tribunal_codex_cmd)" || return 127
  ( cd "$work_dir" && timeout "$timeout_sec" $codex_cmd exec --model gpt-5.5 -c "model_reasoning_effort=\"$reasoning_effort\"" --sandbox danger-full-access --skip-git-repo-check -- "$prompt" )
}

# Run Codex with both a wall-clock timeout and an idle watchdog. The wall-clock
# timeout can be large for GPT-5.5 judge runs, but a process that produces no
# output and no score-file progress for a while is treated as stalled.
#
# Args: work_dir agent_name prompt output_file progress_file
# Returns: child exit code, or 124 when killed by the idle watchdog/timeout.
tribunal_codex_exec_watchdog() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  local output_file="$4"
  local progress_file="${5:-}"
  local idle_timeout="${TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC:-900}"
  local poll_interval="${TRIBUNAL_CODEX_IDLE_POLL_SEC:-30}"
  local pid rc now last_change latest_mtime out_mtime progress_mtime

  : > "$output_file"
  tribunal_codex_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
  pid=$!
  last_change="$(date +%s)"

  while kill -0 "$pid" 2>/dev/null; do
    sleep "$poll_interval"
    now="$(date +%s)"
    latest_mtime=0
    if [ -e "$output_file" ]; then
      out_mtime="$(stat -c %Y "$output_file" 2>/dev/null || stat -f %m "$output_file" 2>/dev/null || echo 0)"
      [ "$out_mtime" -gt "$latest_mtime" ] && latest_mtime="$out_mtime"
    fi
    if [ -n "$progress_file" ] && [ -e "$progress_file" ]; then
      progress_mtime="$(stat -c %Y "$progress_file" 2>/dev/null || stat -f %m "$progress_file" 2>/dev/null || echo 0)"
      [ "$progress_mtime" -gt "$latest_mtime" ] && latest_mtime="$progress_mtime"
    fi
    if [ "$latest_mtime" -gt "$last_change" ]; then
      last_change="$latest_mtime"
    fi
    if [ $((now - last_change)) -ge "$idle_timeout" ]; then
      printf '[tribunal-watchdog] idle for %ss with no output/score-file progress; killing Codex pid %s\n' "$idle_timeout" "$pid" >> "$output_file"
      kill -TERM "$pid" 2>/dev/null || true
      sleep 5
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
  done

  rc=0
  wait "$pid" || rc=$?
  return "$rc"
}
