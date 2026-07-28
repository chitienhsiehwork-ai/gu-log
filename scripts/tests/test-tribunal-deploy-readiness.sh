#!/usr/bin/env bash
# Behavioral deployment-readiness checks. All LLM calls are local fakes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-deploy-readiness.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export TRIBUNAL_SHARED_LOCK_DIR="$TMP/shared-locks"
export TRIBUNAL_ARTICLE_LOCK_DIR="$TMP/article-locks"
mkdir -p "$TRIBUNAL_SHARED_LOCK_DIR"
# shellcheck source=scripts/tribunal-helpers.sh
source "$HELPERS"

# A deployed loop must fail its Codex write canary before any article claim.
# The fake Codex exits successfully but deliberately omits the canary file.
preflight_root="$TMP/preflight-root"
mkdir -p "$preflight_root/scripts" "$preflight_root/.codex/agents" \
  "$preflight_root/bin" "$preflight_root/src/content/posts"
cp "$ROOT_DIR/scripts/tribunal-quota-loop.sh" \
   "$ROOT_DIR/scripts/tribunal-helpers.sh" \
   "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
   "$ROOT_DIR/scripts/tribunal-runtime.slice" \
   "$ROOT_DIR/scripts/tribunal-run-control.sh" \
   "$ROOT_DIR/scripts/tribunal-version.mjs" \
   "$preflight_root/scripts/"
printf 'model = "gpt-writer-fixture"\n' \
  > "$preflight_root/.codex/agents/tribunal-writer.toml"
for role in vibe-opus-scorer fact-checker librarian fresh-eyes; do
  printf 'model = "gpt-%s-fixture"\n' "$role" \
    > "$preflight_root/.codex/agents/$role.toml"
done
cat > "$preflight_root/bin/codex" <<'NO_CANARY_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then exit 0; fi
exit 0
NO_CANARY_CODEX
cat > "$preflight_root/bin/systemctl" <<'FAKE_SYSTEMCTL'
#!/usr/bin/env bash
case "$*" in
  "--user show tribunal-runtime.slice -p LoadState --value")
    printf '%s\n' "${FAKE_SYSTEMD_LOAD_STATE:-loaded}" ;;
  "--user show tribunal-runtime.slice -p ActiveState --value")
    printf '%s\n' "${FAKE_SYSTEMD_ACTIVE_STATE:-active}" ;;
  "--user show tribunal-runtime.slice -p MemoryMax --value")
    printf '%s\n' "${FAKE_SYSTEMD_MEMORY_MAX:-4294967296}" ;;
  "--user show tribunal-runtime.slice -p CPUQuotaPerSecUSec --value")
    printf '%s\n' "${FAKE_SYSTEMD_CPU_QUOTA:-2s}" ;;
  "--user show tribunal-runtime.slice -p TasksMax --value")
    printf '%s\n' "${FAKE_SYSTEMD_TASKS_MAX:-1024}" ;;
  "--user show tribunal-runtime.slice -p FragmentPath --value")
    printf '%s\n' "$FAKE_SYSTEMD_FRAGMENT_PATH" ;;
  "--user show tribunal-runtime.slice -p NeedDaemonReload --value")
    printf '%s\n' "${FAKE_SYSTEMD_NEED_RELOAD:-no}" ;;
  "--user show tribunal-runtime.slice -p DropInPaths --value")
    printf '%s\n' "${FAKE_SYSTEMD_DROP_INS:-}" ;;
  "--user show tribunal-loop.service -p Slice --value")
    printf '%s\n' "${FAKE_SYSTEMD_SUPERVISOR_SLICE:-tribunal-runtime.slice}" ;;
  *) exit 1 ;;
esac
FAKE_SYSTEMCTL
cat > "$preflight_root/bin/systemd-run" <<'FAKE_SYSTEMD_RUN'
#!/usr/bin/env bash
if [ -n "${FAKE_SYSTEMD_RUN_CAPTURE:-}" ]; then
  printf '%s\n' "$@" > "$FAKE_SYSTEMD_RUN_CAPTURE"
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--" ]; then
    shift
    break
  fi
  shift
done
[ "$#" -gt 0 ] || exit 64
exec "$@"
FAKE_SYSTEMD_RUN
chmod +x "$preflight_root/bin/codex" "$preflight_root/bin/systemctl" \
  "$preflight_root/bin/systemd-run"
cp "$ROOT_DIR/scripts/tribunal-runtime.slice" \
  "$preflight_root/tribunal-runtime.slice"
export FAKE_SYSTEMD_FRAGMENT_PATH="$preflight_root/tribunal-runtime.slice"
set +e
PATH="$preflight_root/bin:$PATH" \
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_STRICT_ROLE_PROVIDERS=0 \
GP_WRITER_MODE=codex \
bash "$preflight_root/scripts/tribunal-quota-loop.sh" --workers 1 \
  >"$TMP/non-strict-preflight.out" 2>&1
non_strict_preflight_rc=$?
set -e
[ "$non_strict_preflight_rc" -eq 78 ] ||
  fail "deployed loop without strict routing should exit 78, got $non_strict_preflight_rc"
grep -q 'TRIBUNAL_STRICT_ROLE_PROVIDERS=1 is required' \
  "$TMP/non-strict-preflight.out" ||
  fail "deployed non-strict rejection was not actionable"
