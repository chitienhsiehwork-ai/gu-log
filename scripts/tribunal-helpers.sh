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
# Expects tribunal vibe scorer schema. Note: clarity ownership is version-aware
# (move-clarity-vibe-to-fresheyes) — for tribunalVersion <= 8 the vibe schema is
# { persona, moguNote, vibe, clarity, narrative }; for v9+ vibe drops clarity
# (it moves to Fresh Eyes). This helper only spot-checks persona/moguNote/vibe,
# so it stays compatible with both versions.
# Usage: validate_score_json "/tmp/vibe-score-GP-110.json" "gp-110-file.mdx"
validate_score_json() {
  local json_file="$1"
  local expected_file="$2"
  : "$expected_file"

  # File exists?
  [ -f "$json_file" ] || return 1

  # Strip markdown code fences anywhere (LLM may add preamble before fences)
  sed -i '/^```/d' "$json_file"

  # Valid JSON?
  jq empty "$json_file" 2>/dev/null || return 1

  # Required keys exist and scores are integers 0-10?
  local p c v
  p=$(jq -r '.dimensions.persona // empty' "$json_file" 2>/dev/null)
  c=$(jq -r '.dimensions.moguNote // empty' "$json_file" 2>/dev/null)
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
# Usage: read_scores "/tmp/vibe-score-GP-110.json"
# Sets: SCORE_P, SCORE_C, SCORE_V
read_scores() {
  local json_file="$1"
  # shellcheck disable=SC2034 # Exported-by-convention globals used by callers.
  SCORE_P=$(jq -r '.dimensions.persona' "$json_file")
  # shellcheck disable=SC2034 # Exported-by-convention globals used by callers.
  SCORE_C=$(jq -r '.dimensions.moguNote' "$json_file")
  # shellcheck disable=SC2034 # Exported-by-convention globals used by callers.
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

tribunal_codex_version() {
  local codex_cmd
  codex_cmd="$(tribunal_codex_cmd)" || return 1
  $codex_cmd --version 2>/dev/null | awk '{print $NF; exit}'
}

tribunal_codex_version_at_least() {
  local actual="$1" required="$2"
  python3 - "$actual" "$required" <<'PY'
import re, sys

def parts(v):
    nums = [int(x) for x in re.findall(r'\d+', v)[:3]]
    return tuple((nums + [0, 0, 0])[:3])

sys.exit(0 if parts(sys.argv[1]) >= parts(sys.argv[2]) else 1)
PY
}

tribunal_progress_file_default() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/.score-loop/state/tribunal-progress.json\n' "$root"
}

tribunal_legacy_progress_file() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/scores/tribunal-progress.json\n' "$root"
}

tribunal_progress_migration_dir() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/.score-loop/state/migrations\n' "$root"
}

tribunal_runtime_git_state_file() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/.score-loop/state/runtime-git.json\n' "$root"
}

tribunal_publisher_state_file() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/.score-loop/state/tribunal-publisher.json\n' "$root"
}

tribunal_triage_events_file() {
  local root="${1:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  printf '%s/.score-loop/state/tribunal-triage-events.json\n' "$root"
}

ensure_tribunal_progress_file() {
  local target="$1"
  local root="${2:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  local legacy="${3:-$(tribunal_legacy_progress_file "$root")}"

  mkdir -p "$(dirname "$target")" "$(tribunal_progress_migration_dir "$root")"

  if [ -f "$target" ] && jq empty "$target" >/dev/null 2>&1; then
    return 0
  fi

  if [ "$target" != "$legacy" ] && [ -f "$legacy" ] && jq empty "$legacy" >/dev/null 2>&1; then
    local stamp backup
    stamp="$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
    backup="$(tribunal_progress_migration_dir "$root")/legacy-tribunal-progress-$stamp.json"
    cp "$legacy" "$backup"
    cp "$legacy" "$target"
    return 0
  fi

  printf '{}\n' > "$target"
}

tribunal_fetch_origin_main() {
  local repo_dir="$1"
  local log_file="$2"
  git -C "$repo_dir" fetch --prune origin main >> "$log_file" 2>&1
}

tribunal_write_runtime_git_state() {
  local repo_dir="$1"
  local state_file="${2:-$(tribunal_runtime_git_state_file "$repo_dir")}"
  local ts local_ref remote_ref counts ahead behind state tracked_dirty

  mkdir -p "$(dirname "$state_file")"

  ts="$(TZ=Asia/Taipei date -Iseconds)"
  local_ref="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"
  remote_ref="$(git -C "$repo_dir" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
  counts="$(git -C "$repo_dir" rev-list --left-right --count HEAD...refs/remotes/origin/main 2>/dev/null || printf '0\t0')"
  ahead="$(printf '%s' "$counts" | awk '{print $1}')"
  behind="$(printf '%s' "$counts" | awk '{print $2}')"
  tracked_dirty="$(git -C "$repo_dir" status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')"
  [[ "$ahead" =~ ^[0-9]+$ ]] || ahead=0
  [[ "$behind" =~ ^[0-9]+$ ]] || behind=0
  [[ "$tracked_dirty" =~ ^[0-9]+$ ]] || tracked_dirty=0
  [ -n "$local_ref" ] || local_ref="unknown"
  [ -n "$remote_ref" ] || remote_ref="unknown"

  if [ "$local_ref" = "unknown" ] || [ "$remote_ref" = "unknown" ]; then
    state="unknown"
  elif [ "$ahead" = "0" ] && [ "$behind" = "0" ]; then
    state="in_sync"
  elif [ "$ahead" = "0" ]; then
    state="behind"
  elif [ "$behind" = "0" ]; then
    state="ahead"
  else
    state="diverged"
  fi

  jq -n \
    --arg state "$state" \
    --arg localHead "$local_ref" \
    --arg originMainHead "$remote_ref" \
    --arg updatedAt "$ts" \
    --argjson ahead "${ahead:-0}" \
    --argjson behind "${behind:-0}" \
    --argjson trackedDirty "${tracked_dirty:-0}" \
    '{state: $state, ahead: $ahead, behind: $behind, trackedDirty: $trackedDirty, localHead: $localHead, originMainHead: $originMainHead, updatedAt: $updatedAt}' \
    > "$state_file"
}

tribunal_fetch_and_report_origin_main() {
  local repo_dir="$1"
  local log_file="$2"
  local state_file="${3:-$(tribunal_runtime_git_state_file "$repo_dir")}"
  local fetched="true"

  if ! tribunal_fetch_origin_main "$repo_dir" "$log_file"; then
    fetched="false"
  fi

  tribunal_write_runtime_git_state "$repo_dir" "$state_file"

  local state ahead behind tracked_dirty
  state="$(jq -r '.state // "unknown"' "$state_file" 2>/dev/null || printf 'unknown')"
  ahead="$(jq -r '.ahead // 0' "$state_file" 2>/dev/null || printf '0')"
  behind="$(jq -r '.behind // 0' "$state_file" 2>/dev/null || printf '0')"
  tracked_dirty="$(jq -r '.trackedDirty // 0' "$state_file" 2>/dev/null || printf '0')"
  printf '%s|%s|%s|%s|%s\n' "$fetched" "$state" "$ahead" "$behind" "$tracked_dirty"
}

