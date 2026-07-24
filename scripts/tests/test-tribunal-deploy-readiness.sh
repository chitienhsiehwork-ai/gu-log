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
# shellcheck source=scripts/tribunal-helpers.sh
source "$HELPERS"

# A deployed loop must fail its writer preflight before any article claim. The
# fixture deliberately runs only far enough to hit that boundary, so it also
# works with macOS's Bash 3 despite the production loop requiring Bash 4.
preflight_root="$TMP/preflight-root"
mkdir -p "$preflight_root/scripts"
cp "$ROOT_DIR/scripts/tribunal-quota-loop.sh" \
   "$ROOT_DIR/scripts/tribunal-helpers.sh" \
   "$ROOT_DIR/scripts/tribunal-run-control.sh" \
   "$preflight_root/scripts/"
set +e
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_STRICT_ROLE_PROVIDERS=0 \
GP_WRITER_MODE=none \
bash "$preflight_root/scripts/tribunal-quota-loop.sh" --workers 1 \
  >"$TMP/preflight.out" 2>&1
preflight_rc=$?
set -e
[ "$preflight_rc" -eq 78 ] ||
  fail "deployed loop without CLI writer should fail 78 before dispatch, got $preflight_rc"
if [ -d "$preflight_root/.score-loop/claims" ] &&
   find "$preflight_root/.score-loop/claims" -type f -print -quit | grep -q .; then
  fail "deployed preflight failure claimed an article"
fi
[ "$(jq -r '.status' "$preflight_root/.score-loop/state/writer-preflight.json")" = "failed" ] ||
  fail "deployed preflight failure was not persisted"
grep -q 'before dispatch' "$TMP/preflight.out" ||
  fail "deployed preflight did not explain that failure occurred before dispatch"
pass "deployed writer preflight fails closed before any article claim"

# Monitor values are the unit's effective Environment= values. tribunal.env is
# only a fallback, even when it contains conflicting values.
(
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  unit='GP_WRITER_MODE=cli QUOTA_FLOOR=23 TRIBUNAL_STRICT_ROLE_PROVIDERS=1'
  [ "$(tribunal_effective_runtime_value "$unit" GP_WRITER_MODE none)" = "cli" ]
  [ "$(tribunal_effective_runtime_value "$unit" QUOTA_FLOOR 10)" = "23" ]
  [ "$(tribunal_effective_runtime_value "$unit" TRIBUNAL_STRICT_ROLE_PROVIDERS 0)" = "1" ]
) || fail "effective unit environment did not override tribunal.env fallbacks"
pass "monitor helper reports effective unit writer/floor/strict-role values"

# Routine doctor reads the current service PID's successful startup state and
# must not spend another Claude call. The explicit live probe is the only path
# that invokes Claude, and it accepts exact OK only.
(
  doctor_home="$TMP/doctor-home"
  doctor_root="$TMP/doctor-root"
  doctor_bin="$TMP/doctor-bin"
  mkdir -p "$doctor_home" "$doctor_root/.score-loop/state" "$doctor_bin"
  printf 'fixture-token\n' > "$doctor_home/.cc-cron-token"
  cat > "$doctor_bin/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
case "$*" in
  *is-enabled*) printf 'enabled\n' ;;
  *'Environment --value'*) printf 'GP_WRITER_MODE=cli TRIBUNAL_STRICT_ROLE_PROVIDERS=0\n' ;;
  *'MainPID --value'*) printf '4242\n' ;;
  *) exit 1 ;;
esac
SYSTEMCTL
  cat > "$doctor_bin/loginctl" <<'LOGINCTL'
#!/usr/bin/env bash
printf 'yes\n'
LOGINCTL
  cat > "$doctor_bin/claude" <<'CLAUDE'