pass "deployed runtime rejects strict-off routing before any article claim"

printf 'unknown journal fixture\n' \
  > "$preflight_root/src/content/posts/.tribunal-pair-journal-invalid"
set +e
PATH="$preflight_root/bin:$PATH" \
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
GP_WRITER_MODE=codex \
bash "$preflight_root/scripts/tribunal-quota-loop.sh" --workers 1 \
  >"$TMP/recovery-preflight.out" 2>&1
recovery_preflight_rc=$?
set -e
rm -f "$preflight_root/src/content/posts/.tribunal-pair-journal-invalid"
[ "$recovery_preflight_rc" -eq 78 ] ||
  fail "deployed loop with unknown recovery evidence should exit 78, got $recovery_preflight_rc"
grep -q 'deployed recovery failed before dispatch' \
  "$TMP/recovery-preflight.out" ||
  fail "deployed recovery failure was not actionable"
pass "deployed runtime fails closed on unknown crash journal before dispatch"

set +e
PATH="$preflight_root/bin:$PATH" \
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
GP_WRITER_MODE=codex \
FAKE_SYSTEMD_LOAD_STATE=not-found \
bash "$preflight_root/scripts/tribunal-quota-loop.sh" --workers 1 \
  >"$TMP/systemd-preflight.out" 2>&1
systemd_preflight_rc=$?
set -e
[ "$systemd_preflight_rc" -eq 78 ] ||
  fail "deployed loop without its resource slice should exit 78, got $systemd_preflight_rc"
grep -q 'systemd containment preflight failed before dispatch' \
  "$TMP/systemd-preflight.out" ||
  fail "deployed systemd containment failure was not actionable"
pass "deployed runtime rejects missing cgroup containment before dispatch"

assert_systemd_contract_rejects() {
  local variable="$1" value="$2" expected="$3"
  local output="$TMP/systemd-contract-${variable}.out"
  (
    export "$variable=$value"
    PATH="$preflight_root/bin:$PATH"
    if tribunal_validate_deployed_systemd_contract >"$output" 2>&1; then
      exit 0
    fi
    exit 1
  ) || {
    grep -q "$expected" "$output" ||
      fail "systemd contract drift $variable=$value lacked diagnostic: $expected"
    return 0
  }
  fail "systemd contract accepted drift: $variable=$value"
}

assert_systemd_contract_rejects \
  FAKE_SYSTEMD_MEMORY_MAX infinity 'effective limits are stale'
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_CPU_QUOTA infinity 'effective limits are stale'
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_TASKS_MAX infinity 'effective limits are stale'
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_DROP_INS /tmp/unreviewed.conf 'unreviewed systemd drift'
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_NEED_RELOAD yes 'unreviewed systemd drift'
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_SUPERVISOR_SLICE app.slice 'outside tribunal-runtime.slice'
printf 'stale slice fixture\n' > "$preflight_root/tribunal-runtime.slice"
assert_systemd_contract_rejects \
  FAKE_SYSTEMD_ACTIVE_STATE active 'fragment does not match the tracked unit'
cp "$ROOT_DIR/scripts/tribunal-runtime.slice" \
  "$preflight_root/tribunal-runtime.slice"
pass "deployed runtime rejects stale limits, drop-ins, reload drift, wrong membership, and fragment drift"

set +e
PATH="$preflight_root/bin:$PATH" \
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
GP_WRITER_MODE=codex \
TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 \
FAKE_SYSTEMD_RUN_CAPTURE="$TMP/preflight-systemd-run.argv" \
bash "$preflight_root/scripts/tribunal-quota-loop.sh" --workers 1 \
  >"$TMP/preflight.out" 2>&1
preflight_rc=$?
set -e
[ "$preflight_rc" -eq 78 ] ||
  fail "deployed loop with failed Codex write canary should exit 78 before dispatch, got $preflight_rc"
if [ -d "$preflight_root/.score-loop/claims" ] &&
   find "$preflight_root/.score-loop/claims" -mindepth 1 -print -quit | grep -q .; then
  fail "deployed preflight failure claimed an article"
fi
[ "$(jq -r '.status' "$preflight_root/.score-loop/state/writer-preflight.json")" = "failed" ] ||
  fail "deployed preflight failure was not persisted"
grep -q 'before dispatch' "$TMP/preflight.out" ||
  fail "deployed preflight did not explain that failure occurred before dispatch"
pass "deployed writer preflight fails closed before any article claim"

for expected_arg in \
  '--service-type=exec' \
  '--expand-environment=no' \
  '--slice=tribunal-runtime.slice' \
  '--property=KillMode=control-group' \
  '--property=SendSIGKILL=yes' \
  '--property=OOMPolicy=kill' \
  '--property=MemoryMax=2G' \
  '--property=CPUQuota=200%' \
  '--property=TasksMax=256'; do
  grep -Fxq -- "$expected_arg" "$TMP/preflight-systemd-run.argv" ||
    fail "deployed Codex transient service omitted: $expected_arg"
done
if grep -Fxq -- '--property=PartOf=tribunal-loop.service' \
  "$TMP/preflight-systemd-run.argv"; then
  fail "transient Codex service stop propagation would break article-boundary drain"