# Run one external model command in its own POSIX session when the watchdog
# provides a pid-file. Python's setsid() is available on both deployed Linux
# and macOS, and gives the watchdog a stable process-group id even after an
# intermediate shell exits or descendants ignore TERM.
tribunal_session_exec() {
  local pid_file="${TRIBUNAL_PROCESS_GROUP_FILE:-}"
  if [ -z "$pid_file" ]; then
    "$@"
    return
  fi
  python3 -c '
import os
import pathlib
import sys

pid_file = pathlib.Path(sys.argv[1])
command = sys.argv[2:]
os.setsid()
pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")
os.execvp(command[0], command)
' "$pid_file" "$@"
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
  local model=""
  model="$(tribunal_codex_agent_model "$agent_name")" || return 1
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
  (
    cd "$work_dir" || exit
    # Model descendants must never retain the article-level flock if the
    # watchdog has to detach/kill an intermediate shell.
    exec 200>&-
    # Close stdin so non-interactive Codex runs don't inherit the caller's
    # open stdin and hang waiting for extra prompt text.
    exec </dev/null
    # shellcheck disable=SC2086 # codex_cmd may be "node <bundled codex.js>".
    tribunal_session_exec timeout "$timeout_sec" $codex_cmd exec --model "$model" -c "model_reasoning_effort=\"$reasoning_effort\"" --sandbox danger-full-access --skip-git-repo-check -- "$prompt"
  )
}

# ── Claude fallback (CCC sandbox: codex absent, only `claude` on PATH) ─────────
# The tribunal is codex-first everywhere it exists (VPS/mac). In the Claude Code
# on the web sandbox there is no codex, only `claude`, so these helpers let the
# tribunal still score/rewrite via Claude rather than hard-failing exit 70.

tribunal_claude_cmd() {
  if command -v claude >/dev/null 2>&1; then
    printf '%s\n' claude
    return 0
  fi
  return 1
}

# Parse the top-level `model` selector from one Codex agent TOML file. Python's
# stdlib TOML parser keeps comments and multiline developer instructions from
# becoming runtime configuration. The value must be one non-empty selector
# token; malformed TOML, missing model, arrays, and whitespace fail closed.
tribunal_codex_toml_model() {
  local f="$1"
  [ -f "$f" ] || return 1
  python3 - "$f" <<'PY'
import pathlib
import re
import sys
import tomllib

path = pathlib.Path(sys.argv[1])
try:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
except (OSError, UnicodeError, tomllib.TOMLDecodeError):
    raise SystemExit(1)

model = data.get("model")
if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]*", model):
    raise SystemExit(1)
print(model)
PY
}

# Resolve a Codex role selector. GP_CODEX_MODEL is intentionally the only
# run-scoped override; otherwise every role must own a valid TOML model.
tribunal_codex_agent_model() {
  local agent_name="$1"
  local model=""
  if [ -n "${GP_CODEX_MODEL:-}" ]; then
    if ! printf '%s\n' "$GP_CODEX_MODEL" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._:-]*$'; then
      printf 'Invalid GP_CODEX_MODEL override: %s\n' "$GP_CODEX_MODEL" >&2
      return 1
    fi
    printf '%s\n' "$GP_CODEX_MODEL"
    return 0
  fi
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local f="$REPO_ROOT/.codex/agents/$agent_name.toml"
  if ! model="$(tribunal_codex_toml_model "$f")"; then
    printf 'Missing or invalid Codex model in %s\n' "$f" >&2
    return 1
  fi
  printf '%s\n' "$model"
}

tribunal_strict_role_providers_enabled() {
  case "${TRIBUNAL_STRICT_ROLE_PROVIDERS:-}" in
    1) return 0 ;;
    ""|0) return 1 ;;
    *)
      printf 'Invalid TRIBUNAL_STRICT_ROLE_PROVIDERS=%s (expected 1 or unset)\n' \
        "$TRIBUNAL_STRICT_ROLE_PROVIDERS" >&2
      return 2
      ;;
  esac
}

tribunal_strict_provider_for_role() {
  local agent_name="${1:-fact-checker}"
  if [ -n "${TRIBUNAL_FORCE_PROVIDER:-}" ]; then
    printf 'TRIBUNAL_STRICT_ROLE_PROVIDERS=1 conflicts with TRIBUNAL_FORCE_PROVIDER\n' >&2
    return 1
  fi
  case "$agent_name" in
    vibe-opus-scorer)
      tribunal_claude_cmd >/dev/null 2>&1 && printf 'claude\n' && return 0
      printf 'Strict Tribunal routing requires claude for %s\n' "$agent_name" >&2
      ;;
    fact-checker|librarian|fresh-eyes)
      tribunal_codex_cmd >/dev/null 2>&1 && printf 'codex\n' && return 0
      printf 'Strict Tribunal routing requires codex for %s\n' "$agent_name" >&2
      ;;
    *)
      printf 'Strict Tribunal routing does not recognize judge role: %s\n' "$agent_name" >&2
      ;;
  esac
  return 1
}

# Validate the complete deployed provider contract before article dispatch.
tribunal_validate_role_provider_contract() {
  case "${TRIBUNAL_STRICT_ROLE_PROVIDERS:-}" in
    ""|0) return 0 ;;
    1) ;;
    *)
      printf 'Invalid TRIBUNAL_STRICT_ROLE_PROVIDERS=%s (expected 1 or unset)\n' \
        "$TRIBUNAL_STRICT_ROLE_PROVIDERS" >&2
      return 2
      ;;
  esac
  local role
  for role in fact-checker librarian fresh-eyes; do
    tribunal_strict_provider_for_role "$role" >/dev/null || return 1
    tribunal_codex_agent_model "$role" >/dev/null || return 1
  done
  tribunal_strict_provider_for_role vibe-opus-scorer >/dev/null || return 1
  tribunal_claude_agent_model vibe-opus-scorer >/dev/null || return 1
}