#!/usr/bin/env bash
: > "$FAKE_DOCTOR_CLAUDE_CALLED"
cat >/dev/null
printf 'OK\n'
CLAUDE
  chmod +x "$doctor_bin/systemctl" "$doctor_bin/loginctl" "$doctor_bin/claude"
  cat > "$doctor_root/.score-loop/state/writer-preflight.json" <<'STATE'
{"status":"passed","mode":"cli","detail":"OK","pid":4242,"updatedAt":"2026-07-24T00:00:00Z"}
STATE
  HOME="$doctor_home" GU_LOG_DIR="$doctor_root" PATH="$doctor_bin:$PATH" \
  FAKE_DOCTOR_CLAUDE_CALLED="$TMP/doctor-claude-called" \
    bash "$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh" --doctor \
      >"$TMP/doctor-state.out"
  grep -q 'writer_preflight=passed source=state pid=4242' "$TMP/doctor-state.out"
  [ ! -e "$TMP/doctor-claude-called" ]

  HOME="$doctor_home" GU_LOG_DIR="$doctor_root" PATH="$doctor_bin:$PATH" \
  FAKE_DOCTOR_CLAUDE_CALLED="$TMP/doctor-claude-called" \
  TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 \
    bash "$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh" --doctor --live-probe \
      >"$TMP/doctor-live.out"
  grep -q 'writer_preflight=passed source=live result=OK' "$TMP/doctor-live.out"
  [ -e "$TMP/doctor-claude-called" ]
) || fail "doctor cached/live writer preflight behavior is incorrect"
pass "doctor reuses current PID state; only explicit live probe invokes Claude"

# Watchdog cancellation uses a dedicated POSIX session. A descendant that
# ignores TERM must still die when the saved session receives KILL.
(
  session_root="$TMP/session-kill"
  mkdir -p "$session_root"
  session_pid_file="$session_root/session.pid"
  child_pid_file="$session_root/child.pid"
  TRIBUNAL_PROCESS_GROUP_FILE="$session_pid_file" \
  TERM_CHILD_PID_FILE="$child_pid_file" \
    tribunal_session_exec bash -c '
      trap "" TERM
      sh -c '"'"'trap "" TERM; echo "$$" > "$TERM_CHILD_PID_FILE"; while :; do sleep 1; done'"'"' &
      wait
    ' >"$session_root/outer.log" 2>&1 &
  outer_pid=$!
  for _ in $(seq 1 50); do
    [ -s "$session_pid_file" ] && [ -s "$child_pid_file" ] && break
    sleep 0.1
  done
  if [ ! -s "$session_pid_file" ] || [ ! -s "$child_pid_file" ]; then
    kill "$outer_pid" 2>/dev/null || true
    exit 1
  fi
  child_pid="$(cat "$child_pid_file")"
  TRIBUNAL_WATCHDOG_KILL_GRACE_SEC=0.2 \
    tribunal_terminate_session "$session_pid_file" "$outer_pid"
  wait "$outer_pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$child_pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$child_pid" 2>/dev/null; then
    exit 1
  fi
) || fail "TERM-ignoring model descendant survived watchdog session cleanup"
pass "watchdog kills a TERM-ignoring descendant from the saved process group"

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

# Strict Vibe routing must fail closed when Claude is missing even if Codex is
# otherwise available.
(
  strict_root="$TMP/strict"
  mkdir -p "$strict_root/bin"
  cat > "$strict_root/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then exit 0; fi
exit 0
FAKE_CODEX
  chmod +x "$strict_root/bin/codex"
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$HELPERS"
  PATH="$strict_root/bin:/usr/bin:/bin"
  if TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
    tribunal_judge_provider vibe-opus-scorer >/dev/null 2>&1; then
    exit 1
  fi
) || fail "strict Vibe routing silently accepted a runtime without Claude"
pass "strict Vibe routing fails closed when Claude is missing"

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

# A real tribunal fail→rewrite→pass cycle must reach the Claude CLI writer.
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
  [ -n "$score_path" ] || exit 2
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
cat > "$writer_bin/claude" <<'FAKE_WRITER'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_WRITER_CALLS"
cat >/dev/null
exit 0
FAKE_WRITER
chmod +x "$writer_bin/codex" "$writer_bin/claude"
writer_progress="$TMP/writer-progress.json"
printf '{}\n' > "$writer_progress"
PATH="$writer_bin:$PATH" \
FAKE_JUDGE_COUNT="$TMP/judge-count" \
FAKE_WRITER_CALLS="$TMP/writer-calls" \
GP_WRITER_MODE=cli \
TRIBUNAL_NO_COMMIT=1 \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$writer_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=10 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=10 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker --allow-rewrite \
  gp-1-20260128-demo.mdx >"$TMP/writer.out" 2>&1 ||
  fail "real fail→writer→pass tribunal fixture failed"
[ -s "$TMP/writer-calls" ] || fail "failing article never reached fake Claude writer"
grep -q -- '--model' "$TMP/writer-calls" ||
  fail "Claude writer call did not include its role model"
[ "$(cat "$TMP/judge-count")" = "2" ] ||
  fail "tribunal did not re-score after writer execution"
pass "failing article reaches Claude writer and is re-scored to PASS"