fi
grep -Eq '^--unit=gu-log-tribunal-codex-' \
  "$TMP/preflight-systemd-run.argv" ||
  fail "deployed Codex transient service did not use a parent-generated unit"
pass "deployed Codex canary uses bounded transient-service cgroup containment"

# A stale compatibility flag must not route a strict/deployed Codex quota
# failure through Claude. The normal Codex quota handler owns suspend/retry.
(
  strict_quota_root="$TMP/strict-quota"
  mkdir -p "$strict_quota_root"
  tribunal_judge_provider() { printf 'codex\n'; }
  tribunal_model_id_for_provider() { printf 'gpt-strict-fixture\n'; }
  tribunal_codex_reasoning_effort() { printf 'xhigh\n'; }
  tribunal_llm_exec() {
    printf 'You have 0 weighted tokens left\n'
    return 9
  }
  tribunal_claude_cmd() {
    : > "$strict_quota_root/claude-called"
    printf 'claude\n'
  }
  tribunal_quota_handle_file() {
    printf '%s\n' "$1" > "$strict_quota_root/quota-provider"
    return 89
  }
  set +e
  TRIBUNAL_DEPLOYED_MODE=1 \
  TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
  GP_JUDGE_ALLOW_CLAUDE=1 \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=0.1 \
    tribunal_llm_exec_watchdog "$strict_quota_root" fact-checker \
      "strict quota fixture" "$strict_quota_root/output"
  strict_quota_rc=$?
  set -e
  [ "$strict_quota_rc" -eq 75 ]
  [ ! -e "$strict_quota_root/claude-called" ]
  [ "$(cat "$strict_quota_root/quota-provider")" = "codex" ]
) || fail "strict/deployed quota handling honored stale Claude fallback state"
pass "strict/deployed Codex quota errors ignore stale Claude fallback flags"

# The deployed idle watchdog must stop the parent-generated transient service
# identity. It must not fall back to a reusable numeric PGID after the Codex
# process has crossed into its systemd cgroup.
(
  idle_root="$TMP/systemd-idle"
  mkdir -p "$idle_root/.codex/agents" "$idle_root/bin" "$idle_root/work"
  printf 'model = "gpt-idle-fixture"\n' \
    > "$idle_root/.codex/agents/fact-checker.toml"
  cat > "$idle_root/bin/codex" <<'CODEX'
#!/usr/bin/env bash
exit 0
CODEX
  cat > "$idle_root/bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SYSTEMCTL_CAPTURE"
worker_pid="$(sed -n '1p' "$WATCHDOG_WORKER_PID_FILE")"
kill -TERM "$worker_pid"
SYSTEMCTL
  chmod +x "$idle_root/bin/codex" "$idle_root/bin/systemctl"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  REPO_ROOT="$idle_root"
  tribunal_llm_exec() {
    printf '%s\n' "$BASHPID" > "$WATCHDOG_WORKER_PID_FILE"
    printf '%s\n' "${TRIBUNAL_CODEX_SYSTEMD_UNIT:-}" \
      > "$WATCHDOG_UNIT_FILE"
    while :; do sleep 1; done
  }
  tribunal_terminate_process_group() {
    : > "$PGID_POISON"
    return 1
  }
  set +e
  PATH="$idle_root/bin:$PATH" \
  TRIBUNAL_DEPLOYED_MODE=1 \
  TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=1 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=0.1 \
  WATCHDOG_WORKER_PID_FILE="$idle_root/worker.pid" \
  WATCHDOG_UNIT_FILE="$idle_root/unit" \
  SYSTEMCTL_CAPTURE="$idle_root/systemctl.argv" \
  PGID_POISON="$idle_root/pgid-poison" \
    tribunal_llm_exec_watchdog "$idle_root/work" fact-checker \
      "idle fixture" "$idle_root/output"
  idle_rc=$?
  set -e
  [ "$idle_rc" -eq 124 ]
  unit="$(sed -n '1p' "$idle_root/unit")"
  grep -qx -- '--user' "$idle_root/systemctl.argv"
  grep -qx -- 'stop' "$idle_root/systemctl.argv"
  grep -qx -- "$unit" "$idle_root/systemctl.argv"
  [ ! -e "$idle_root/pgid-poison" ]
) || fail "deployed idle watchdog did not stop its parent-held systemd unit"
pass "deployed idle watchdog cancels by systemd unit identity, never PGID"

# Monitor values are the unit's effective Environment= values. tribunal.env is
# only a fallback, even when it contains conflicting values.
(
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  unit='GP_WRITER_MODE=codex QUOTA_FLOOR=23 TRIBUNAL_STRICT_ROLE_PROVIDERS=1'
  [ "$(tribunal_effective_runtime_value "$unit" GP_WRITER_MODE none)" = "codex" ]
  [ "$(tribunal_effective_runtime_value "$unit" QUOTA_FLOOR 10)" = "23" ]
  [ "$(tribunal_effective_runtime_value "$unit" TRIBUNAL_STRICT_ROLE_PROVIDERS 0)" = "1" ]
) || fail "effective unit environment did not override tribunal.env fallbacks"
pass "monitor helper reports effective unit writer/floor/strict-role values"