# Resolve the active tribunal LLM provider: "codex" when present (the
# maintained judge runtime), else "claude" (CCC fallback). Returns 1 when
# neither binary is on PATH. Codex always wins when both exist; this intentionally
# mirrors the Go pipeline's JudgeChain, not the Opus writer chain.
tribunal_llm_provider() {
  if tribunal_strict_role_providers_enabled; then
    tribunal_strict_provider_for_role fact-checker
    return
  else
    local strict_rc=$?
    [ "$strict_rc" -eq 1 ] || return "$strict_rc"
  fi
  if [ -n "${TRIBUNAL_FORCE_PROVIDER:-}" ]; then
    case "$TRIBUNAL_FORCE_PROVIDER" in
      codex)
        tribunal_codex_cmd >/dev/null 2>&1 && printf 'codex\n' && return 0
        ;;
      claude)
        tribunal_claude_cmd >/dev/null 2>&1 && printf 'claude\n' && return 0
        ;;
    esac
    return 1
  fi
  if tribunal_codex_cmd >/dev/null 2>&1; then
    printf 'codex\n'
    return 0
  fi
  if tribunal_claude_cmd >/dev/null 2>&1; then
    printf 'claude\n'
    return 0
  fi
  return 1
}

# Agent-aware provider preference for a tribunal judge. Defaults to the global
# tribunal_llm_provider for every judge EXCEPT vibe-opus-scorer, which prefers
# Claude so the subjective taste score runs on the owner-pinned build declared
# by `.claude/agents/vibe-opus-scorer.md`. The three
# objective judges (librarian / fact-checker / fresh-eyes) keep the global
# default: Codex on mac/VPS, Claude in the CCC codex-absent fallback.
#
# Precedence: global TRIBUNAL_FORCE_PROVIDER wins for ALL judges (emergency /
# A-B test) because tribunal_llm_provider already honors it, so delegating
# preserves the override. Availability: vibe prefers Claude only when the claude
# binary is on PATH; otherwise it falls through to the global resolver exactly
# like any other judge, so a box without Claude degrades gracefully instead of
# hard-failing (this is by design — vibe=Claude is guaranteed only when both
# codex and claude are present).
#
# Callers without a judge identity (empty agent_name) get the global resolver
# byte-for-byte, so every existing non-judge call path is unchanged.
tribunal_judge_provider() {
  local agent_name="${1:-}"
  if tribunal_strict_role_providers_enabled; then
    tribunal_strict_provider_for_role "$agent_name"
    return
  else
    local strict_rc=$?
    [ "$strict_rc" -eq 1 ] || return "$strict_rc"
  fi
  if [ -n "${TRIBUNAL_FORCE_PROVIDER:-}" ]; then
    tribunal_llm_provider
    return
  fi
  if [ "$agent_name" = "vibe-opus-scorer" ] && tribunal_claude_cmd >/dev/null 2>&1; then
    printf 'claude\n'
    return 0
  fi
  tribunal_llm_provider
}

# Resolve the legacy CLI writer provider. Tribunal-internal prose rewrites must
# never fall back to Codex/GPT; the only CLI writer is explicit opt-in Claude.
tribunal_writer_provider() {
  if tribunal_claude_cmd >/dev/null 2>&1; then
    printf 'claude\n'
    return 0
  fi
  return 1
}

tribunal_writer_mode() {
  if [ -n "${GP_WRITER_MODE:-}" ]; then
    printf '%s\n' "$GP_WRITER_MODE"
  else
    printf 'none\n'
  fi
}

# Probe the deployed CLI writer before any article is claimed. This is
# deliberately tiny, non-interactive, and bounded; it verifies the same role
# model selector and Claude auth path used by real rewrites.
tribunal_writer_preflight() {
  local mode model claude_cmd timeout_sec output rc=0
  mode="$(tribunal_writer_mode)"
  case "$mode" in
    cli) ;;
    none|subagent)
      printf 'Writer preflight failed: deployed runtime requires GP_WRITER_MODE=cli (got %s)\n' "$mode" >&2
      return 1
      ;;
    *)
      printf 'Writer preflight failed: unsupported GP_WRITER_MODE=%s\n' "$mode" >&2
      return 1
      ;;
  esac
  claude_cmd="$(tribunal_claude_cmd)" || {
    printf 'Writer preflight failed: claude CLI is not on PATH\n' >&2
    return 127
  }
  model="$(tribunal_claude_agent_model tribunal-writer)" || {
    printf 'Writer preflight failed: cannot resolve tribunal-writer model\n' >&2
    return 1
  }
  timeout_sec="${TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC:-30}"
  if ! printf '%s\n' "$timeout_sec" | grep -Eq '^[1-9][0-9]*$'; then
    printf 'Writer preflight failed: TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC must be a positive integer\n' >&2
    return 2
  fi
  output="$(
    printf 'Reply OK only.\n' |
      timeout "$timeout_sec" "$claude_cmd" -p --model "$model" \
        --tools "" --no-session-persistence 2>&1
  )" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'Writer preflight failed: claude CLI/auth probe exited %s: %s\n' \
      "$rc" "$(printf '%s' "$output" | tail -1)" >&2
    return "$rc"
  fi
  output="$(printf '%s' "$output" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ "$output" != "OK" ]; then
    printf 'Writer preflight failed: expected exact OK, got: %s\n' "$output" >&2
    return 1
  fi
  printf 'OK\n'
}

