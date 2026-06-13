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
  (
    cd "$work_dir"
    # Close stdin so non-interactive Codex runs don't inherit the caller's
    # open stdin and hang waiting for extra prompt text.
    exec </dev/null
    timeout "$timeout_sec" $codex_cmd exec --model gpt-5.5 -c "model_reasoning_effort=\"$reasoning_effort\"" --sandbox danger-full-access --skip-git-repo-check -- "$prompt"
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

# Resolve the active tribunal LLM provider: "codex" when present (the
# maintained judge runtime), else "claude" (CCC fallback). Returns 1 when
# neither binary is on PATH. Codex always wins when both exist; this intentionally
# mirrors the Go pipeline's JudgeChain, not the Opus writer chain.
tribunal_llm_provider() {
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

# Parse the `model:` field from a .claude/agents/<name>.md spec so each judge
# runs on its declared Claude build (vibe/fact-checker on opus, etc.). Falls
# back to the legacy Opus scorer/writer calibration model when the field is absent.
tribunal_claude_agent_model() {
  local agent_name="$1"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  local f="$REPO_ROOT/.claude/agents/$agent_name.md"
  local m=""
  if [ -f "$f" ]; then
    m="$(awk -F'model:[[:space:]]*' '/^model:/ {print $2; exit}' "$f" | tr -d '"'"'"'[:space:]')"
  fi
  if [ -n "$m" ]; then
    printf '%s\n' "$m"
  else
    printf 'claude-opus-4-6[1m]\n'
  fi
}

# Programmatic model id stamped into frontmatter scores + progress for the
# active provider, so a Claude-scored post is recorded honestly instead of
# being mislabelled GPT-5.5. Optional agent_name yields the judge's declared
# Claude build; without it, a coarse provider label is returned.
tribunal_llm_model_id() {
  local agent_name="${1:-}"
  case "$(tribunal_llm_provider 2>/dev/null)" in
    claude)
      if [ -n "$agent_name" ]; then
        tribunal_claude_agent_model "$agent_name"
      else
        printf 'claude-opus-4-6\n'
      fi
      ;;
    *)
      printf 'gpt-5.5\n'
      ;;
  esac
}

# Provider-aware runner label stamped into the internal progress ledger
# (.score-loop/state/tribunal-progress.json), the stage log lines, and the
# runner-error records. Shares the exact same provider resolution as the
# frontmatter model_id (tribunal_llm_provider + tribunal_llm_model_id) so a
# Claude-scored run is recorded as Claude internally instead of being
# mislabelled as the codex GPT-5.5 runner — no second provider-detection path.
#
# - codex  → codex-gpt-5.5-medium  (byte-for-byte unchanged so VPS/mac
#            calibration history stays continuous)
# - claude → the judge's declared Claude build, symmetric to the frontmatter
#            model_id (e.g. claude-opus-4-6[1m])
tribunal_runner_label() {
  local agent_name="${1:-}"
  local model
  model="$(tribunal_llm_model_id "$agent_name")"
  case "$(tribunal_llm_provider 2>/dev/null)" in
    claude)
      printf '%s\n' "$model"
      ;;
    *)
      printf 'codex-%s-medium\n' "$model"
      ;;
  esac
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
  local agent_spec=""
  if [ -f "$agent_file" ]; then
    agent_spec="$(cat "$agent_file")"
  fi
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
  local model timeout_sec claude_cmd
  model="$(tribunal_claude_agent_model "$agent_name")"
  timeout_sec="${TRIBUNAL_CODEX_TIMEOUT_SEC:-3600}"
  claude_cmd="$(tribunal_claude_cmd)" || return 127
  # Permission handling differs by uid:
  #  - non-root (mac/VPS): bypassPermissions never prompts — judge runs free.
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
    perm_args=(--permission-mode bypassPermissions)
  fi
  (
    cd "$work_dir"
    printf '%s' "$prompt" | timeout "$timeout_sec" "$claude_cmd" -p --model "$model" "${perm_args[@]}"
  )
}

# Provider-agnostic single-shot exec. Drop-in replacement for direct
# tribunal_codex_exec calls: routes to codex (primary) or claude (CCC
# fallback). On the VPS/mac where codex exists this is byte-for-byte the old
# codex path.
tribunal_llm_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  case "$(tribunal_llm_provider 2>/dev/null)" in
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
  tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
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

# Provider-agnostic alias. The watchdog body now dispatches through
# tribunal_llm_exec (codex primary, claude CCC fallback), so prefer this name
# at call sites; the codex-specific name is kept for back-compat.
tribunal_llm_exec_watchdog() {
  tribunal_codex_exec_watchdog "$@"
}