# Routine doctor reads the current service PID's successful startup state and
# must not spend another Codex call. The explicit live probe is the only path
# that reruns the bounded write canary.
(
  doctor_home="$TMP/doctor-home"
  doctor_root="$TMP/doctor-root"
  doctor_bin="$TMP/doctor-bin"
  mkdir -p "$doctor_home" "$doctor_root/.score-loop/state" \
    "$doctor_root/.codex/agents" "$doctor_root/scripts" "$doctor_bin"
  cp "$ROOT_DIR/scripts/tribunal-runtime.slice" \
    "$doctor_root/scripts/tribunal-runtime.slice"
  cp "$ROOT_DIR/scripts/tribunal-runtime.slice" \
    "$doctor_root/installed-tribunal-runtime.slice"
  printf 'model = "gpt-writer-fixture"\n' \
    > "$doctor_root/.codex/agents/tribunal-writer.toml"
  for role in vibe-opus-scorer fact-checker librarian fresh-eyes; do
    printf 'model = "gpt-%s-fixture"\n' "$role" \
      > "$doctor_root/.codex/agents/$role.toml"
  done
  cat > "$doctor_bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
case "$*" in
  *is-enabled*) printf 'enabled\n' ;;
  *'Environment --value'*) printf 'GP_WRITER_MODE=codex TRIBUNAL_STRICT_ROLE_PROVIDERS=1\n' ;;
  *'MainPID --value'*) printf '4242\n' ;;
  *'tribunal-runtime.slice -p LoadState --value'*) printf 'loaded\n' ;;
  *'tribunal-runtime.slice -p ActiveState --value'*) printf 'active\n' ;;
  *'tribunal-runtime.slice -p MemoryMax --value'*) printf '4294967296\n' ;;
  *'tribunal-runtime.slice -p CPUQuotaPerSecUSec --value'*) printf '2s\n' ;;
  *'tribunal-runtime.slice -p TasksMax --value'*) printf '1024\n' ;;
  *'tribunal-runtime.slice -p FragmentPath --value'*) printf '%s\n' "$DOCTOR_SLICE_FRAGMENT" ;;
  *'tribunal-runtime.slice -p NeedDaemonReload --value'*) printf 'no\n' ;;
  *'tribunal-runtime.slice -p DropInPaths --value'*) printf '\n' ;;
  *'tribunal-loop.service -p Slice --value'*) printf 'tribunal-runtime.slice\n' ;;
  *) exit 1 ;;
esac
SYSTEMCTL
  cat > "$doctor_bin/loginctl" <<'LOGINCTL'
#!/usr/bin/env bash
printf 'yes\n'
LOGINCTL
  cat > "$doctor_bin/codex" <<'CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then exit 0; fi
: > "$FAKE_DOCTOR_CODEX_CALLED"
prompt="${!#}"
path="$(printf '%s\n' "$prompt" | sed -n 's/^Canary path: //p')"
token="$(printf '%s\n' "$prompt" | sed -n 's/^Canary token: //p')"
[ -n "$path" ] && [ -n "$token" ] || exit 2
printf '%s\n' "$token" > "$path"
printf 'OK\n'
CODEX
  chmod +x "$doctor_bin/systemctl" "$doctor_bin/loginctl" "$doctor_bin/codex"
  cat > "$doctor_root/.score-loop/state/writer-preflight.json" <<'STATE'
{"status":"passed","mode":"codex","detail":"OK","pid":4242,"updatedAt":"2026-07-24T00:00:00Z"}
STATE
  HOME="$doctor_home" GU_LOG_DIR="$doctor_root" PATH="$doctor_bin:$PATH" \
  DOCTOR_SLICE_FRAGMENT="$doctor_root/installed-tribunal-runtime.slice" \
  FAKE_DOCTOR_CODEX_CALLED="$TMP/doctor-codex-called" \
    bash "$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh" --doctor \
      >"$TMP/doctor-state.out"
  grep -q 'writer_preflight=passed source=state pid=4242' "$TMP/doctor-state.out"
  grep -q 'systemd_containment=passed slice=tribunal-runtime.slice' \
    "$TMP/doctor-state.out"
  [ ! -e "$TMP/doctor-codex-called" ]

  HOME="$doctor_home" GU_LOG_DIR="$doctor_root" PATH="$doctor_bin:$PATH" \
  DOCTOR_SLICE_FRAGMENT="$doctor_root/installed-tribunal-runtime.slice" \
  FAKE_DOCTOR_CODEX_CALLED="$TMP/doctor-codex-called" \
  TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 \
    bash "$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh" --doctor --live-probe \
      >"$TMP/doctor-live.out"
  grep -q 'writer_preflight=passed source=live result=OK' "$TMP/doctor-live.out"
  [ -e "$TMP/doctor-codex-called" ]
) || fail "doctor cached/live writer preflight behavior is incorrect"
pass "doctor reuses current PID state; only explicit live probe invokes the Codex write canary"