# Parse one model selector strictly from the first YAML frontmatter block.
# Body text is rubric prose and must never become runtime configuration.
tribunal_claude_frontmatter_model() {
  local f="$1"
  [ -f "$f" ] || return 1
  awk '
    BEGIN { single_quote = sprintf("%c", 39) }
    NR == 1 {
      if ($0 !~ /^---[[:space:]]*$/) exit 1
      in_frontmatter = 1
      next
    }
    in_frontmatter && /^---[[:space:]]*$/ {
      in_frontmatter = 0
      if (model == "") exit 1
      print model
      found = 1
      exit 0
    }
    in_frontmatter && /^model:[[:space:]]*/ {
      if (model != "") exit 1
      value = $0
      sub(/^model:[[:space:]]*/, "", value)
      sub(/[[:space:]]+$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if ((first == "\"" && last == "\"") ||
          (first == single_quote && last == single_quote)) {
        value = substr(value, 2, length(value) - 2)
      }
      if (value !~ /^(opus|sonnet|haiku|fable)$/ &&
          value !~ /^claude-[A-Za-z0-9._-]+(\[[A-Za-z0-9]+\])?$/) exit 1
      model = value
    }
    END { if (!found) exit 1 }
  ' "$f"
}

# Resolve a Claude role selector. Known agent specs must contain valid
# frontmatter. Legacy or unknown names may reuse the Tribunal writer selector,
# but no hardcoded Claude model is kept in this shell runtime.
tribunal_claude_agent_model() {
  local agent_name="$1"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local f="$REPO_ROOT/.claude/agents/$agent_name.md"
  local m=""
  if [ -f "$f" ]; then
    if ! m="$(tribunal_claude_frontmatter_model "$f")"; then
      printf 'Missing or invalid frontmatter model in %s\n' "$f" >&2
      return 1
    fi
    printf '%s\n' "$m"
    return 0
  fi
  if [ "$agent_name" != "tribunal-writer" ]; then
    tribunal_claude_agent_model tribunal-writer
    return
  fi
  printf 'Missing Claude agent spec: %s\n' "$f" >&2
  return 1
}

# Resolve the floating `opus` alias to its concrete build for RECORDING only.
# Selection stays on the alias (tribunal_claude_agent_model returns it verbatim
# so `claude -p --model opus` still floats to Anthropic's latest Opus); this
# resolver is applied at the recording boundary so frontmatter scores.*.model
# and the progress ledger stamp the concrete version instead of an opaque
# alias.
#
# The bash judge path can't cheaply read Claude Code's runtime JSON metadata
# (the judge writes its score to a file; stdout is only grep'd for quota
# errors), so we resolve via the single SSOT constant OPUS_ALIAS_CURRENT in
# scripts/detect-model.mjs. Non-alias ids pass through untouched. Falls back to
# the input unchanged if node is unavailable.
tribunal_resolve_recorded_model() {
  local selector="$1"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local resolved=""
  if command -v node >/dev/null 2>&1 && [ -r "$REPO_ROOT/scripts/detect-model.mjs" ]; then
    resolved="$(node "$REPO_ROOT/scripts/detect-model.mjs" --id "$selector" 2>/dev/null)"
  fi
  if [ -n "$resolved" ]; then
    printf '%s\n' "$resolved"
  else
    printf '%s\n' "$selector"
  fi
}

# Programmatic model id stamped into frontmatter scores + progress for the
# active provider, so a Claude-scored post is not recorded as a Codex run.
# Optional agent_name yields the judge's declared Claude build; without it, a
# coarse provider label is returned. When a judge
# declares the floating `opus` alias, the recorded id is resolved to its
# concrete build (selection still uses the alias — see tribunal_claude_exec).
tribunal_llm_model_id() {
  local agent_name="${1:-}"
  local provider=""
  provider="$(tribunal_judge_provider "$agent_name" 2>/dev/null)" || return 1
  tribunal_model_id_for_provider "$provider" "$agent_name"
}

tribunal_model_id_for_provider() {
  local provider="$1"
  local agent_name="${2:-}"
  local claude_model=""
  case "$provider" in
    claude)
      claude_model="$(tribunal_claude_agent_model "${agent_name:-tribunal-writer}")" || return 1
      tribunal_resolve_recorded_model "$claude_model"
      ;;
    codex)
      tribunal_codex_agent_model "$agent_name"
      ;;
    *)
      return 1
      ;;
  esac
}

# Provider-aware runner label stamped into the internal progress ledger
# (.score-loop/state/tribunal-progress.json), the stage log lines, and the
# runner-error records. Shares the exact same provider resolution as the
# frontmatter model_id (tribunal_llm_provider + tribunal_llm_model_id) so a
# Claude-scored run is recorded as Claude internally — no second
# provider-detection path.
#
# - codex  → codex-<resolved-model>-medium
# - claude → the judge's declared Claude build, symmetric to the frontmatter
#            model_id
tribunal_runner_label() {
  local agent_name="${1:-}"
  local model provider
  provider="$(tribunal_judge_provider "$agent_name" 2>/dev/null)" || return 1
  tribunal_runner_label_for_provider "$provider" "$agent_name"
}

tribunal_runner_label_for_provider() {
  local provider="$1"
  local agent_name="${2:-}"
  local model
  model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" || return 1
  case "$provider" in
    claude)
      printf '%s\n' "$model"
      ;;
    codex)
      printf 'codex-%s-medium\n' "$model"
      ;;
    *)
      return 1
      ;;
  esac
}

tribunal_write_actual_provider() {
  local provider="$1"
  local agent_name="$2"
  local out_file="${TRIBUNAL_ACTUAL_PROVIDER_FILE:-}"
  [ -n "$out_file" ] || return 0
  local model runner
  model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" || return 1
  runner="$(tribunal_runner_label_for_provider "$provider" "$agent_name")" || return 1
  {
    printf 'provider=%s\n' "$provider"
    printf 'model_id=%s\n' "$model"
    printf 'runner_label=%s\n' "$runner"
  } > "$out_file"
}

# Claude equivalent of tribunal_codex_exec: inlines the .claude/agents/<name>.md
# rubric (its YAML frontmatter is the persona/pass-bar contract) and runs
# `claude -p` non-interactively. Under root (CCC) claude rejects
# bypassPermissions, so we use acceptEdits, which still auto-approves the
# judge's score-file write; non-root uses the broader bypassPermissions.
tribunal_claude_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local agent_file="$REPO_ROOT/.claude/agents/$agent_name.md"
  local agent_spec="" model=""
  if [ ! -s "$agent_file" ]; then
    printf 'Missing Claude agent spec: %s\n' "$agent_file" >&2
    return 1
  fi
  model="$(tribunal_claude_agent_model "$agent_name")" || return 1
  agent_spec="$(cat "$agent_file")" || return 1
  local prompt
  prompt="$(cat <<PROMPT
You are running inside the gu-log tribunal automation as a non-interactive judge.

## Claude Code agent spec: $agent_name
The YAML frontmatter and body below define your persona, rubric, and pass bar.
Follow them exactly. The runtime model is selected by this runner; ignore any
tools/model runtime fields in the frontmatter.

$agent_spec

## Repo root
$REPO_ROOT

## User task
$user_prompt
PROMPT
)"
  local timeout_sec claude_cmd
  timeout_sec="${TRIBUNAL_CODEX_TIMEOUT_SEC:-3600}"
  claude_cmd="$(tribunal_claude_cmd)" || return 127
  # Permission handling differs by uid:
  #  - non-root (mac/VPS): auto mode runs free without prompting. NOTE: we used
  #    to use bypassPermissions here, but on current CC `claude -p
  #    --permission-mode bypassPermissions` exits 1 the moment the agent invokes
  #    a tool (Edit/Write), so the writer never rewrote. auto mode auto-approves
  #    the read/edit/write the writer+judge need (verified editing an
  #    out-of-cwd post) and is the maintainer's chosen mode (no bypassPermissions).
  #  - root (CCC sandbox): claude *rejects* bypassPermissions, so we fall back to
  #    acceptEdits. But acceptEdits only auto-approves *edits*; the judge task
  #    passes the post as a PATH (not inlined), so the judge must Read it — which
  #    prompts for permission and then hangs forever against the </dev/null
  #    stdin. We therefore pre-approve the read/search/compute/write tools a judge
  #    actually uses via --allowed-tools, reproducing the non-root "never prompt"
  #    behavior with an explicit, narrower allowlist (no MCP, no network). Tools
  #    are comma-joined into a single arg so the variadic flag can't swallow the
  #    trailing "$prompt" positional.
  #    --allowed-tools is variadic, so we must NOT leave a trailing positional
  #    after it or the flag swallows the prompt text as bogus tool rules. Feed
  #    the prompt on stdin (claude -p reads stdin when no positional prompt is
  #    given) so the allowlist token is the last arg with nothing to consume.
  local -a perm_args
  if [ "$(id -u)" = "0" ]; then
    perm_args=(--permission-mode acceptEdits --allowed-tools "Read,Grep,Glob,Bash,Write,Edit,MultiEdit")
  else
    perm_args=(--permission-mode auto)
  fi
  (
    cd "$work_dir" || exit
    # See tribunal_codex_exec: do not leak the article flock into timeout/CLI.
    exec 200>&-
    printf '%s' "$prompt" |
      tribunal_session_exec timeout "$timeout_sec" "$claude_cmd" -p --model "$model" "${perm_args[@]}"
  )
}

