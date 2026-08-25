#!/usr/bin/env bash
# Tribunal — Shared helper functions
# Source this file: source scripts/tribunal-helpers.sh

TRIBUNAL_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tribunal-model-router.sh
if [ -r "$TRIBUNAL_HELPERS_DIR/tribunal-model-router.sh" ]; then
  source "$TRIBUNAL_HELPERS_DIR/tribunal-model-router.sh"
else
  # Some compatibility tests and downstream callers copy this helper in
  # isolation. Preserve their legacy route, but never mask a missing router
  # when vm-codex was explicitly requested.
  model_router_profile() {
    case "${TRIBUNAL_RUNTIME_PROFILE:-legacy}" in
      legacy) printf 'legacy\n' ;;
      vm-codex)
        printf 'vm-codex model router is unavailable\n' >&2
        return 2
        ;;
      *)
        printf 'unknown runtime profile without model router: %s\n' \
          "$TRIBUNAL_RUNTIME_PROFILE" >&2
        return 2
        ;;
    esac
  }
  model_router_resolve() {
    local requested_role="${1:-unknown}"
    model_router_profile >/dev/null || return
    MODEL_ROUTER_PROFILE=legacy
    MODEL_ROUTER_ROLE="$requested_role"
    MODEL_ROUTER_PROVIDER=""
    MODEL_ROUTER_MODEL=""
    MODEL_ROUTER_REASONING=""
    MODEL_ROUTER_TIER=legacy
    MODEL_ROUTER_REMAINING=unknown
    MODEL_ROUTER_QUOTA_ACTION=run
  }
fi

# Extract ticketId from a post file (handles both single and double quotes)
# Usage: ticket_id=$(get_ticket_id "src/content/posts/file.mdx")
get_ticket_id() {
  local file="$1"
  # Match ticketId: "XX-N" or ticketId: 'XX-N' or ticketId: XX-N
  grep -m1 'ticketId' "$file" 2>/dev/null \
    | sed -E "s/.*ticketId:[[:space:]]*[\"']?([^\"']+)[\"']?.*/\1/" \
    | tr -d '[:space:]'
}