# Legacy compatibility judge and writer share tribunal_claude_exec. From an isolated workdir, both
# must grant exactly REPO_ROOT through --add-dir and use the same noninteractive
# narrow permission contract under root and non-root. --allowed-tools stays last,
# prompts stay on stdin, and invalid roots fail before Claude.
(
  access_root="$TMP/claude-repo-access"
  mkdir -p "$access_root/.claude/agents" "$access_root/work" "$access_root/bin"
  printf '%s\n' '---' 'model: claude-fact-fixture' '---' \
    > "$access_root/.claude/agents/fact-checker.md"
  printf '%s\n' '---' 'model: claude-writer-fixture' '---' \
    > "$access_root/.claude/agents/tribunal-writer.md"
  cat > "$access_root/bin/claude" <<'FAKE_CLAUDE'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$FAKE_CLAUDE_CAPTURE"
cat > "${FAKE_CLAUDE_CAPTURE}.stdin"
FAKE_CLAUDE
  chmod +x "$access_root/bin/claude"

  PATH="$access_root/bin:$PATH" REPO_ROOT="$access_root" \
  FAKE_CLAUDE_CAPTURE="$access_root/judge.args" \
  TRIBUNAL_CODEX_TIMEOUT_SEC=2 \
    tribunal_claude_exec "$access_root/work" fact-checker "judge access fixture"
  PATH="$access_root/bin:$PATH" REPO_ROOT="$access_root" \
  FAKE_CLAUDE_CAPTURE="$access_root/writer.args" \
  GP_WRITER_MODE=cli TRIBUNAL_CODEX_TIMEOUT_SEC=2 \
    tribunal_writer_exec "$access_root/work" tribunal-writer "writer access fixture"

  if sed -n '/^tribunal_claude_exec()/,/^}/p' "$HELPERS" | grep -q 'id -u'; then
    exit 1
  fi
  for capture in "$access_root/judge.args" "$access_root/writer.args"; do
    [ "$(grep -cx -- '--add-dir' "$capture")" = "1" ]
    awk -v repo="$access_root" '
      previous == "--add-dir" && $0 == repo { found = 1 }
      { previous = $0 }
      END { exit(found ? 0 : 1) }
    ' "$capture"
    [ "$(grep -cx -- '--permission-mode' "$capture")" = "1" ]
    awk '
      previous == "--permission-mode" && $0 == "acceptEdits" { found = 1 }
      { previous = $0 }
      END { exit(found ? 0 : 1) }
    ' "$capture"
    ! grep -qx -- 'auto' "$capture"
    ! grep -qx -- 'bypassPermissions' "$capture"
    [ "$(tail -2 "$capture" | head -1)" = "--allowed-tools" ]
    [ "$(tail -1 "$capture")" = "Read,Grep,Glob,Bash,Write,Edit,MultiEdit" ]
    grep -q '^## User task$' "${capture}.stdin"
  done
  grep -q 'judge access fixture' "$access_root/judge.args.stdin"
  grep -q 'writer access fixture' "$access_root/writer.args.stdin"

  rm -f "$access_root/judge.args"
  if PATH="$access_root/bin:$PATH" REPO_ROOT="$access_root/missing" \
    FAKE_CLAUDE_CAPTURE="$access_root/judge.args" \
    tribunal_claude_exec "$access_root/work" fact-checker "must not run" \
      >"$access_root/missing.out" 2>&1; then
    exit 1
  fi
  [ ! -e "$access_root/judge.args" ]
  grep -q 'REPO_ROOT is not a directory' "$access_root/missing.out"
) || fail "Claude judge/writer repo grant or noninteractive permission contract is unsafe"
pass "Claude judge and writer use exact repo access and narrow noninteractive permissions"

# Watchdog cancellation uses a parent-created process group. A descendant that
# ignores TERM must still die when the parent-held process group receives KILL.
(
  session_root="$TMP/session-kill"
  mkdir -p "$session_root"
  child_pid_file="$session_root/child.pid"
  export TERM_CHILD_PID_FILE="$child_pid_file"
  set -m
  (
    bash -c '
      trap "" TERM
      sh -c '"'"'trap "" TERM; echo "$$" > "$TERM_CHILD_PID_FILE"; while :; do sleep 1; done'"'"' &
      wait
    '
  ) >"$session_root/outer.log" 2>&1 &
  outer_pid=$!
  for _ in $(seq 1 50); do
    [ -s "$child_pid_file" ] && break
    sleep 0.1
  done
  if [ ! -s "$child_pid_file" ]; then
    kill "$outer_pid" 2>/dev/null || true
    exit 1
  fi
  child_pid="$(cat "$child_pid_file")"
  child_pgid="$(ps -o pgid= -p "$child_pid" 2>/dev/null | tr -d ' ')"
  if [ "$child_pgid" != "$outer_pid" ]; then
    kill "$outer_pid" 2>/dev/null || true
    exit 1
  fi
  TRIBUNAL_WATCHDOG_KILL_GRACE_SEC=0.2 \
    tribunal_terminate_process_group "$outer_pid"
  wait "$outer_pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$child_pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$child_pid" 2>/dev/null; then
    exit 1
  fi
) || fail "TERM-ignoring model descendant survived watchdog session cleanup"
pass "watchdog kills a TERM-ignoring descendant using its parent-held process group"