# Provider-agnostic single-shot exec. Drop-in replacement for direct
# tribunal_codex_exec calls: routes to codex (primary) or claude (CCC
# fallback). On the VPS/mac where codex exists this is byte-for-byte the old
# codex path.
tribunal_llm_exec_raw() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  local provider=""
  provider="$(tribunal_judge_provider "$agent_name" 2>/dev/null)" || provider=""
  case "$provider" in
    claude)
      tribunal_claude_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    codex)
      tribunal_codex_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    *)
      echo "ERROR: no tribunal LLM provider available (need codex or claude on PATH)" >&2
      # CCC sandbox fallback: the CLI judge path (codex / `claude -p`) is often
      # unavailable in Claude Code on the web (codex not on PATH, claude CLI auth
      # / exit 1). Instead of hard-failing, tell the CCC agent to run the judge
      # via the Agent tool. This only prints on the error path, so it never
      # changes the codex/claude success behaviour on the VPS/mac.
      local _helper_dir
      _helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [ "$("$_helper_dir/detect-env.sh" 2>/dev/null)" = "CCC" ]; then
        cat >&2 <<EOF
↪ CCC fallback — score this judge with the Agent tool, do NOT skip:
  1. Spawn a subagent. If your harness exposes the named project agents, use
     subagent_type "$agent_name"; if it only exposes general-purpose, spawn
     "general-purpose" and tell it to read and follow .claude/agents/$agent_name.md
     exactly (zero parent context).
  2. Have it write JSON to /tmp/tribunal-<ticketId>-<judge>.json.
  3. Record the score with scripts/frontmatter-scores.mjs write <post> <judge> <json>.
  See playbooks/CCC-playbook.md §沙箱 fallback for the full 4-judge protocol.
EOF
      fi
      return 127
      ;;
  esac
}

tribunal_llm_exec() {
  tribunal_llm_exec_raw "$@"
}

tribunal_writer_exec_broker() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi

  local broker_dir="${GP_WRITER_BROKER_DIR:-$work_dir/.writer-broker}"
  local timeout_sec="${GP_WRITER_BROKER_TIMEOUT:-1800}"
  local poll_interval="${GP_WRITER_BROKER_POLL_INTERVAL:-2}"
  local post_file="${TRIBUNAL_WRITER_POST_FILE:-unknown-post.mdx}"
  local stage="${TRIBUNAL_WRITER_STAGE:-unknown}"
  local attempt="${TRIBUNAL_WRITER_ATTEMPT:-0}"
  local attempt_json="$attempt"
  case "$attempt_json" in
    ''|*[!0-9]*) attempt_json=0 ;;
  esac

  mkdir -p "$broker_dir"
  local safe_post safe_stage epoch id request tmp done_marker failed_marker claimed_marker
  safe_post="$(printf '%s' "$post_file" | tr -c 'A-Za-z0-9._-' '-')"
  safe_stage="$(printf '%s' "$stage" | tr -c 'A-Za-z0-9._-' '-')"
  epoch="$(date +%s)"
  id="${safe_post}-${safe_stage}-${attempt_json}-${epoch}-$$-$RANDOM"
  request="$broker_dir/$id.request.json"
  tmp="$broker_dir/$id.request.json.tmp.$$"
  done_marker="$broker_dir/$id.done"
  failed_marker="$broker_dir/$id.failed"
  claimed_marker="$broker_dir/$id.claimed"

  local post_path en_post_path created_at
  post_path="$REPO_ROOT/src/content/posts/$post_file"
  en_post_path=""
  if [ -f "$REPO_ROOT/src/content/posts/en-$post_file" ]; then
    en_post_path="$REPO_ROOT/src/content/posts/en-$post_file"
  fi
  created_at="$(TZ=UTC date '+%Y-%m-%dT%H:%M:%SZ')"

  jq -n \
    --arg id "$id" \
    --arg agent_name "$agent_name" \
    --arg post_file "$post_file" \
    --arg post_path "$post_path" \
    --arg en_post_path "$en_post_path" \
    --arg prompt "$user_prompt" \
    --arg stage "$stage" \
    --argjson attempt "$attempt_json" \
    --arg created_at "$created_at" \
    '{
      id: $id,
      agent_name: $agent_name,
      post_file: $post_file,
      post_path: $post_path,
      en_post_path: $en_post_path,
      prompt: $prompt,
      stage: $stage,
      attempt: $attempt,
      created_at: $created_at
    }' > "$tmp"
  mv "$tmp" "$request"

  printf 'writer broker request: %s\n' "$request"
  printf 'writer broker dir: %s\n' "$broker_dir"

  local start now
  start="$(date +%s)"
  while true; do
    if [ -f "$done_marker" ]; then
      rm -f "$request" "$done_marker" "$failed_marker" "$claimed_marker"
      return 0
    fi
    if [ -f "$failed_marker" ]; then
      echo "ERROR: tribunal-writer broker request failed: $request" >&2
      rm -f "$request" "$done_marker" "$failed_marker" "$claimed_marker"
      return 1
    fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout_sec" ]; then
      echo "WARN: tribunal-writer broker timed out after ${timeout_sec}s waiting for $request" >&2
      rm -f "$request" "$done_marker" "$failed_marker" "$claimed_marker"
      return 1
    fi
    sleep "$poll_interval"
  done
}

tribunal_writer_exec_raw() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  case "$(tribunal_writer_mode)" in
    subagent)
      tribunal_writer_exec_broker "$work_dir" "$agent_name" "$user_prompt"
      ;;
    none)
      echo "rewrite skipped (GP_WRITER_MODE=none)" >&2
      return 76
      ;;
    cli)
      case "$(tribunal_writer_provider 2>/dev/null)" in
        claude)
          tribunal_claude_exec "$work_dir" "$agent_name" "$user_prompt"
          ;;
        *)
          echo "ERROR: GP_WRITER_MODE=cli requires claude on PATH; refusing Codex/GPT writer fallback" >&2
          return 127
          ;;
      esac
      ;;
    codex)
      tribunal_codex_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    *)
      echo "ERROR: unsupported GP_WRITER_MODE='$(tribunal_writer_mode)' (expected none, subagent, cli, or codex)" >&2
      return 2
      ;;
  esac
}