# Classify a full-site build failure for one target article.
# Operational evidence wins even when the log also names the target. Content
# evidence is actionable only when one diagnostic line contains both the exact
# article path and explicit content-error language.
tribunal_classify_build_failure() {
  local rc="$1" build_log="$2" post_file="$3"
  local post_rel="src/content/posts/$post_file"
  local en_rel="src/content/posts/en-$post_file"
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo operational
    return 0
  fi
  if grep -Eiq 'out of memory|oom-kill|oom killed|killed process|heap out of memory|JavaScript heap out of memory|FATAL ERROR|SIGKILL|Killed$|Exit status 137' "$build_log" 2>/dev/null; then
    echo operational
    return 0
  fi
  if awk -v post_rel="$post_rel" -v en_rel="$en_rel" '
    function remove_literal(text, literal, pos) {
      while ((pos = index(text, literal)) > 0) {
        text = substr(text, 1, pos - 1) substr(text, pos + length(literal))
      }
      return text
    }
    {
      names_target = index($0, post_rel) || index($0, en_rel)
      diagnostic = remove_literal(remove_literal($0, post_rel), en_rel)
      diagnostic = tolower(diagnostic)
      names_content_surface = diagnostic ~ /(mdx|frontmatter|schema|render|component|validate-posts|content collection|astro:content)/
      names_failure = diagnostic ~ /(error|fail|invalid|unexpected|expected|syntax|parse|cannot)/
      if (names_target && names_content_surface && names_failure) {
        found = 1
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$build_log" 2>/dev/null; then
    echo actionable
    return 0
  fi
  echo unknown
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

tribunal_writer_work_dir() {
  local d
  d="$(mktemp -d -t tribunal-writer-XXXXXX)"
  chmod 700 "$d"
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

# Validate an existing runtime JSON ledger without mutating the filesystem.
# A missing path is valid because callers may initialize it after all sibling
# ledgers pass this preflight.
validate_tribunal_runtime_json_file() {
  local target="$1"
  local label="$2"

  if [ -L "$target" ]; then
    printf 'ERROR: %s must not be a symbolic link: %s\n' "$label" "$target" >&2
    return 1
  fi

  if [ ! -e "$target" ]; then
    return 0
  fi

  if [ ! -f "$target" ]; then
    printf 'ERROR: %s is not a regular file: %s\n' "$label" "$target" >&2
    return 1
  fi

  if ! jq empty "$target" >/dev/null 2>&1; then
    printf 'ERROR: %s contains invalid JSON: %s\n' "$label" "$target" >&2
    return 1
  fi
}

# Initialize a missing runtime JSON ledger, but never repair or replace an
# existing invalid file. Callers own the initial shape; this helper only
# enforces the shared existence and JSON-syntax invariant.
ensure_tribunal_runtime_json_file() {
  local target="$1"
  local label="$2"
  local initial_filter="$3"

  validate_tribunal_runtime_json_file "$target" "$label" || return 1
  if [ -e "$target" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$target")"
  jq -n "$initial_filter" > "$target"
}

ensure_tribunal_progress_file() {
  local target="$1"
  local root="${2:-${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
  local legacy="${3:-$(tribunal_legacy_progress_file "$root")}"
  local migration_dir candidate backup="" migrate_legacy=0

  validate_tribunal_runtime_json_file "$target" "Tribunal progress ledger" || return 1
  if [ -e "$target" ]; then
    return 0
  fi

  if [ "$target" != "$legacy" ]; then
    validate_tribunal_runtime_json_file "$legacy" "legacy Tribunal progress ledger" || return 1
    if [ -e "$legacy" ]; then
      migrate_legacy=1
    fi
  fi

  migration_dir="$(tribunal_progress_migration_dir "$root")"
  mkdir -p "$(dirname "$target")" "$migration_dir"
  candidate="$(mktemp "${target}.tmp.XXXXXX")" || return 1

  if [ "$migrate_legacy" -eq 1 ]; then
    if ! cp "$legacy" "$candidate"; then
      rm -f "$candidate"
      return 1
    fi
  elif ! printf '{}\n' > "$candidate"; then
    rm -f "$candidate"
    return 1
  fi

  if ! validate_tribunal_runtime_json_file \
    "$candidate" \
    "Tribunal progress migration candidate"; then
    rm -f "$candidate"
    return 1
  fi

  if [ "$migrate_legacy" -eq 1 ]; then
    local stamp
    stamp="$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)"
    backup="$(mktemp "$migration_dir/legacy-tribunal-progress-$stamp.XXXXXX")" || {
      rm -f "$candidate"
      return 1
    }
    if ! cp "$candidate" "$backup"; then
      rm -f "$backup" "$candidate"
      return 1
    fi
    if ! cmp "$candidate" "$backup" >/dev/null; then
      rm -f "$backup" "$candidate"
      return 1
    fi
  fi

  if ! command link "$candidate" "$target" 2>/dev/null; then
    if [ -n "$backup" ]; then
      if ! rm -f "$backup" "$candidate"; then
        :
      fi
    else
      if ! rm -f "$candidate"; then
        :
      fi
    fi
    if [ -e "$candidate" ] || { [ -n "$backup" ] && [ -e "$backup" ]; }; then
      printf 'ERROR: unable to clean up an unpublished Tribunal progress candidate\n' >&2
      return 1
    fi
    validate_tribunal_runtime_json_file "$target" "Tribunal progress ledger" || return 1
    if [ -e "$target" ]; then
      return 0
    fi
    printf 'ERROR: unable to atomically create Tribunal progress ledger: %s\n' "$target" >&2
    return 1
  fi

  if ! rm -f "$candidate"; then
    printf 'WARN: unable to remove published Tribunal progress candidate: %s\n' "$candidate" >&2
  fi
  return 0
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

  if [ "$fetched" = "false" ]; then
    return 1
  fi
  return 0
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
  tribunal_codex_workspace_prompt_exec "$work_dir" "$model" "$prompt"
}

tribunal_codex_systemd_unit_name() {
  local kind="${1:-call}"
  kind="$(printf '%s' "$kind" | tr -cd 'a-z0-9-')"
  [ -n "$kind" ] || kind="call"
  printf 'gu-log-tribunal-codex-%s-%s-%s-%s\n' \
    "$kind" "${BASHPID:-$$}" "${RANDOM:-0}" "${RANDOM:-0}"
}

tribunal_stop_systemd_invocation() {
  local unit="$1"
  local systemctl_cmd
  if ! [[ "$unit" =~ ^gu-log-tribunal-codex-[a-z0-9-]+-[0-9]+-[0-9]+-[0-9]+$ ]]; then
    printf 'Refusing invalid Tribunal Codex systemd unit: %s\n' "$unit" >&2
    return 1
  fi
  systemctl_cmd="$(command -v systemctl 2>/dev/null || true)"
  case "$systemctl_cmd" in
    /*) ;;
    *)
      printf 'Deployed Codex cancellation requires systemctl\n' >&2
      return 1
      ;;
  esac
  "$systemctl_cmd" --user stop "$unit"
}

tribunal_validate_deployed_systemd_contract() {
  [ "$(uname -s 2>/dev/null || true)" = "Linux" ] || {
    printf 'Deployed Codex containment requires Linux\n' >&2
    return 1
  }
  local systemd_run systemctl_cmd
  local load_state active_state memory_max cpu_quota tasks_max
  local fragment_path need_reload drop_in_paths supervisor_slice
  local repo_root tracked_slice
  systemd_run="$(command -v systemd-run 2>/dev/null || true)"
  systemctl_cmd="$(command -v systemctl 2>/dev/null || true)"
  case "$systemd_run:$systemctl_cmd" in
    /*:/*) ;;
    *)
      printf 'Deployed Codex containment requires systemd-run and systemctl\n' >&2
      return 1
      ;;
  esac
  load_state="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p LoadState --value 2>/dev/null
  )" || {
    printf 'Cannot reach the user systemd manager for Tribunal containment\n' >&2
    return 1
  }
  if [ "$load_state" != "loaded" ]; then
    printf 'tribunal-runtime.slice is not loaded (state=%s)\n' \
      "${load_state:-unknown}" >&2
    return 1
  fi
  active_state="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p ActiveState --value 2>/dev/null
  )" || return 1
  memory_max="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p MemoryMax --value 2>/dev/null
  )" || return 1
  cpu_quota="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p CPUQuotaPerSecUSec --value 2>/dev/null
  )" || return 1
  tasks_max="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p TasksMax --value 2>/dev/null
  )" || return 1
  fragment_path="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p FragmentPath --value 2>/dev/null
  )" || return 1
  need_reload="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p NeedDaemonReload --value 2>/dev/null
  )" || return 1
  drop_in_paths="$(
    "$systemctl_cmd" --user show tribunal-runtime.slice \
      -p DropInPaths --value 2>/dev/null
  )" || return 1
  supervisor_slice="$(
    "$systemctl_cmd" --user show tribunal-loop.service \
      -p Slice --value 2>/dev/null
  )" || return 1

  if [ "$active_state" != "active" ] ||
     [ "$memory_max" != "4294967296" ] ||
     [ "$cpu_quota" != "2s" ] ||
     [ "$tasks_max" != "1024" ]; then
    printf 'tribunal-runtime.slice effective limits are stale: ActiveState=%s MemoryMax=%s CPUQuotaPerSecUSec=%s TasksMax=%s\n' \
      "${active_state:-unknown}" "${memory_max:-unknown}" \
      "${cpu_quota:-unknown}" "${tasks_max:-unknown}" >&2
    return 1
  fi
  if [ "$need_reload" != "no" ] || [ -n "$drop_in_paths" ]; then
    printf 'tribunal-runtime.slice has unreviewed systemd drift: NeedDaemonReload=%s DropInPaths=%s\n' \
      "${need_reload:-unknown}" "${drop_in_paths:-<none>}" >&2
    return 1
  fi
  if [ "$supervisor_slice" != "tribunal-runtime.slice" ]; then
    printf 'tribunal-loop.service is outside tribunal-runtime.slice (Slice=%s)\n' \
      "${supervisor_slice:-unknown}" >&2
    return 1
  fi

  repo_root="${REPO_ROOT:-${ROOT_DIR:-${GU_LOG_DIR:-}}}"
  tracked_slice="${repo_root%/}/scripts/tribunal-runtime.slice"
  if [ -z "$repo_root" ] || [[ "$fragment_path" != /* ]] ||
     [ ! -f "$tracked_slice" ] || [ ! -f "$fragment_path" ] ||
     ! cmp -s "$tracked_slice" "$fragment_path"; then
    printf 'tribunal-runtime.slice fragment does not match the tracked unit (FragmentPath=%s)\n' \
      "${fragment_path:-unknown}" >&2
    return 1
  fi
}

tribunal_codex_workspace_prompt_exec() {
  local work_dir="$1"
  local model="$2"
  local prompt="$3"
  local reasoning_effort
  local timeout_sec="${TRIBUNAL_CODEX_TIMEOUT_SEC:-3600}"
  local codex_cmd codex_executable timeout_cmd
  local -a codex_argv
  reasoning_effort="$(tribunal_codex_reasoning_effort)" || return 2
  if ! printf '%s\n' "$timeout_sec" | grep -Eq '^[1-9][0-9]*$'; then
    printf 'Invalid TRIBUNAL_CODEX_TIMEOUT_SEC=%s (expected a positive integer)\n' \
      "$timeout_sec" >&2
    return 2
  fi
  codex_cmd="$(tribunal_codex_cmd)" || return 127
  read -r -a codex_argv <<<"$codex_cmd"
  [ "${#codex_argv[@]}" -gt 0 ] || return 127
  codex_executable="$(command -v "${codex_argv[0]}" 2>/dev/null || true)"
  case "$codex_executable" in
    /*) codex_argv[0]="$codex_executable" ;;
    *)
      printf 'Codex executable did not resolve to an absolute path: %s\n' \
        "${codex_argv[0]}" >&2
      return 127
      ;;
  esac
  timeout_cmd="$(command -v timeout 2>/dev/null || true)"
  case "$timeout_cmd" in
    /*) ;;
    *)
      printf 'GNU timeout executable is unavailable\n' >&2
      return 127
      ;;
  esac
  (
    cd "$work_dir" || exit
    exec 200>&-
    exec </dev/null
    # This command is the Codex judge/writer security boundary. Keep the
    # isolated cwd as the only writable root; the repo/snapshots remain
    # read-only and both tmp auto-write exceptions are disabled. Sandbox
    # startup failure is terminal.
    local -a codex_exec_argv
    codex_exec_argv=(
      "$timeout_cmd" "$timeout_sec"
      "${codex_argv[@]}" exec
      --model "$model"
      -c "model_reasoning_effort=\"$reasoning_effort\""
      -c 'approval_policy="never"'
      -c 'sandbox_workspace_write.writable_roots=[]'
      -c 'sandbox_workspace_write.exclude_slash_tmp=true'
      -c 'sandbox_workspace_write.exclude_tmpdir_env_var=true'
      -c 'sandbox_workspace_write.network_access=false'
      -c 'shell_environment_policy.inherit="core"'
      -c 'web_search="disabled"'
      --sandbox workspace-write
      --ignore-user-config
      --ignore-rules
      --ephemeral
      --strict-config
      --skip-git-repo-check
      -- "$prompt"
    )
    if [ "${TRIBUNAL_DEPLOYED_MODE:-0}" = "1" ]; then
      local systemd_run scope_unit scope_runtime_sec
      local memory_max cpu_quota tasks_max
      local -a scope_env
      systemd_run="$(command -v systemd-run 2>/dev/null || true)"
      case "$systemd_run" in
        /*) ;;
        *)
          printf 'Deployed Codex containment requires systemd-run\n' >&2
          exit 127
          ;;
      esac
      memory_max="${TRIBUNAL_CODEX_SCOPE_MEMORY_MAX:-2G}"
      cpu_quota="${TRIBUNAL_CODEX_SCOPE_CPU_QUOTA:-200%}"
      tasks_max="${TRIBUNAL_CODEX_SCOPE_TASKS_MAX:-256}"
      if ! [[ "$memory_max" =~ ^[1-9][0-9]*[KMGT]$ ]] ||
         ! [[ "$cpu_quota" =~ ^[1-9][0-9]*%$ ]] ||
         ! [[ "$tasks_max" =~ ^[1-9][0-9]*$ ]]; then
        printf 'Invalid deployed Codex scope limits: MemoryMax=%s CPUQuota=%s TasksMax=%s\n' \
          "$memory_max" "$cpu_quota" "$tasks_max" >&2
        exit 2
      fi
      scope_unit="${TRIBUNAL_CODEX_SYSTEMD_UNIT:-$(
        tribunal_codex_systemd_unit_name call
      )}"
      if ! [[ "$scope_unit" =~ ^gu-log-tribunal-codex-[a-z0-9-]+-[0-9]+-[0-9]+-[0-9]+$ ]]; then
        printf 'Invalid Tribunal Codex systemd unit: %s\n' "$scope_unit" >&2
        exit 2
      fi
      scope_runtime_sec=$((timeout_sec + 10))
      scope_env=(
        "--setenv=HOME=$HOME"
        "--setenv=PATH=$PATH"
      )
      if [ -n "${CODEX_HOME:-}" ]; then
        scope_env+=("--setenv=CODEX_HOME=$CODEX_HOME")
      fi
      if [ -n "${TZ:-}" ]; then
        scope_env+=("--setenv=TZ=$TZ")
      fi
      exec "$systemd_run" \
        --user \
        --wait \
        --pipe \
        --collect \
        --quiet \
        --no-ask-password \
        --service-type=exec \
        --expand-environment=no \
        "--unit=$scope_unit" \
        --slice=tribunal-runtime.slice \
        "--description=gu-log Tribunal isolated Codex invocation" \
        "--working-directory=$work_dir" \
        --property=KillMode=control-group \
        --property=SendSIGKILL=yes \
        --property=TimeoutStopSec=5s \
        "--property=RuntimeMaxSec=${scope_runtime_sec}s" \
        --property=OOMPolicy=kill \
        "--property=MemoryMax=$memory_max" \
        "--property=CPUQuota=$cpu_quota" \
        "--property=TasksMax=$tasks_max" \
        '--property=UnsetEnvironment=CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY' \
        "${scope_env[@]}" \
        -- "${codex_exec_argv[@]}"
    fi
    exec "${codex_exec_argv[@]}"
  )
}

tribunal_codex_writer_prompt_exec() {
  tribunal_codex_workspace_prompt_exec "$@"
}

tribunal_codex_writer_exec() {
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
You are running inside the gu-log tribunal writer automation.

## Codex agent config: $agent_name
$codex_agent_spec

## Legacy Claude Code rubric: $agent_name
The following file is detailed rubric text only. Ignore its YAML frontmatter
runtime fields.

$legacy_agent_spec

## Isolated candidate workspace
$work_dir

## User task
$user_prompt
PROMPT
)"
  tribunal_codex_writer_prompt_exec "$work_dir" "$model" "$prompt"
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

tribunal_grok_cmd() {
  if command -v grok >/dev/null 2>&1 && grok --help >/dev/null 2>&1; then
    printf 'grok\n'
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
  local agent_name="${1:-fact-checker}" runtime_profile
  if [ -n "${TRIBUNAL_FORCE_PROVIDER:-}" ]; then
    printf 'TRIBUNAL_STRICT_ROLE_PROVIDERS=1 conflicts with TRIBUNAL_FORCE_PROVIDER\n' >&2
    return 1
  fi
  runtime_profile="$(model_router_profile)" || return 1
  if [ "$runtime_profile" = "vm-codex" ]; then
    model_router_resolve "$agent_name" || return 1
    printf '%s\n' "$MODEL_ROUTER_PROVIDER"
    return 0
  fi
  case "$agent_name" in
    vibe-opus-scorer|fact-checker|librarian|fresh-eyes)
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
  local role provider
  for role in vibe-opus-scorer fact-checker librarian fresh-eyes; do
    provider="$(tribunal_strict_provider_for_role "$role")" || return 1
    tribunal_model_id_for_provider "$provider" "$role" >/dev/null || return 1
  done
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

# Agent-aware provider preference for a tribunal judge. Deployed strict mode
# returns earlier and binds every judge to the active runtime profile. With
# strict mode unset, the compatibility path keeps the historical Vibe/Claude
# preference and otherwise uses the global Codex-first resolver.
#
# Precedence: global TRIBUNAL_FORCE_PROVIDER wins for ALL judges (emergency /
# A-B test) because tribunal_llm_provider already honors it, so delegating
# preserves the override. Availability: vibe prefers Claude only when the claude
# binary is on PATH; otherwise it falls through to the global resolver exactly
# like any other judge. This fallback behavior is never part of deployed strict
# success.
#
# Callers without a judge identity (empty agent_name) get the global resolver
# byte-for-byte, so every existing non-judge call path is unchanged.
tribunal_judge_provider() {
  local agent_name="${1:-}" runtime_profile
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
  runtime_profile="$(model_router_profile)" || return 1
  if [ "$runtime_profile" = "vm-codex" ]; then
    model_router_resolve "$agent_name" || return 1
    printf '%s\n' "$MODEL_ROUTER_PROVIDER"
    return 0
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

# Probe the deployed writer before any article is claimed. The canary is
# deliberately tiny and bounded, but it executes through the exact same prompt
# executor and write sandbox as a real rewrite.
tribunal_writer_preflight() (
  local mode model timeout_sec output rc=0 work_dir canary_file canary_token
  mode="$(tribunal_writer_mode)"
  case "$mode" in
    codex) ;;
    grok)
      tribunal_grok_writer_preflight
      return
      ;;
    none|subagent)
      printf 'Writer preflight failed: deployed runtime requires its configured CLI writer (got %s)\n' "$mode" >&2
      return 1
      ;;
    cli)
      printf 'Writer preflight failed: GP_WRITER_MODE=cli is compatibility-only and cannot be deployed\n' >&2
      return 1
      ;;
    *)
      printf 'Writer preflight failed: unsupported GP_WRITER_MODE=%s\n' "$mode" >&2
      return 1
      ;;
  esac
  model="$(tribunal_codex_agent_model tribunal-writer)" || {
    printf 'Writer preflight failed: cannot resolve tribunal-writer model\n' >&2
    return 1
  }
  timeout_sec="${TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC:-30}"
  if ! printf '%s\n' "$timeout_sec" | grep -Eq '^[1-9][0-9]*$'; then
    printf 'Writer preflight failed: TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC must be a positive integer\n' >&2
    return 2
  fi
  work_dir="$(tribunal_writer_work_dir)" || {
    printf 'Writer preflight failed: cannot create isolated canary workspace\n' >&2
    return 1
  }
  trap 'rm -rf "$work_dir"' EXIT
  canary_file="$work_dir/.tribunal-writer-preflight-canary"
  canary_token="tribunal-codex-writer-canary-$$-${RANDOM:-0}"
  output="$(
    TRIBUNAL_CODEX_TIMEOUT_SEC="$timeout_sec" \
      tribunal_codex_writer_prompt_exec "$work_dir" "$model" \
        "This is a bounded deployed-writer write canary.
Canary path: $canary_file
Canary token: $canary_token
Write exactly the canary token followed by one newline to the canary path.
Do not write any other file. Reply OK only after the file is durable." 2>&1
  )" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'Writer preflight failed: Codex write canary exited %s: %s\n' \
      "$rc" "$(printf '%s' "$output" | tail -1)" >&2
    return "$rc"
  fi
  if [ ! -f "$canary_file" ] ||
     [ "$(cat "$canary_file" 2>/dev/null || true)" != "$canary_token" ] ||
     [ "$(wc -l < "$canary_file" 2>/dev/null | tr -d ' ' || true)" != "1" ]; then
    printf 'Writer preflight failed: Codex write canary did not create the exact expected file\n' >&2
    return 1
  fi
  printf 'OK\n'
)

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
  local claude_model="" runtime_profile
  case "$provider" in
    claude)
      claude_model="$(tribunal_claude_agent_model "${agent_name:-tribunal-writer}")" || return 1
      tribunal_resolve_recorded_model "$claude_model"
      ;;
    codex)
      runtime_profile="$(model_router_profile)" || return 1
      if [ "$runtime_profile" = "vm-codex" ]; then
        model_router_resolve "$agent_name" || return 1
        printf '%s\n' "$MODEL_ROUTER_MODEL"
      else
        tribunal_codex_agent_model "$agent_name"
      fi
      ;;
    grok)
      model_router_resolve "$agent_name" || return 1
      [ "$MODEL_ROUTER_PROVIDER" = grok ] || return 1
      printf '%s\n' "$MODEL_ROUTER_MODEL"
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
# - codex  → codex-<resolved-model>-<actual reasoning effort>
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
  local model reasoning="" runtime_profile
  runtime_profile="$(model_router_profile)" || return 1
  if [ "$runtime_profile" = "vm-codex" ] &&
     { [ "$provider" = codex ] || [ "$provider" = grok ]; }; then
    model_router_resolve "$agent_name" || return 1
    [ "$MODEL_ROUTER_PROVIDER" = "$provider" ] || return 1
    model="$MODEL_ROUTER_MODEL"
    reasoning="$MODEL_ROUTER_REASONING"
  else
    model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" || return 1
  fi
  tribunal_runner_label_for_resolved_model "$provider" "$model" "$reasoning"
}

tribunal_codex_reasoning_effort() {
  local reasoning="${TRIBUNAL_CODEX_REASONING:-medium}"
  if ! [[ "$reasoning" =~ ^[A-Za-z0-9_-]+$ ]]; then
    printf 'Invalid TRIBUNAL_CODEX_REASONING=%s\n' "$reasoning" >&2
    return 1
  fi
  printf '%s\n' "$reasoning"
}

tribunal_runner_label_for_resolved_model() {
  local provider="$1"
  local model="$2"
  local reasoning="${3:-}" runtime_profile
  case "$provider" in
    claude)
      printf '%s\n' "$model"
      ;;
    codex)
      if [ -z "$reasoning" ]; then
        runtime_profile="$(model_router_profile)" || return 1
        if [ "$runtime_profile" = "vm-codex" ]; then
          model_router_resolve reviewer || return 1
          reasoning="$MODEL_ROUTER_REASONING"
        else
          reasoning="$(tribunal_codex_reasoning_effort)" || return 1
        fi
      fi
      printf 'codex-%s-%s\n' "$model" "$reasoning"
      ;;
    grok)
      if [ -z "$reasoning" ]; then
        model_router_resolve vibeScorer || return 1
        reasoning="$MODEL_ROUTER_REASONING"
      fi
      printf 'grok-build-%s-%s\n' "$model" "$reasoning"
      ;;
    *)
      return 1
      ;;
  esac
}

tribunal_write_actual_provider() {
  local provider="$1"
  local agent_name="$2"
  local resolved_model="${3:-}"
  local resolved_reasoning="${4:-}"
  local out_file="${TRIBUNAL_ACTUAL_PROVIDER_FILE:-}"
  [ -n "$out_file" ] || return 0
  local model runner
  if [ -n "$resolved_model" ]; then
    model="$resolved_model"
  else
    model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" || return 1
  fi
  runner="$(
    tribunal_runner_label_for_resolved_model \
      "$provider" "$model" "$resolved_reasoning"
  )" ||
    return 1
  {
    printf 'provider=%s\n' "$provider"
    printf 'model_id=%s\n' "$model"
    printf 'runner_label=%s\n' "$runner"
  } > "$out_file"
}

tribunal_writer_provenance_complete() {
  local provider="$1" model="$2" runner="$3"
  case "$provider" in
    codex|grok) ;;
    *) return 1 ;;
  esac
  [ -n "$model" ] && [ -n "$runner" ]
}

# Claude equivalent of tribunal_codex_exec: inlines the .claude/agents/<name>.md
# rubric (its YAML frontmatter is the persona/pass-bar contract) and runs
# `claude -p` non-interactively. Both root and non-root use acceptEdits plus an
# explicit narrow tool allowlist: auto can return success while waiting for an
# interactive edit approval, and bypassPermissions is unsupported under root.
tribunal_claude_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  if [ ! -d "$REPO_ROOT" ]; then
    printf 'Claude tribunal REPO_ROOT is not a directory: %s\n' "$REPO_ROOT" >&2
    return 1
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
  # The CLI starts in an isolated temp directory, so both judge and writer must
  # explicitly receive the repo as one narrow additional directory. Keep
  # --add-dir before the variadic --allowed-tools flag, and keep the prompt on
  # stdin so no option can swallow it.
  #
  # acceptEdits alone only auto-approves edits; the judge task passes the post as
  # a PATH (not inlined), so Read would still prompt. Pre-approve only the
  # read/search/compute/write tools judge and writer need (no MCP, no network).
  # This same non-interactive contract is required for root and non-root:
  # permission-mode auto can print "Waiting for permission to edit" and return
  # rc=0 without changing the article, while bypassPermissions is rejected in
  # root environments.
  #
  # Tools are comma-joined into a single arg so the variadic flag cannot swallow
  # a trailing prompt positional.
  #    --allowed-tools is variadic, so we must NOT leave a trailing positional
  #    after it or the flag swallows the prompt text as bogus tool rules. Feed
  #    the prompt on stdin (claude -p reads stdin when no positional prompt is
  #    given) so the allowlist token is the last arg with nothing to consume.
  local -a perm_args
  perm_args=(--add-dir "$REPO_ROOT" --permission-mode acceptEdits --allowed-tools "Read,Grep,Glob,Bash,Write,Edit,MultiEdit")
  (
    cd "$work_dir" || exit
    # See tribunal_codex_exec: do not leak the article flock into timeout/CLI.
    exec 200>&-
    printf '%s' "$prompt" |
      timeout "$timeout_sec" "$claude_cmd" -p --model "$model" "${perm_args[@]}"
  )
}

tribunal_grok_prompt_exec() {
  local work_dir="$1" model="$2" reasoning="$3" sandbox_profile="$4" prompt="$5"
  local json_schema="${6:-}"
  local timeout_sec="${TRIBUNAL_CODEX_TIMEOUT_SEC:-3600}"
  local grok_cmd grok_executable timeout_cmd runtime_profile
  local -a grok_argv
  grok_cmd="$(tribunal_grok_cmd)" || return 127
  grok_executable="$(command -v "$grok_cmd" 2>/dev/null || true)"
  case "$grok_executable" in
    /*) ;;
    *)
      printf 'Grok executable did not resolve to an absolute path: %s\n' \
        "$grok_cmd" >&2
      return 127
      ;;
  esac
  timeout_cmd="$(command -v timeout 2>/dev/null || true)"
  case "$timeout_cmd" in
    /*) ;;
    *) return 127 ;;
  esac
  runtime_profile="$(model_router_profile)" || return 2
  if [ "$runtime_profile" != "vm-codex" ]; then
    printf 'Grok execution requires the vm-codex runtime profile\n' >&2
    return 2
  fi
  grok_argv=(
    "$timeout_cmd" "$timeout_sec" "$grok_executable"
    --no-auto-update
    --model "$model"
    --reasoning-effort "$reasoning"
    --sandbox "$sandbox_profile"
    --permission-mode bypassPermissions
    --tools read_file,grep,list_dir,search_replace
    --no-plan
    --no-subagents
    --no-memory
    --disable-web-search
    --verbatim
  )
  if [ -n "$json_schema" ]; then
    grok_argv+=(--json-schema "$json_schema")
  else
    grok_argv+=(--output-format plain)
  fi
  grok_argv+=(--single "$prompt")
  (
    cd "$work_dir" || exit
    exec 200>&-
    exec </dev/null
    if [ "$runtime_profile" = "vm-codex" ]; then
      local systemd_run scope_unit scope_runtime_sec
      local memory_max cpu_quota tasks_max
      local -a scope_env
      systemd_run="$(command -v systemd-run 2>/dev/null || true)"
      case "$systemd_run" in
        /*) ;;
        *)
          printf 'Deployed Grok containment requires systemd-run\n' >&2
          exit 127
          ;;
      esac
      memory_max="${TRIBUNAL_CODEX_SCOPE_MEMORY_MAX:-2G}"
      cpu_quota="${TRIBUNAL_CODEX_SCOPE_CPU_QUOTA:-200%}"
      tasks_max="${TRIBUNAL_CODEX_SCOPE_TASKS_MAX:-256}"
      if ! [[ "$memory_max" =~ ^[1-9][0-9]*[KMGT]$ ]] ||
         ! [[ "$cpu_quota" =~ ^[1-9][0-9]*%$ ]] ||
         ! [[ "$tasks_max" =~ ^[1-9][0-9]*$ ]]; then
        printf 'Invalid deployed Grok scope limits: MemoryMax=%s CPUQuota=%s TasksMax=%s\n' \
          "$memory_max" "$cpu_quota" "$tasks_max" >&2
        exit 2
      fi
      scope_unit="${TRIBUNAL_CODEX_SYSTEMD_UNIT:-$(
        tribunal_codex_systemd_unit_name call
      )}"
      if ! [[ "$scope_unit" =~ ^gu-log-tribunal-codex-[a-z0-9-]+-[0-9]+-[0-9]+-[0-9]+$ ]]; then
        printf 'Invalid Tribunal systemd unit: %s\n' "$scope_unit" >&2
        exit 2
      fi
      scope_runtime_sec=$((timeout_sec + 10))
      scope_env=(
        "--setenv=HOME=$HOME"
        "--setenv=PATH=$PATH"
      )
      if [ -n "${TZ:-}" ]; then
        scope_env+=("--setenv=TZ=$TZ")
      fi
      exec "$systemd_run" \
        --user \
        --wait \
        --pipe \
        --collect \
        --quiet \
        --no-ask-password \
        --service-type=exec \
        --expand-environment=no \
        "--unit=$scope_unit" \
        --slice=tribunal-runtime.slice \
        "--description=gu-log Tribunal isolated Grok invocation" \
        "--working-directory=$work_dir" \
        --property=KillMode=control-group \
        --property=SendSIGKILL=yes \
        --property=TimeoutStopSec=5s \
        "--property=RuntimeMaxSec=${scope_runtime_sec}s" \
        --property=OOMPolicy=kill \
        "--property=MemoryMax=$memory_max" \
        "--property=CPUQuota=$cpu_quota" \
        "--property=TasksMax=$tasks_max" \
        '--property=UnsetEnvironment=CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY XAI_API_KEY GROK_API_KEY' \
        "${scope_env[@]}" \
        -- "${grok_argv[@]}"
    fi
    exec "${grok_argv[@]}"
  )
}

tribunal_grok_quota_gate() {
  case "${MODEL_ROUTER_QUOTA_ACTION:-run}" in
    run|reserve)
      return 0
      ;;
    pause|defer)
      local action="${MODEL_ROUTER_QUOTA_ACTION}" reason
      reason="Grok quota policy action=$action remaining=${MODEL_ROUTER_REMAINING:-unknown}% role=${MODEL_ROUTER_ROLE:-unknown}"
      tribunal_quota_write_status grok suspend \
        "${MODEL_ROUTER_TIER:-unknown}" 0 "$reason"
      printf '%s\n' "$reason" >&2
      return 75
      ;;
    *)
      printf 'Unknown Grok quota action: %s\n' "$MODEL_ROUTER_QUOTA_ACTION" >&2
      return 70
      ;;
  esac
}

tribunal_grok_exec() {
  local work_dir="$1" agent_name="$2" user_prompt="$3"
  if [ -z "${REPO_ROOT:-}" ]; then
    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fi
  model_router_resolve "$agent_name" || return 1
  [ "$MODEL_ROUTER_PROVIDER" = grok ] || {
    printf 'Grok executor received non-Grok route for %s\n' "$agent_name" >&2
    return 1
  }
  tribunal_grok_quota_gate || return $?
  local codex_agent_file="$REPO_ROOT/.codex/agents/$agent_name.toml"
  local claude_agent_file="$REPO_ROOT/.claude/agents/$agent_name.md"
  local codex_agent_spec="" claude_agent_spec="" sandbox_profile=read-only
  [ -f "$codex_agent_file" ] && codex_agent_spec="$(cat "$codex_agent_file")"
  [ -f "$claude_agent_file" ] && claude_agent_spec="$(cat "$claude_agent_file")"
  [ "$agent_name" = tribunal-writer ] && sandbox_profile=workspace
  local prompt
  prompt="$(cat <<PROMPT
You are running inside the gu-log tribunal automation.

## Provider-neutral agent contract: $agent_name
$codex_agent_spec

## Detailed rubric: $agent_name
Ignore YAML frontmatter runtime fields such as model and tools. Follow the
persona, scoring contract, and writing rules in the body.

$claude_agent_spec

## Repo root (read-only reference)
$REPO_ROOT

## Task
$user_prompt
PROMPT
)"
  tribunal_grok_prompt_exec \
    "$work_dir" "$MODEL_ROUTER_MODEL" "$MODEL_ROUTER_REASONING" \
    "$sandbox_profile" "$prompt"
}

tribunal_grok_writer_preflight() (
  local work_dir canary_file canary_token output rc=0
  model_router_resolve writer || return 1
  [ "$MODEL_ROUTER_PROVIDER" = grok ] || return 1
  tribunal_grok_quota_gate || return $?
  work_dir="$(tribunal_writer_work_dir)" || return 1
  trap 'rm -rf "$work_dir"' EXIT
  canary_file="$work_dir/.tribunal-writer-preflight-canary"
  canary_token="tribunal-grok-writer-canary-$$-${RANDOM:-0}"
  printf 'PLACEHOLDER\n' > "$canary_file"
  output="$(
    TRIBUNAL_CODEX_TIMEOUT_SEC="${TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC:-45}" \
      tribunal_grok_prompt_exec \
        "$work_dir" "$MODEL_ROUTER_MODEL" "$MODEL_ROUTER_REASONING" workspace \
        "Replace the entire contents of $canary_file with exactly $canary_token followed by one newline. Do not write any other file. Reply OK only after the file is durable." 2>&1
  )" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'Writer preflight failed: Grok write canary exited %s: %s\n' \
      "$rc" "$(printf '%s' "$output" | tail -1)" >&2
    return "$rc"
  fi
  if [ ! -f "$canary_file" ] ||
     [ "$(cat "$canary_file" 2>/dev/null || true)" != "$canary_token" ] ||
     [ "$(wc -l < "$canary_file" 2>/dev/null | tr -d ' ' || true)" != 1 ]; then
    printf 'Writer preflight failed: Grok write canary did not create the expected file\n' >&2
    return 1
  fi
  printf 'OK\n'
)

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
    grok)
      tribunal_grok_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    *)
      echo "ERROR: no tribunal LLM provider available for the active runtime profile" >&2
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
      tribunal_codex_writer_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    grok)
      tribunal_grok_exec "$work_dir" "$agent_name" "$user_prompt"
      ;;
    *)
      echo "ERROR: unsupported GP_WRITER_MODE='$(tribunal_writer_mode)' (expected none, subagent, cli, codex, or grok)" >&2
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
      tribunal_quota_alarm "Tribunal quota controller entered fallback mode (1 worker / 600s); inspect the provider-specific CodexBar JSON probe."
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

tribunal_quota_codexbar_json() {
  local timeout_seconds="${GP_CODEXBAR_TIMEOUT_SECONDS:-20}"
  case "$timeout_seconds" in
    ''|*[!0-9]*|0) return 1 ;;
  esac
  if [ -n "${TRIBUNAL_QUOTA_CODEXBAR_JSON:-}" ]; then
    printf '%s\n' "$TRIBUNAL_QUOTA_CODEXBAR_JSON"
    return 0
  fi
  timeout "$timeout_seconds" \
    codexbar usage --provider codex --source cli --format json --pretty
}

tribunal_quota_parse_json() {
  local json="$1"
  local now_epoch="${TRIBUNAL_QUOTA_NOW_EPOCH:-$(date +%s)}"
  case "$now_epoch" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$json" | jq -er --argjson now "$now_epoch" '
    def provider_record:
      if type == "array" then
        select(length == 1 and .[0].provider == "codex") | .[0]
      elif type == "object" and .provider == "codex" then
        .
      else
        null
      end;
    def reset_epoch:
      if type == "number" then .
      elif type == "string" then fromdateiso8601
      else 0
      end;
    provider_record
    | select(
        . != null
        and (.source == "cli" or .source == "codex-cli")
        and (.error? // null) == null
      )
    | .usage as $usage
    | select(
        ($usage | type) == "object"
        and ($usage | has("primary"))
        and ($usage | has("secondary"))
      )
    | ($usage.secondary.windowMinutes | select(type == "number" and . == 10080)) as $weekly_window
    | ($usage.secondary.usedPercent | select(type == "number" and . >= 0 and . <= 100)) as $weekly_used
    | ($usage.secondary.resetsAt | reset_epoch | select(. > $now)) as $weekly_reset_at
    | (
        if $usage.primary == null then
          # Negative values are the controller inactive-window sentinels.
          # Burn-rate math ignores this pair instead of inferring quota.
          [-1, -1]
        elif ($usage.primary | type) == "object" then
          ($usage.primary.windowMinutes | select(type == "number" and . == 300)) as $session_window
          | ($usage.primary.usedPercent | select(type == "number" and . >= 0 and . <= 100)) as $session_used
          | ($usage.primary.resetsAt | reset_epoch | select(. > $now)) as $session_reset_at
          | [
              (100 - $session_used | floor),
              ([$session_reset_at - $now, 0] | max | floor)
            ]
        else
          empty
        end
      ) as $session
    | [
        $session[0],
        $session[1],
        (100 - $weekly_used | floor),
        ([$weekly_reset_at - $now, 0] | max | floor)
      ]
    | map(tostring)
    | join("|")
  '
}

tribunal_quota_decision() {
  local provider="$1"
  local waits="$2"
  local usage_json tier reset_seconds max_wait max_waits parsed session_reset weekly_left weekly_reset
  max_wait="$(tribunal_quota_max_wait_seconds)"
  max_waits="${GP_QUOTA_MAX_WAITS:-3}"
  case "$provider" in
    codex*) ;;
    *)
      printf 'suspend|unknown|0|quota probe unavailable for non-Codex compatibility provider\n'
      return 0
      ;;
  esac
  if ! usage_json="$(tribunal_quota_codexbar_json 2>/dev/null)" ||
     [ -z "$usage_json" ]; then
    printf 'suspend|unknown|0|CodexBar Codex JSON unavailable/unparseable\n'
    return 0
  fi
  if ! parsed="$(tribunal_quota_parse_json "$usage_json" 2>/dev/null)"; then
    printf 'suspend|unknown|0|CodexBar Codex JSON unavailable/unparseable\n'
    return 0
  fi
  IFS='|' read -r session_left session_reset weekly_left weekly_reset <<< "$parsed"
  if [ "${weekly_left:-}" = "0" ]; then
    printf 'suspend|weekly|%s|weekly quota exhausted; resets in %s\n' "$weekly_reset" "$(tribunal_quota_human_duration "$weekly_reset")"
    return 0
  fi
  if [ "${session_left:-}" = "-1" ] || [ "${session_reset:-}" = "-1" ]; then
    printf 'suspend|unknown|0|primary quota window unavailable; refusing to infer reset\n'
    return 0
  fi
  if [ "${session_left:-}" != "0" ]; then
    printf 'suspend|unknown|0|validated quota windows remain nonzero; refusing to infer exhausted tier\n'
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

tribunal_writer_exec_quiesced_once() (
  local exec_function="$1"
  shift
  local writer_pid rc cleanup_rc systemd_unit=""
  # Best-effort resource cleanup for ordinary descendants. This process group
  # is not a security boundary: a child can setsid() out of it. Canonical post
  # safety instead comes from the dedicated Codex sandbox + disposable
  # candidate transaction in tribunal.sh.
  set -m
  if [ "${TRIBUNAL_DEPLOYED_MODE:-0}" = "1" ]; then
    systemd_unit="$(tribunal_codex_systemd_unit_name writer)"
    (
      TRIBUNAL_CODEX_SYSTEMD_UNIT="$systemd_unit" \
        "$exec_function" "$@"
    ) &
  else
    (
      "$exec_function" "$@"
    ) &
  fi
  writer_pid=$!
  rc=0
  wait "$writer_pid" || rc=$?
  cleanup_rc=0
  if [ -z "$systemd_unit" ] &&
     kill -0 -- "-$writer_pid" 2>/dev/null; then
    # Reap ordinary orphaned descendants to avoid resource leaks. A setsid()
    # escape remains confined to the disposable candidate workspace.
    TRIBUNAL_WATCHDOG_KILL_GRACE_SEC="${TRIBUNAL_WRITER_KILL_GRACE_SEC:-0.2}" \
      tribunal_terminate_process_group "$writer_pid" || cleanup_rc=$?
  fi
  if [ "$cleanup_rc" -ne 0 ]; then
    echo "ERROR: failed to quiesce tribunal-writer process group $writer_pid" >&2
    return 70
  fi
  return "$rc"
)

tribunal_writer_exec() {
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  local mode provider resolved_model resolved_reasoning="" exec_function
  mode="$(tribunal_writer_mode)"
  case "$mode" in
    codex)
      provider="codex"
      resolved_model="$(tribunal_codex_agent_model "$agent_name")" || return 1
      resolved_reasoning="$(tribunal_codex_reasoning_effort)" || return 1
      exec_function="tribunal_writer_exec_raw"
      ;;
    grok)
      provider="grok"
      model_router_resolve writer || return 1
      [ "$MODEL_ROUTER_PROVIDER" = grok ] || return 1
      resolved_model="$MODEL_ROUTER_MODEL"
      resolved_reasoning="$MODEL_ROUTER_REASONING"
      exec_function="tribunal_writer_exec_raw"
      ;;
    cli)
      provider="$(tribunal_writer_provider 2>/dev/null || true)"
      [ -n "$provider" ] || return 127
      resolved_model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" ||
        return 1
      exec_function="tribunal_writer_exec_raw_legacy_cli"
      ;;
    none|subagent)
      tribunal_writer_exec_quiesced_once \
        tribunal_writer_exec_raw "$work_dir" "$agent_name" "$user_prompt"
      return $?
      ;;
    *)
      tribunal_writer_exec_quiesced_once \
        tribunal_writer_exec_raw "$work_dir" "$agent_name" "$user_prompt"
      return $?
      ;;
  esac

  local waits=0 out rc qrc
  while true; do
    out="$(mktemp)"
    rc=0
    if [ "$provider" = "codex" ]; then
      GP_CODEX_MODEL="$resolved_model" \
      TRIBUNAL_CODEX_REASONING="$resolved_reasoning" \
        tribunal_writer_exec_quiesced_once \
          "$exec_function" "$work_dir" "$agent_name" "$user_prompt" \
          >"$out" 2>&1 || rc=$?
    else
      tribunal_writer_exec_quiesced_once \
        "$exec_function" "$work_dir" "$agent_name" "$user_prompt" \
        >"$out" 2>&1 || rc=$?
    fi
    cat "$out"
    if [ "$rc" -eq 0 ]; then
      rm -f "$out"
      if ! tribunal_write_actual_provider \
        "$provider" "$agent_name" "$resolved_model" "$resolved_reasoning"; then
        echo "ERROR: failed to record tribunal-writer provider/model provenance" >&2
        return 70
      fi
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

# Terminate a process group whose id was captured by the parent from `$!`.
# TERM is intentionally followed by KILL against that same parent-held id, so a
# TERM-ignoring descendant cannot escape by outliving/reparenting away from the
# top shell. Never derive this id from child-writable state.
tribunal_terminate_process_group() {
  local pgid="$1"
  local grace="${TRIBUNAL_WATCHDOG_KILL_GRACE_SEC:-5}"
  local current_pgid
  case "$pgid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  current_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ' || true)"
  if [ -z "$current_pgid" ] || [ "$pgid" = "$current_pgid" ]; then
    return 1
  fi
  kill -TERM -- "-$pgid" 2>/dev/null || true
  sleep "$grace"
  kill -KILL -- "-$pgid" 2>/dev/null || true
  local _check
  for _check in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 -- "-$pgid" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

# Run Codex with both a wall-clock timeout and an idle watchdog. The wall-clock
# timeout can be large for GPT-5.5 judge runs, but a process that produces no
# output and no score-file progress for a while is treated as stalled.
#
# Args: work_dir agent_name prompt output_file progress_file
# Returns: child exit code, or 124 when killed by the idle watchdog/timeout.
tribunal_codex_exec_watchdog() (
  local work_dir="$1"
  local agent_name="$2"
  local user_prompt="$3"
  local output_file="$4"
  local progress_file="${5:-}"
  local idle_timeout="${TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC:-900}"
  local poll_interval="${TRIBUNAL_CODEX_IDLE_POLL_SEC:-30}"
  local pid rc now last_change latest_mtime out_mtime progress_mtime waits
  local force_provider provider resolved_model resolved_reasoning runtime_profile
  local qrc cleanup_rc systemd_unit
  waits=0
  force_provider="${TRIBUNAL_FORCE_PROVIDER:-}"
  # Job control puts each background judge in a process group led by `$!`.
  # That id remains parent-held even though the judge itself is untrusted.
  set -m

  : > "$output_file"
  while true; do
  : > "$output_file"
  provider="${force_provider:-$(tribunal_judge_provider "$agent_name" 2>/dev/null || true)}"
  [ -n "$provider" ] || {
    printf '[tribunal-watchdog] failed to resolve judge provider\n' >> "$output_file"
    return 70
  }
  resolved_reasoning=""
  runtime_profile="$(model_router_profile)" || {
    printf '[tribunal-watchdog] invalid runtime profile\n' >> "$output_file"
    return 70
  }
  if [ "$runtime_profile" = "vm-codex" ]; then
    model_router_resolve "$agent_name" || {
      printf '[tribunal-watchdog] failed to resolve VM model route\n' >> "$output_file"
      return 70
    }
    if [ "$provider" != "$MODEL_ROUTER_PROVIDER" ]; then
      printf '[tribunal-watchdog] provider route changed during resolution\n' >> "$output_file"
      return 70
    fi
    resolved_model="$MODEL_ROUTER_MODEL"
    resolved_reasoning="$MODEL_ROUTER_REASONING"
  else
    resolved_model="$(tribunal_model_id_for_provider "$provider" "$agent_name")" || {
      printf '[tribunal-watchdog] failed to resolve judge model\n' >> "$output_file"
      return 70
    }
    if [ "$provider" = "codex" ]; then
      resolved_reasoning="$(tribunal_codex_reasoning_effort)" || {
        printf '[tribunal-watchdog] failed to resolve Codex reasoning effort\n' >> "$output_file"
        return 70
      }
    fi
  fi
  systemd_unit=""
  if [ "$provider" = "codex" ] &&
     [ "${TRIBUNAL_DEPLOYED_MODE:-0}" = "1" ]; then
    systemd_unit="$(tribunal_codex_systemd_unit_name judge)"
  fi
  if [ "$provider" = "codex" ]; then
    if [ -n "$force_provider" ]; then
      GP_CODEX_MODEL="$resolved_model" \
      TRIBUNAL_CODEX_REASONING="$resolved_reasoning" \
      TRIBUNAL_FORCE_PROVIDER="$force_provider" \
      TRIBUNAL_CODEX_SYSTEMD_UNIT="$systemd_unit" \
        tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
    else
      GP_CODEX_MODEL="$resolved_model" \
      TRIBUNAL_CODEX_REASONING="$resolved_reasoning" \
      TRIBUNAL_CODEX_SYSTEMD_UNIT="$systemd_unit" \
        tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
    fi
  elif [ "$provider" = "grok" ]; then
    tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
  elif [ -n "$force_provider" ]; then
    TRIBUNAL_FORCE_PROVIDER="$force_provider" \
      tribunal_llm_exec "$work_dir" "$agent_name" "$user_prompt" > "$output_file" 2>&1 &
  else
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
      cleanup_rc=0
      if [ -n "$systemd_unit" ]; then
        tribunal_stop_systemd_invocation "$systemd_unit" \
          >> "$output_file" 2>&1 || cleanup_rc=$?
      elif kill -0 -- "-$pid" 2>/dev/null; then
        tribunal_terminate_process_group "$pid" || cleanup_rc=$?
      fi
      wait "$pid" 2>/dev/null || true
      if [ "$cleanup_rc" -ne 0 ]; then
        printf '[tribunal-watchdog] failed to quiesce judge process group %s\n' "$pid" >> "$output_file"
        return 70
      fi
      return 124
    fi
  done

  rc=0
  wait "$pid" || rc=$?
  cleanup_rc=0
  if [ -z "$systemd_unit" ] &&
     kill -0 -- "-$pid" 2>/dev/null; then
    tribunal_terminate_process_group "$pid" || cleanup_rc=$?
  fi
  if [ "$cleanup_rc" -ne 0 ]; then
    printf '[tribunal-watchdog] failed to quiesce judge process group %s\n' "$pid" >> "$output_file"
    return 70
  fi
  if [ "$rc" -eq 0 ]; then
    if ! tribunal_write_actual_provider \
      "$provider" "$agent_name" "$resolved_model" "$resolved_reasoning"; then
      printf '[tribunal-watchdog] failed to record provider/model provenance\n' >> "$output_file"
      return 70
    fi
    return 0
  fi
  # The explicit Claude fallback is compatibility-only. A stale local flag
  # must never override strict/deployed routing or an explicit provider.
  if [ "$provider" = "codex" ] &&
     [ "${TRIBUNAL_DEPLOYED_MODE:-0}" != "1" ] &&
     [ "${TRIBUNAL_STRICT_ROLE_PROVIDERS:-0}" != "1" ] &&
     [ -z "$force_provider" ] &&
     [ "${GP_JUDGE_ALLOW_CLAUDE:-0}" = "1" ] &&
     tribunal_claude_cmd >/dev/null 2>&1 &&
     tribunal_quota_error_file "$output_file"; then
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
)

# Provider-agnostic alias. The watchdog body now dispatches through
# tribunal_llm_exec (codex primary, claude CCC fallback), so prefer this name
# at call sites; the codex-specific name is kept for back-compat.
tribunal_llm_exec_watchdog() {
  tribunal_codex_exec_watchdog "$@"
}