# Two near-simultaneous workers publish atomic completion markers only after
# closing their distinct logs. Collection waits the exact PID named by each
# marker, preserves the matching rc/log pair, appends both logs, and cleans up.
(
  completion_root="$TMP/worker-completions"
  mkdir -p "$completion_root"
  combined_log="$completion_root/combined.log"
  : > "$combined_log"
  (
    sleep 0.1
    printf 'marker-from-a\n' > "$completion_root/a.log"
    tribunal_write_worker_completion "$completion_root/a.done" a 2
    exit 2
  ) &
  pid_a=$!
  (
    sleep 0.1
    printf 'marker-from-b\n' > "$completion_root/b.log"
    tribunal_write_worker_completion "$completion_root/b.done" b 70
    exit 70
  ) &
  pid_b=$!

  results=""
  for _ in 1 2; do
    tribunal_wait_for_worker_completion "$completion_root" "$combined_log" 0.05
    claimed="$TRIBUNAL_WORKER_COMPLETION_MARKER"
    completed_id="$(sed -n 's/^worker_id=//p' "$claimed" | head -1)"
    case "$completed_id" in
      a)
        tribunal_collect_worker_completion \
          "$claimed" a "$pid_a" "$completion_root/a.log" "$combined_log"
        ;;
      b)
        tribunal_collect_worker_completion \
          "$claimed" b "$pid_b" "$completion_root/b.log" "$combined_log"
        ;;
      *) exit 1 ;;
    esac
    results="${results}${TRIBUNAL_COMPLETED_WORKER_ID}:${TRIBUNAL_COMPLETED_WORKER_RC}\n"
  done
  printf '%b' "$results" | grep -qx 'a:2'
  printf '%b' "$results" | grep -qx 'b:70'
  [ "$(grep -c '^marker-from-a$' "$combined_log")" = "1" ]
  [ "$(grep -c '^marker-from-b$' "$combined_log")" = "1" ]
  if find "$completion_root" -type f \
    \( -name '*.done' -o -name '*.claimed.*' -o -name 'a.log' -o -name 'b.log' \) \
    -print -quit | grep -q .; then
    exit 1
  fi
) || fail "near-simultaneous workers were misattributed or left artifacts"
pass "worker ID, exact exit code, flushed log, and cleanup stay paired"

# A SIGKILL/OOM-style worker cannot publish its completion marker. The polling
# helper must notice the exact tracked PID is dead, reap rc=137, flush its log,
# classify infrastructure failure, and clean artifacts before the outer timeout.
(
  crash_root="$TMP/worker-crash-no-marker"
  mkdir -p "$crash_root"
  set +e
  TEST_HELPERS="$HELPERS" TEST_CRASH_ROOT="$crash_root" \
    timeout 3 bash -c '
      set -euo pipefail
      source "$TEST_HELPERS"
      combined="$TEST_CRASH_ROOT/combined.log"
      : > "$combined"
      (
        printf "crash-before-marker\n" > "$TEST_CRASH_ROOT/crash.log"
        exit 137
      ) &
      worker_pid=$!
      tribunal_write_worker_tracking \
        "$TEST_CRASH_ROOT/crash.tracking" crash "$worker_pid" "$TEST_CRASH_ROOT/crash.log"
      tribunal_wait_for_worker_completion "$TEST_CRASH_ROOT" "$combined" 0.05
      [ "$TRIBUNAL_WORKER_COMPLETION_KIND" = "missing_marker" ]
      [ "$TRIBUNAL_COMPLETED_WORKER_ID" = "crash" ]
      [ "$TRIBUNAL_COMPLETED_WORKER_PID" = "$worker_pid" ]
      [ "$TRIBUNAL_COMPLETED_WORKER_RAW_RC" = "137" ]
      [ "$TRIBUNAL_COMPLETED_WORKER_RC" = "70" ]
      grep -qx "crash-before-marker" "$combined"
      if find "$TEST_CRASH_ROOT" -type f \
        \( -name "*.tracking" -o -name "crash.log" -o -name "*.done" -o -name "*.claimed.*" \) \
        -print -quit | grep -q .; then
        exit 1
      fi
    '
  crash_test_rc=$?
  set -e
  [ "$crash_test_rc" -ne 124 ] || exit 1
  [ "$crash_test_rc" -eq 0 ]
) || fail "dead worker without marker hung or leaked/misattributed artifacts"
pass "exit-137 worker without marker returns prompt deterministic infrastructure failure"

# Strict Vibe routing must use its Codex role model without requiring Claude.
(
  strict_root="$TMP/strict"
  mkdir -p "$strict_root/bin" "$strict_root/.codex/agents"
  printf 'model = "gpt-vibe-fixture"\n' \
    > "$strict_root/.codex/agents/vibe-opus-scorer.toml"
  cat > "$strict_root/bin/codex" <<'FAKE_CODEX'
#!/bin/sh
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then exit 0; fi
exit 0
FAKE_CODEX
  chmod +x "$strict_root/bin/codex"
  ln -s "$(command -v python3)" "$strict_root/bin/python3"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  [ "$(PATH="$strict_root/bin" tribunal_codex_cmd)" = "codex" ] || exit 1
  if PATH="$strict_root/bin" tribunal_claude_cmd >/dev/null 2>&1; then
    exit 1
  fi
  REPO_ROOT="$strict_root"
  [ "$(PATH="$strict_root/bin" TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
    tribunal_judge_provider vibe-opus-scorer)" = "codex" ]
  [ "$(PATH="$strict_root/bin" TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
    tribunal_llm_model_id vibe-opus-scorer)" = "gpt-vibe-fixture" ]
) || fail "strict Vibe routing did not use Codex without Claude"
pass "strict Vibe routing uses its Codex TOML model without Claude"