tribunal_writer_exec_raw_legacy_cli() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  case "$(tribunal_writer_provider 2>/dev/null)" in
    claude)
      tribunal_claude_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    *)
      echo "ERROR: GP_WRITER_MODE=cli requires claude on PATH; refusing Codex/GPT writer fallback" >&2
      return 127
      ;;
  esac
}

tribunal_quota_alarm() {
  local msg="$1"
  local ts notifier
  ts="$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %z')"
  printf '[%s] [tribunal-alert] %s\n' "$ts" "$msg" >&2
  notifier="${TRIBUNAL_NOTIFIER:-}"
  [ -n "$notifier" ] || return 0
  case "$notifier" in
    /*) ;;
    *)
      printf '[%s] [tribunal-alert] notifier must be an absolute executable path: %s\n' \
        "$ts" "$notifier" >&2
      return 1
      ;;
  esac
  if [ ! -x "$notifier" ]; then
    printf '[%s] [tribunal-alert] notifier is not executable: %s\n' "$ts" "$notifier" >&2
    return 1
  fi
  "$notifier" "$msg"
}

# Read one simple KEY=value from `systemctl show -p Environment --value`.
# Tribunal deploy knobs are whitespace-free scalars, so the unit's effective
# environment can cleanly override values loaded from tribunal.env.
tribunal_unit_environment_value() {
  local environment="$1" key="$2"
  printf '%s\n' "$environment" |
    tr ' ' '\n' |
    sed -n "s/^${key}=//p" |
    tail -1
}

tribunal_effective_runtime_value() {
  local environment="$1" key="$2" fallback="$3"
  local unit_value
  unit_value="$(tribunal_unit_environment_value "$environment" "$key")"
  if [ -n "$unit_value" ]; then
    printf '%s\n' "$unit_value"
  else
    printf '%s\n' "$fallback"
  fi
}

# Alert state is intentionally process-local. A consecutive EXHAUSTED streak
# alerts once when it first reaches the threshold; any other completion resets
# the streak. Controller modes alert on entry, not every tick.
tribunal_alert_worker_completion() {
  local rc="$1" article="$2"
  local threshold="${TRIBUNAL_EXHAUSTED_ALERT_THRESHOLD:-3}"
  : "${TRIBUNAL_EXHAUSTED_STREAK:=0}"
  if [ "$rc" = "2" ]; then
    TRIBUNAL_EXHAUSTED_STREAK=$((TRIBUNAL_EXHAUSTED_STREAK + 1))
    if [ "$TRIBUNAL_EXHAUSTED_STREAK" -eq "$threshold" ]; then
      tribunal_quota_alarm "Tribunal EXHAUSTED spike: ${TRIBUNAL_EXHAUSTED_STREAK} consecutive articles; latest=$article."
    fi
    return 0
  fi
  TRIBUNAL_EXHAUSTED_STREAK=0
  if [ "$rc" = "124" ]; then
    tribunal_quota_alarm "Tribunal worker stalled: article=$article rc=124."
  fi
}

tribunal_alert_controller_mode_transition() {
  local mode="$1" floor="${2:-10}"
  : "${TRIBUNAL_LAST_ALERTED_CONTROLLER_MODE:=}"
  [ "$mode" = "$TRIBUNAL_LAST_ALERTED_CONTROLLER_MODE" ] && return 0
  TRIBUNAL_LAST_ALERTED_CONTROLLER_MODE="$mode"
  case "$mode" in
    fallback)
      tribunal_quota_alarm "Tribunal quota controller entered fallback mode (1 worker / 600s); inspect USAGE_MONITOR."
      ;;
    floor_stop)
      tribunal_quota_alarm "Tribunal quota controller entered floor_stop at configured floor ${floor}%."
      ;;
  esac
}

tribunal_classify_worker_result() {
  local rc="$1" worker_log="$2"
  if [ "$rc" = "70" ] &&
     [ -s "$worker_log" ] &&
     grep -q '\[tribunal-watchdog\] idle .* no output/score-file progress' "$worker_log"; then
    printf '124\n'
  else
    printf '%s\n' "$rc"
  fi
}

tribunal_write_worker_completion() {
  local marker="$1" worker_id="$2" rc="$3"
  local tmp="${marker}.tmp.$$"
  {
    printf 'worker_id=%s\n' "$worker_id"
    printf 'rc=%s\n' "$rc"
  } > "$tmp" && mv "$tmp" "$marker"
}

tribunal_write_worker_tracking() {
  local tracking_file="$1" worker_id="$2" pid="$3" worker_log="$4"
  local tmp="${tracking_file}.tmp.$$"
  {
    printf 'worker_id=%s\n' "$worker_id"
    printf 'pid=%s\n' "$pid"
    printf 'worker_log=%s\n' "$worker_log"
  } > "$tmp" && mv "$tmp" "$tracking_file"
}

# Atomically claim one completed-worker marker. The marker is written only
# after the worker closes its isolated log, so classification never races tee
# or a still-buffering writer. While polling, tracked PIDs are also checked:
# a dead child without a marker is reaped exactly and surfaced as deterministic
# infrastructure failure instead of hanging forever.
tribunal_wait_for_worker_completion() {
  local completion_dir="$1" combined_log="$2" poll_interval="${3:-0.2}"
  local marker claimed tracking worker_id pid worker_log wait_rc
  TRIBUNAL_WORKER_COMPLETION_KIND=""
  TRIBUNAL_WORKER_COMPLETION_MARKER=""
  while true; do
    for marker in "$completion_dir"/*.done; do
      [ -f "$marker" ] || continue
      claimed="${marker%.done}.claimed.$$"
      if mv "$marker" "$claimed" 2>/dev/null; then
        TRIBUNAL_WORKER_COMPLETION_KIND="marker"
        TRIBUNAL_WORKER_COMPLETION_MARKER="$claimed"
        return 0
      fi
    done
    for tracking in "$completion_dir"/*.tracking; do
      [ -f "$tracking" ] || continue
      worker_id="$(sed -n 's/^worker_id=//p' "$tracking" | head -1)"
      pid="$(sed -n 's/^pid=//p' "$tracking" | head -1)"
      worker_log="$(sed -n 's/^worker_log=//p' "$tracking" | head -1)"
      case "$pid" in
        ''|*[!0-9]*) continue ;;
      esac
      if ! kill -0 "$pid" 2>/dev/null; then
        # The marker may have landed after this iteration's first glob.
        [ -f "$completion_dir/$worker_id.done" ] && continue
        wait_rc=0
        wait "$pid" || wait_rc=$?
        if [ -f "$worker_log" ]; then
          cat "$worker_log" >> "$combined_log"
        fi
        rm -f "$worker_log" "$tracking" "$completion_dir/$worker_id.done"
        TRIBUNAL_WORKER_COMPLETION_KIND="missing_marker"
        TRIBUNAL_COMPLETED_WORKER_ID="$worker_id"
        TRIBUNAL_COMPLETED_WORKER_PID="$pid"
        TRIBUNAL_COMPLETED_WORKER_RAW_RC="$wait_rc"
        TRIBUNAL_COMPLETED_WORKER_RC=70
        return 0
      fi
    done
    sleep "$poll_interval"
  done
}

# Reap the exact child named by a claimed marker, append its fully-closed log,
# classify its exact exit status, and remove both per-worker artifacts.
# Results are returned in globals because command substitution would run this
# function in a subshell that cannot wait on the caller's child.
tribunal_collect_worker_completion() {
  local marker="$1" expected_id="$2" expected_pid="$3"
  local worker_log="$4" combined_log="$5" tracking_file="${6:-}"
  local recorded_id recorded_rc wait_rc=0
  recorded_id="$(sed -n 's/^worker_id=//p' "$marker" | head -1)"
  recorded_rc="$(sed -n 's/^rc=//p' "$marker" | head -1)"
  [ "$recorded_id" = "$expected_id" ] || return 1
  case "$recorded_rc" in
    ''|*[!0-9]*) return 1 ;;
  esac
  wait "$expected_pid" || wait_rc=$?
  [ "$wait_rc" = "$recorded_rc" ] || return 1
  cat "$worker_log" >> "$combined_log"
  TRIBUNAL_COMPLETED_WORKER_ID="$recorded_id"
  TRIBUNAL_COMPLETED_WORKER_PID="$expected_pid"
  TRIBUNAL_COMPLETED_WORKER_RAW_RC="$wait_rc"
  TRIBUNAL_COMPLETED_WORKER_RC="$(tribunal_classify_worker_result "$wait_rc" "$worker_log")"
  rm -f "$worker_log" "$marker" "$tracking_file"
}

tribunal_quota_error_file() {
  local file="$1"
  [ -s "$file" ] || return 1
  grep -Eiq '(^|[^0-9])429([^0-9]|$)|rate[- ]limit|too many requests|resource exhausted|quota exceeded|quota exhausted|usage limit|limit reached|try again later|temporarily limited' "$file"
}

tribunal_quota_seconds_from_text() {
  local text="$1"
  python3 - "$text" <<'PY' 2>/dev/null || printf '0\n'
import re, sys
s = sys.argv[1]
total = 0
for n, unit in re.findall(r'(\d+)\s*([dhms])', s, flags=re.I):
    n = int(n)
    total += n * {'d': 86400, 'h': 3600, 'm': 60, 's': 1}[unit.lower()]
print(total)
PY
}

tribunal_quota_max_wait_seconds() {
  tribunal_quota_seconds_from_text "${GP_QUOTA_MAX_WAIT:-6h}"
}

tribunal_quota_codexbar_block() {
  local provider="$1"
  local needle="codex"
  local usage
  case "$provider" in
    claude*) needle="claude" ;;
  esac
  if [ -n "${TRIBUNAL_QUOTA_CODEXBAR_OUTPUT:-}" ]; then
    usage="$TRIBUNAL_QUOTA_CODEXBAR_OUTPUT"
  else
    usage="$(timeout "${GP_CODEXBAR_TIMEOUT_SECONDS:-20}" codexbar usage 2>/dev/null || true)"
  fi
  printf '%s\n' "$usage" | awk -v needle="$needle" '
    BEGIN { in_block=0 }
    {
      lower=tolower($0)
      is_header=(lower ~ /codex/ || lower ~ /claude/)
      if (index(lower, needle) > 0) in_block=1
      else if (in_block && is_header) exit
      if (in_block) print
    }
  '
}

tribunal_quota_percent_left_from_line() {
  local line="$1"
  printf '%s\n' "$line" | grep -Eio '[0-9]+[[:space:]]*%[[:space:]]*left' | head -1 | grep -Eo '[0-9]+' || true
}

tribunal_quota_parse_block() {
  local block="$1"
  local current_section="" line reset_text reset_seconds
  local session_left="" session_reset=0 weekly_left="" weekly_reset=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*Session: ]]; then
      current_section="session"
      session_left="$(tribunal_quota_percent_left_from_line "$line")"
      continue
    fi
    if [[ "$line" =~ ^[[:space:]]*Weekly: ]]; then
      current_section="weekly"
      weekly_left="$(tribunal_quota_percent_left_from_line "$line")"
      continue
    fi
    if [[ "$line" =~ ^[[:space:]]*Resets?[[:space:]]+in[[:space:]]+(.+) ]]; then
      reset_text="${BASH_REMATCH[1]}"
      reset_seconds="$(tribunal_quota_seconds_from_text "$reset_text")"
      case "$current_section" in
        session) session_reset="$reset_seconds" ;;
        weekly) weekly_reset="$reset_seconds" ;;
      esac
    fi
  done <<< "$block"
  printf '%s|%s|%s|%s\n' "${session_left:-}" "${session_reset:-0}" "${weekly_left:-}" "${weekly_reset:-0}"
}

tribunal_quota_decision() {
  local provider="$1"
  local waits="$2"
  local block tier reset_seconds max_wait max_waits parsed session_left session_reset weekly_left weekly_reset
  max_wait="$(tribunal_quota_max_wait_seconds)"
  max_waits="${GP_QUOTA_MAX_WAITS:-3}"
  block="$(tribunal_quota_codexbar_block "$provider" || true)"
  if [ -z "$block" ]; then
    printf 'suspend|unknown|0|codexbar unavailable/unparseable\n'
    return 0
  fi
  parsed="$(tribunal_quota_parse_block "$block")"
  IFS='|' read -r session_left session_reset weekly_left weekly_reset <<< "$parsed"
  if [ "${weekly_left:-}" = "0" ]; then
    printf 'suspend|weekly|%s|weekly quota exhausted; resets in %s\n' "$weekly_reset" "$(tribunal_quota_human_duration "$weekly_reset")"
    return 0
  fi
  tier="session"
  reset_seconds="${session_reset:-0}"
  if [ "$reset_seconds" -gt 0 ] && [ "$reset_seconds" -le "$max_wait" ] && [ "$waits" -lt "$max_waits" ]; then
    printf 'wait|%s|%s|session quota exhausted; resets in %s\n' "$tier" "$reset_seconds" "$(tribunal_quota_human_duration "$reset_seconds")"
  else
    printf 'suspend|%s|%s|session quota exhausted; resets in %s\n' "$tier" "$reset_seconds" "$(tribunal_quota_human_duration "$reset_seconds")"
  fi
}

tribunal_quota_human_duration() {
  local seconds="${1:-0}"
  if ! [[ "$seconds" =~ ^[0-9]+$ ]] || [ "$seconds" -le 0 ]; then
    printf 'unknown'
    return 0
  fi
  local days hours minutes out=""
  days=$((seconds / 86400))
  seconds=$((seconds % 86400))
  hours=$((seconds / 3600))
  seconds=$((seconds % 3600))
  minutes=$((seconds / 60))
  [ "$days" -gt 0 ] && out="${out}${days}d "
  [ "$hours" -gt 0 ] && out="${out}${hours}h "
  [ "$minutes" -gt 0 ] && out="${out}${minutes}m "
  printf '%s' "${out% }"
}

tribunal_quota_write_status() {
  local provider="$1" action="$2" tier="$3" reset_seconds="$4" reason="$5"
  local out_file="${TRIBUNAL_QUOTA_STATUS_FILE:-}"
  [ -n "$out_file" ] || return 0
  {
    printf 'provider=%s\n' "$provider"
    printf 'action=%s\n' "$action"
    printf 'tier=%s\n' "$tier"
    printf 'reset_seconds=%s\n' "$reset_seconds"
    printf 'reason=%s\n' "$reason"
    printf 'resume_command=%s\n' "${TRIBUNAL_RESUME_COMMAND:-rerun the same tribunal command}"
  } > "$out_file"
}

tribunal_quota_handle_file() {
  local provider="$1"
  local output_file="$2"
  local waits="$3"
  tribunal_quota_error_file "$output_file" || return 1
  local decision action tier reset_seconds reason
  decision="$(tribunal_quota_decision "$provider" "$waits")"
  IFS='|' read -r action tier reset_seconds reason <<<"$decision"
  local resume="${TRIBUNAL_RESUME_COMMAND:-rerun the same tribunal command}"
  tribunal_quota_write_status "$provider" "$action" "$tier" "$reset_seconds" "$reason"
  if [ "$action" = "wait" ]; then
    local sleep_seconds buffer_seconds
    buffer_seconds="$(tribunal_quota_seconds_from_text "${GP_QUOTA_WAIT_BUFFER:-120s}")"
    sleep_seconds=$((reset_seconds + buffer_seconds))
    tribunal_quota_alarm "$provider quota exhausted ($tier). $reason. Sleeping ${sleep_seconds}s before retry."
    sleep "$sleep_seconds"
    tribunal_quota_alarm "$provider quota wait elapsed; retrying tribunal step."
    return 88
  fi
  tribunal_quota_alarm "$provider quota exhausted ($tier). $reason. Suspended; resume with: $resume"
  return 89
}

tribunal_writer_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  local mode
  mode="$(tribunal_writer_mode)"
  if [ "$mode" != "cli" ]; then
    tribunal_writer_exec_raw "$work_dir" "$agent_name" "$user_prompt"
    return $?
  fi

  local waits=0 provider out rc qrc
  provider="$(tribunal_writer_provider 2>/dev/null || true)"
  while true; do
    out="$(mktemp)"
    rc=0
    tribunal_writer_exec_raw_legacy_cli "$work_dir" "$agent_name" "$user_prompt" >"$out" 2>&1 || rc=$?
    cat "$out"
    if [ "$rc" -eq 0 ]; then
      rm -f "$out"
      return 0
    fi
    qrc=0
    tribunal_quota_handle_file "$provider" "$out" "$waits" || qrc=$?
    rm -f "$out"
    if [ "$qrc" -eq 88 ]; then
      waits=$((waits + 1))
      continue
    fi
    if [ "$qrc" -eq 89 ]; then
      return 75
    fi
    return "$rc"
  done
}

# Terminate the stable session created by tribunal_session_exec. TERM is
# intentionally followed by KILL against the same saved process-group id, so a
# TERM-ignoring descendant cannot escape by outliving/reparenting away from the
# top shell.
tribunal_terminate_session() {
  local pid_file="$1" outer_pid="$2"
  local grace="${TRIBUNAL_WATCHDOG_KILL_GRACE_SEC:-5}" pgid=""
  if [ -s "$pid_file" ]; then
    pgid="$(sed -n '1p' "$pid_file")"
  fi
  case "$pgid" in
    ''|*[!0-9]*) pgid="" ;;
  esac
  if [ -n "$pgid" ]; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$outer_pid" 2>/dev/null || true
  fi
  sleep "$grace"
  if [ -n "$pgid" ]; then
    kill -KILL -- "-$pgid" 2>/dev/null || true
  else
    kill -KILL "$outer_pid" 2>/dev/null || true
  fi
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
  local pid rc now last_change latest_mtime out_mtime progress_mtime waits force_provider provider qrc session_pid_file
  waits=0
  force_provider="${TRIBUNAL_FORCE_PROVIDER:-}"

  : > "$output_file"
  while true; do
  : > "$output_file"
  session_pid_file="$(mktemp "${TMPDIR:-/tmp}/tribunal-session.XXXXXX")"
  if [ -n "$force_provider" ]; then
    TRIBUNAL_PROCESS_GROUP_FILE="$session_pid_file" \
      TRIBUNAL_FORCE_PROVIDER="$force_provider" \
      tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
  else
    TRIBUNAL_PROCESS_GROUP_FILE="$session_pid_file" \
      tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
  fi
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
      printf '[tribunal-watchdog] idle for %ss with no output/score-file progress; killing judge pid %s\n' "$idle_timeout" "$pid" >> "$output_file"
      tribunal_terminate_session "$session_pid_file" "$pid"
      wait "$pid" 2>/dev/null || true
      rm -f "$session_pid_file"
      return 124
    fi
  done

  rc=0
  wait "$pid" || rc=$?
  rm -f "$session_pid_file"
  if [ "$rc" -eq 0 ]; then
    provider="${force_provider:-$(tribunal_judge_provider "$agent_name" 2>/dev/null || true)}"
    if ! tribunal_write_actual_provider "$provider" "$agent_name"; then
      printf '[tribunal-watchdog] failed to record provider/model provenance\n' >> "$output_file"
      return 70
    fi
    return 0
  fi
  provider="${force_provider:-$(tribunal_judge_provider "$agent_name" 2>/dev/null || true)}"
  if [ "$provider" = "codex" ] && [ "${GP_JUDGE_ALLOW_CLAUDE:-0}" = "1" ] && tribunal_claude_cmd >/dev/null 2>&1 && tribunal_quota_error_file "$output_file"; then
    tribunal_quota_alarm "codex judge quota exhausted; trying explicit Claude judge fallback."
    force_provider="claude"
    waits=0
    continue
  fi
  qrc=0
  tribunal_quota_handle_file "$provider" "$output_file" "$waits" || qrc=$?
  if [ "$qrc" -eq 88 ]; then
    waits=$((waits + 1))
    continue
  fi
  if [ "$qrc" -eq 89 ]; then
    return 75
  fi
  return "$rc"
  done
}

# Provider-agnostic alias. The watchdog body now dispatches through
# tribunal_llm_exec (codex primary, claude CCC fallback), so prefer this name
# at call sites; the codex-specific name is kept for back-compat.
tribunal_llm_exec_watchdog() {
  tribunal_codex_exec_watchdog "$@"
}