# Judge and writer execution must bind one immutable model descriptor. Mutating
# the role TOML after dispatch must not change either the model passed to the
# executor or the provider/model/runner provenance recorded for that run.
(
  descriptor_root="$TMP/immutable-descriptor"
  mkdir -p "$descriptor_root/.codex/agents" "$descriptor_root/bin" \
    "$descriptor_root/work"
  printf 'model = "gpt-writer-original"\n' \
    > "$descriptor_root/.codex/agents/tribunal-writer.toml"
  printf 'model = "gpt-judge-original"\n' \
    > "$descriptor_root/.codex/agents/fact-checker.toml"
  cat > "$descriptor_root/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
exit 0
FAKE_CODEX
  chmod +x "$descriptor_root/bin/codex"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  REPO_ROOT="$descriptor_root"

  tribunal_writer_exec_raw() {
    printf '%s\n' "${GP_CODEX_MODEL:-}" > "$descriptor_root/writer-model"
    printf 'model = "gpt-writer-mutated"\n' \
      > "$descriptor_root/.codex/agents/tribunal-writer.toml"
    return 0
  }
  PATH="$descriptor_root/bin:$PATH" \
  GP_WRITER_MODE=codex \
  TRIBUNAL_CODEX_REASONING=xhigh \
  TRIBUNAL_ACTUAL_PROVIDER_FILE="$descriptor_root/writer-provenance" \
    tribunal_writer_exec "$descriptor_root/work" tribunal-writer \
      "fixture writer prompt"
  grep -qx 'gpt-writer-original' "$descriptor_root/writer-model"
  grep -qx 'provider=codex' "$descriptor_root/writer-provenance"
  grep -qx 'model_id=gpt-writer-original' \
    "$descriptor_root/writer-provenance"
  grep -qx 'runner_label=codex-gpt-writer-original-xhigh' \
    "$descriptor_root/writer-provenance"

  tribunal_llm_exec() {
    printf '%s\n' "${GP_CODEX_MODEL:-}" > "$descriptor_root/judge-model"
    printf 'model = "gpt-judge-mutated"\n' \
      > "$descriptor_root/.codex/agents/fact-checker.toml"
    return 0
  }
  PATH="$descriptor_root/bin:$PATH" \
  TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
  TRIBUNAL_CODEX_REASONING=xhigh \
  TRIBUNAL_ACTUAL_PROVIDER_FILE="$descriptor_root/judge-provenance" \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=0.1 \
    tribunal_llm_exec_watchdog "$descriptor_root/work" fact-checker \
      "fixture judge prompt" "$descriptor_root/judge-output"
  grep -qx 'gpt-judge-original' "$descriptor_root/judge-model"
  grep -qx 'provider=codex' "$descriptor_root/judge-provenance"
  grep -qx 'model_id=gpt-judge-original' \
    "$descriptor_root/judge-provenance"
  grep -qx 'runner_label=codex-gpt-judge-original-xhigh' \
    "$descriptor_root/judge-provenance"
) || fail "judge/writer execution descriptor drifted after role TOML mutation"
pass "judge/writer model and provenance share one immutable execution descriptor"

# In CCC-compatible mode, Codex absence must execute the Claude judge and stamp
# provider/model/runner provenance from the Claude role contract.
(
  fallback_root="$TMP/fallback"
  mkdir -p "$fallback_root/.claude/agents" "$fallback_root/bin" "$fallback_root/work"
  printf '%s\n' '---' 'model: claude-fact-fixture' '---' \
    > "$fallback_root/.claude/agents/fact-checker.md"
  cat > "$fallback_root/bin/codex" <<'NO_CODEX'
#!/usr/bin/env bash
exit 1
NO_CODEX
  cat > "$fallback_root/bin/claude" <<'FAKE_CLAUDE'
#!/usr/bin/env bash
cat >/dev/null
printf 'fixture judge complete\n'
FAKE_CLAUDE
  chmod +x "$fallback_root/bin/codex" "$fallback_root/bin/claude"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  REPO_ROOT="$fallback_root"
  provenance="$fallback_root/provenance"
  PATH="$fallback_root/bin:$PATH" \
  TRIBUNAL_ACTUAL_PROVIDER_FILE="$provenance" \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
    tribunal_llm_exec_watchdog "$fallback_root/work" fact-checker \
      "fixture prompt" "$fallback_root/output"
  grep -qx 'provider=claude' "$provenance"
  grep -qx 'model_id=claude-fact-fixture' "$provenance"
  grep -qx 'runner_label=claude-fact-fixture' "$provenance"
) || fail "CCC Claude fallback did not execute with honest provenance"
pass "CCC fallback executes Claude and records provider/model/runner provenance"

# Exercise every alert transition against a fake notifier. EXHAUSTED alerts
# once per consecutive streak at the configured threshold and resets after any
# non-EXHAUSTED completion; controller alerts are edge-triggered.
(
  alert_root="$TMP/alerts"
  mkdir -p "$alert_root"
  cat > "$alert_root/notifier" <<'NOTIFIER'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "$TRIBUNAL_ALERT_CAPTURE"
NOTIFIER
  chmod +x "$alert_root/notifier"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  export TRIBUNAL_ALERT_CAPTURE="$alert_root/messages"
  export TRIBUNAL_NOTIFIER="$alert_root/notifier"
  TRIBUNAL_EXHAUSTED_ALERT_THRESHOLD=3
  TRIBUNAL_EXHAUSTED_STREAK=0
  tribunal_alert_worker_completion 2 article-a
  tribunal_alert_worker_completion 2 article-b
  [ ! -e "$TRIBUNAL_ALERT_CAPTURE" ]
  tribunal_alert_worker_completion 2 article-c
  tribunal_alert_worker_completion 2 article-d
  [ "$(wc -l < "$TRIBUNAL_ALERT_CAPTURE" | tr -d ' ')" = "1" ]
  tribunal_alert_worker_completion 0 article-pass
  tribunal_alert_worker_completion 2 article-e
  tribunal_alert_worker_completion 2 article-f
  tribunal_alert_worker_completion 2 article-g
  tribunal_alert_worker_completion 124 article-stall

  TRIBUNAL_LAST_ALERTED_CONTROLLER_MODE=""
  tribunal_alert_controller_mode_transition fallback 23
  tribunal_alert_controller_mode_transition fallback 23
  tribunal_alert_controller_mode_transition pacing 23
  tribunal_alert_controller_mode_transition fallback 23
  tribunal_alert_controller_mode_transition floor_stop 23
  tribunal_alert_controller_mode_transition floor_stop 23
  tribunal_alert_controller_mode_transition pacing 23
  tribunal_alert_controller_mode_transition floor_stop 23

  [ "$(wc -l < "$TRIBUNAL_ALERT_CAPTURE" | tr -d ' ')" = "7" ]
  [ "$(grep -c 'EXHAUSTED spike: 3 consecutive' "$TRIBUNAL_ALERT_CAPTURE")" = "2" ]
  [ "$(grep -c 'worker stalled: article=article-stall rc=124' "$TRIBUNAL_ALERT_CAPTURE")" = "1" ]
  [ "$(grep -c 'entered fallback mode' "$TRIBUNAL_ALERT_CAPTURE")" = "2" ]
  [ "$(grep -c 'entered floor_stop at configured floor 23%' "$TRIBUNAL_ALERT_CAPTURE")" = "2" ]
) || fail "alert dedupe/count/transition behavior is incorrect"
pass "stall/EXHAUSTED/fallback/floor alerts execute with correct dedupe and counts"

# A real tribunal fail→rewrite→pass cycle must reach the isolated Codex writer.
# The fake writer is a no-op; the existing valid fixture post passes cheap
# validation, then the second fake judge result passes.
writer_bin="$TMP/writer-bin"
mkdir -p "$writer_bin"
cat > "$writer_bin/codex" <<'FAKE_JUDGE'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  prompt="${!#}"
  score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
  if [ -z "$score_path" ]; then
    argv=" $* "
    case "$argv" in
      *" --sandbox workspace-write "*) ;;
      *) exit 72 ;;
    esac
    printf '%s\n' "$*" >> "$FAKE_WRITER_CALLS"
    exit 0
  fi
  count=0
  [ ! -r "$FAKE_JUDGE_COUNT" ] || count="$(cat "$FAKE_JUDGE_COUNT")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$FAKE_JUDGE_COUNT"
  if [ "$count" -eq 1 ]; then
    accuracy=4
    verdict=FAIL
  else
    accuracy=9
    verdict=PASS
  fi
  cat > "$score_path" <<JSON
{"judge":"factCheck","dimensions":{"accuracy":$accuracy,"fidelity":9,"consistency":9,"sourceBoundary":9,"commentarySeparation":9},"score":9,"verdict":"$verdict","reasons":{"accuracy":"fixture"}}
JSON
  exit 0
fi
exit 1
FAKE_JUDGE
chmod +x "$writer_bin/codex"
writer_progress="$TMP/writer-progress.json"
printf '{}\n' > "$writer_progress"
fixture_lock_dir="$ROOT_DIR/.score-loop/locks"
mkdir -p "$fixture_lock_dir"
chmod 700 "$fixture_lock_dir"
exec 198>>"$fixture_lock_dir/tracked-gp-1-20260128-demo.lock"
flock -x 198
PATH="$writer_bin:$PATH" \
FAKE_JUDGE_COUNT="$TMP/judge-count" \
FAKE_WRITER_CALLS="$TMP/writer-calls" \
GP_WRITER_MODE=codex \
TRIBUNAL_NO_COMMIT=1 \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$writer_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=10 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=10 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker --allow-rewrite \
  gp-1-20260128-demo.mdx >"$TMP/writer.out" 2>&1 ||
  fail "real fail→writer→pass tribunal fixture failed"
flock -u 198
[ -e "$TRIBUNAL_ARTICLE_LOCK_DIR/tribunal-gp-1-20260128-demo.mdx.lock" ] ||
  fail "tribunal did not honor the isolated article lock directory"
[ -s "$TMP/writer-calls" ] || fail "failing article never reached fake Codex writer"
grep -q -- '--sandbox workspace-write' "$TMP/writer-calls" ||
  fail "Codex writer call did not use its isolated workspace sandbox"
[ "$(cat "$TMP/judge-count")" = "2" ] ||
  fail "tribunal did not re-score after writer execution"
pass "failing article reaches isolated Codex writer and is re-scored to PASS"
