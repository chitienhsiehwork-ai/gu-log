#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SNAPSHOT="$ROOT/scripts/tribunal-monitor-snapshot.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "ok $*"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

runtime_root="$tmp_dir/runtime"
worker_root="$tmp_dir/gu-log-worker-a"
fake_home="$tmp_dir/home"
fake_bin="$tmp_dir/bin"
systemctl_calls="$tmp_dir/systemctl.calls"
journalctl_calls="$tmp_dir/journalctl.calls"
git_calls="$tmp_dir/git.calls"
mkdir -p \
  "$runtime_root/.score-loop/control" \
  "$runtime_root/.score-loop/logs" \
  "$runtime_root/.score-loop/state" \
  "$runtime_root/scripts" \
  "$worker_root" \
  "$fake_home/.config/gu-log" \
  "$fake_home/.config/systemd/user" \
  "$fake_bin"
printf 'worker fixture\n' > "$worker_root/.sentinel"
cp \
  "$ROOT/scripts/tribunal-pass-audit.service" \
  "$ROOT/scripts/tribunal-pass-audit.timer" \
  "$runtime_root/scripts/"
cp \
  "$ROOT/scripts/tribunal-pass-audit.service" \
  "$ROOT/scripts/tribunal-pass-audit.timer" \
  "$fake_home/.config/systemd/user/"

cat > "$fake_home/.config/gu-log/tribunal.env" <<EOF
GU_LOG_DIR=$runtime_root
QUOTA_FLOOR=10
GP_WRITER_MODE=none
TRIBUNAL_STRICT_ROLE_PROVIDERS=0
EOF

cat > "$fake_bin/systemctl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SYSTEMCTL_CALLS:?}"
case "$*" in
  "--user status tribunal-loop")
    echo "● tribunal-loop.service - fake"
    echo "     Active: inactive (dead)"
    ;;
  "--user show tribunal-loop -p Environment --value")
    echo "QUOTA_FLOOR=12 GP_WRITER_MODE=subagent TRIBUNAL_STRICT_ROLE_PROVIDERS=0"
    ;;
  "--user is-enabled tribunal-loop")
    echo "enabled"
    ;;
  "--user is-enabled tribunal-pass-audit.timer")
    echo "enabled"
    ;;
  "--user is-active tribunal-pass-audit.timer")
    echo "active"
    ;;
  "--user show tribunal-pass-audit.service -p FragmentPath --value")
    [ "${FAIL_AUDIT_UNIT_QUERY:-0}" != "1" ] || exit 1
    echo "${AUDIT_SERVICE_FRAGMENT_OVERRIDE:-${EXPECTED_USER_UNIT_DIR:?}/tribunal-pass-audit.service}"
    ;;
  "--user show tribunal-pass-audit.timer -p FragmentPath --value")
    [ "${FAIL_AUDIT_UNIT_QUERY:-0}" != "1" ] || exit 1
    echo "${AUDIT_TIMER_FRAGMENT_OVERRIDE:-${EXPECTED_USER_UNIT_DIR:?}/tribunal-pass-audit.timer}"
    ;;
  "--user show tribunal-pass-audit.service -p NeedDaemonReload --value")
    [ "${FAIL_AUDIT_UNIT_QUERY:-0}" != "1" ] || exit 1
    echo "${AUDIT_SERVICE_NEEDS_RELOAD_OVERRIDE:-no}"
    ;;
  "--user show tribunal-pass-audit.timer -p NeedDaemonReload --value")
    [ "${FAIL_AUDIT_UNIT_QUERY:-0}" != "1" ] || exit 1
    echo "${AUDIT_TIMER_NEEDS_RELOAD_OVERRIDE:-no}"
    ;;
  "--user show tribunal-pass-audit.timer -p NextElapseUSecRealtime --value")
    echo "Mon 2026-07-27 10:30:00 CST"
    ;;
  "--user show tribunal-pass-audit.timer -p LastTriggerUSec --value")
    if [ "${AUDIT_TIMER_NEVER_TRIGGERED:-0}" = "1" ]; then
      echo
    else
      echo "Sun 2026-07-26 10:30:00 CST"
    fi
    ;;
  "--user show tribunal-pass-audit.service -p Result --value")
    echo "${AUDIT_SERVICE_RESULT_OVERRIDE:-success}"
    ;;
  "--user show tribunal-pass-audit.service -p ExecMainStatus --value")
    if [ "${AUDIT_SERVICE_SCENARIO:-observed}" = "failed_before_completion" ]; then
      echo "${AUDIT_SERVICE_STATUS_OVERRIDE:-203}"
    else
      echo "${AUDIT_SERVICE_STATUS_OVERRIDE:-0}"
    fi
    ;;
  "--user show tribunal-pass-audit.service -p ActiveState --value")
    case "${AUDIT_SERVICE_SCENARIO:-observed}" in
      running) echo "activating" ;;
      failed_before_completion) echo "failed" ;;
      *) echo "inactive" ;;
    esac
    ;;
  "--user show tribunal-pass-audit.service -p SubState --value")
    case "${AUDIT_SERVICE_SCENARIO:-observed}" in
      running) echo "start" ;;
      failed_before_completion) echo "failed" ;;
      *) echo "dead" ;;
    esac
    ;;
  "--user show tribunal-pass-audit.service -p ExecMainStartTimestamp --value")
    case "${AUDIT_SERVICE_SCENARIO:-observed}" in
      never | failed_before_completion) echo ;;
      *) echo "Sun 2026-07-26 10:30:00 CST" ;;
    esac
    ;;
  "--user show tribunal-pass-audit.service -p ExecMainExitTimestamp --value")
    case "${AUDIT_SERVICE_SCENARIO:-observed}" in
      never | running | failed_before_completion) echo ;;
      *) echo "${AUDIT_SERVICE_EXIT_TIMESTAMP_OVERRIDE:-Sun 2026-07-26 10:31:00 CST}" ;;
    esac
    ;;
  "--user show tribunal-pass-audit.service -p DropInPaths --value" | \
    "--user show tribunal-pass-audit.timer -p DropInPaths --value")
    echo
    ;;
  "--user show tribunal-loop --property=MemoryPeak")
    echo "MemoryPeak=123456"
    ;;
  *)
    exit 1
    ;;
esac
FAKE
chmod +x "$fake_bin/systemctl"

cat > "$fake_bin/loginctl" <<'FAKE'
#!/usr/bin/env bash
if [ "$*" = "show-user fixture -p Linger --value" ]; then
  echo "yes"
  exit 0
fi
exit 1
FAKE
chmod +x "$fake_bin/loginctl"

cat > "$fake_bin/journalctl" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${JOURNALCTL_CALLS:?}"
echo "476 unscored articles remaining"
exit 0
FAKE
chmod +x "$fake_bin/journalctl"

cat > "$fake_bin/git" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${GIT_CALLS:?}"
if [ "$*" = "-C ${EXPECTED_SUPERVISOR:?} rev-parse --verify HEAD" ]; then
  [ "${FAIL_SUPERVISOR_GIT:-0}" != "1" ] || exit 99
  echo "0123456789abcdef0123456789abcdef01234567"
  exit 0
fi
if [ "$*" = "-C ${EXPECTED_WORKTREE:?} rev-parse --short HEAD" ]; then
  echo "abc1234"
  exit 0
fi
exit 99
FAKE
chmod +x "$fake_bin/git"

cat > "$runtime_root/.score-loop/state/runtime.json" <<'JSON'
{"state":"idle_wait","updatedAt":"2026-07-26T00:00:00Z"}
JSON
cat > "$runtime_root/.score-loop/state/quota-controller.json" <<'JSON'
{"mode":"weekly_debt","updatedAt":"2026-07-26T00:00:01Z"}
JSON
cat > "$runtime_root/.score-loop/state/writer-preflight.json" <<'JSON'
{"status":"passed","updatedAt":"2026-07-26T00:00:02Z"}
JSON
cat > "$runtime_root/.score-loop/state/runtime-git.json" <<'JSON'
{"state":"in_sync","updatedAt":"2026-07-26T00:00:03Z"}
JSON
cat > "$runtime_root/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "old.mdx": {
    "status": "FAILED",
    "failedStage": "vibe",
    "finishedAt": "2026-07-25T01:00:00Z"
  },
  "new.mdx": {
    "status": "PASS",
    "finishedAt": "2026-07-26T02:00:00Z"
  },
  "pending.mdx": {
    "status": "PENDING",
    "startedAt": "2026-07-26T03:00:00Z"
  }
}
JSON

run_snapshot() {
  HOME="$fake_home" \
    USER=fixture \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    JOURNALCTL_CALLS="$journalctl_calls" \
    GIT_CALLS="$git_calls" \
    FAIL_SUPERVISOR_GIT="${FAIL_SUPERVISOR_GIT:-0}" \
    EXPECTED_SUPERVISOR="$runtime_root" \
    EXPECTED_WORKTREE="$worker_root" \
    EXPECTED_USER_UNIT_DIR="$fake_home/.config/systemd/user" \
    FAIL_AUDIT_UNIT_QUERY="${FAIL_AUDIT_UNIT_QUERY:-0}" \
    AUDIT_SERVICE_FRAGMENT_OVERRIDE="${AUDIT_SERVICE_FRAGMENT_OVERRIDE:-}" \
    AUDIT_TIMER_FRAGMENT_OVERRIDE="${AUDIT_TIMER_FRAGMENT_OVERRIDE:-}" \
    AUDIT_SERVICE_NEEDS_RELOAD_OVERRIDE="${AUDIT_SERVICE_NEEDS_RELOAD_OVERRIDE:-}" \
    AUDIT_TIMER_NEEDS_RELOAD_OVERRIDE="${AUDIT_TIMER_NEEDS_RELOAD_OVERRIDE:-}" \
    AUDIT_TIMER_NEVER_TRIGGERED="${AUDIT_TIMER_NEVER_TRIGGERED:-0}" \
    AUDIT_SERVICE_SCENARIO="${AUDIT_SERVICE_SCENARIO:-observed}" \
    AUDIT_SERVICE_RESULT_OVERRIDE="${AUDIT_SERVICE_RESULT_OVERRIDE:-}" \
    AUDIT_SERVICE_STATUS_OVERRIDE="${AUDIT_SERVICE_STATUS_OVERRIDE:-}" \
    AUDIT_SERVICE_EXIT_TIMESTAMP_OVERRIDE="${AUDIT_SERVICE_EXIT_TIMESTAMP_OVERRIDE:-}" \
    PATH="$fake_bin:$PATH" \
    bash "$SNAPSHOT"
}

cat > "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-010000.log" <<'LOG'
[2026-07-26 01:00:00 +0000] [quota-loop] 12 unscored articles remaining. in-flight=0 workers=1
[2026-07-26 01:05:00 +0000] [quota-loop] No unscored articles and no workers in-flight. Sleeping 30min (interruptible).
LOG
touch -t 202607260105 \
  "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-010000.log"

before="$(
  find "$runtime_root" "$worker_root" "$fake_home" -type f -exec cksum {} + |
    sort
)"
output="$(run_snapshot)"
after="$(
  find "$runtime_root" "$worker_root" "$fake_home" -type f -exec cksum {} + |
    sort
)"

[ "$before" = "$after" ] || fail "snapshot mutated runtime files"
grep -q 'status=observed semantics=last_observed count=0 ' <<<"$output" ||
  fail "12 → No unscored did not resolve to zero"
grep -q '"article":"new.mdx","status":"PASS","failedStage":null' <<<"$output" ||
  fail "newest finished attempt missing"
grep -q '"article":"old.mdx","status":"FAILED","failedStage":"vibe"' <<<"$output" ||
  fail "failedStage missing from finished attempt"
grep -q '"article":"pending.mdx"' <<<"$output" &&
  fail "unfinished ledger entry leaked into finished attempts"
new_line="$(grep -n '"article":"new.mdx"' <<<"$output" | cut -d: -f1)"
old_line="$(grep -n '"article":"old.mdx"' <<<"$output" | cut -d: -f1)"
[ "$new_line" -lt "$old_line" ] || fail "finished attempts are not newest-first"
grep -q 'configured_floor=12%' <<<"$output" ||
  fail "effective unit environment did not override fallback"
grep -q 'head=0123456789abcdef0123456789abcdef01234567' <<<"$output" ||
  fail "read-only supervisor checkout HEAD observation missing"
grep -q 'gu-log-worker-a: abc1234' <<<"$output" ||
  fail "read-only worker HEAD observation missing"
grep -q '476 unscored' <<<"$output" &&
  fail "journal output leaked into the read-only state snapshot"
grep -q '^service_unit_file=current$' <<<"$output" ||
  fail "matching installed PASS audit service was not reported current"
grep -q '^timer_unit_file=current$' <<<"$output" ||
  fail "matching installed PASS audit timer was not reported current"
grep -q '^timer_enabled=enabled$' <<<"$output" ||
  fail "PASS audit timer enabled state missing"
grep -q '^timer_active=active$' <<<"$output" ||
  fail "PASS audit timer active state missing"
grep -q '^timer_next=Mon 2026-07-27 10:30:00 CST$' <<<"$output" ||
  fail "PASS audit timer next trigger missing"
grep -q '^timer_last_trigger=Sun 2026-07-26 10:30:00 CST$' <<<"$output" ||
  fail "PASS audit timer last trigger missing"
grep -q '^service_run_state=observed$' <<<"$output" ||
  fail "PASS audit service run state missing"
grep -q '^service_last_started_at=Sun 2026-07-26 10:30:00 CST$' <<<"$output" ||
  fail "PASS audit service last start timestamp missing"
grep -q '^service_last_finished_at=Sun 2026-07-26 10:31:00 CST$' <<<"$output" ||
  fail "PASS audit service last completion timestamp missing"
grep -q '^service_last_result=success$' <<<"$output" ||
  fail "PASS audit service result missing"
grep -q '^service_last_exit_status=0$' <<<"$output" ||
  fail "PASS audit service exit status missing"
grep -q '^service_drop_ins=none$' <<<"$output" ||
  fail "PASS audit service drop-in state missing"
grep -q '^timer_drop_ins=none$' <<<"$output" ||
  fail "PASS audit timer drop-in state missing"
pass "zero observation wins over an older positive count without journal fallback"

printf '\n# stale fixture\n' >> "$fake_home/.config/systemd/user/tribunal-pass-audit.service"
output="$(run_snapshot)"
grep -q '^service_unit_file=stale$' <<<"$output" ||
  fail "modified installed PASS audit service was not reported stale"
cp \
  "$runtime_root/scripts/tribunal-pass-audit.service" \
  "$fake_home/.config/systemd/user/tribunal-pass-audit.service"

rm "$fake_home/.config/systemd/user/tribunal-pass-audit.timer"
output="$(run_snapshot)"
grep -q '^timer_unit_file=missing$' <<<"$output" ||
  fail "missing installed PASS audit timer was not reported missing"
cp \
  "$runtime_root/scripts/tribunal-pass-audit.timer" \
  "$fake_home/.config/systemd/user/tribunal-pass-audit.timer"

output="$(
  AUDIT_SERVICE_FRAGMENT_OVERRIDE="$tmp_dir/wrong/tribunal-pass-audit.service" \
    run_snapshot
)"
grep -q '^service_unit_file=wrong_fragment$' <<<"$output" ||
  fail "wrong loaded PASS audit service fragment was not reported"

output="$(AUDIT_TIMER_NEEDS_RELOAD_OVERRIDE=yes run_snapshot)"
grep -q '^timer_unit_file=reload_needed$' <<<"$output" ||
  fail "PASS audit timer manager reload drift was not reported"

output="$(FAIL_AUDIT_UNIT_QUERY=1 run_snapshot)"
grep -q '^service_unit_file=manager_unknown$' <<<"$output" ||
  fail "failed PASS audit manager query did not degrade explicitly"
grep -q '^timer_unit_file=manager_unknown$' <<<"$output" ||
  fail "failed PASS audit timer manager query did not degrade explicitly"
pass "PASS audit disk and manager drift degrade explicitly without runtime mutation"

output="$(
  AUDIT_TIMER_NEVER_TRIGGERED=1 \
  AUDIT_SERVICE_SCENARIO=never \
    run_snapshot
)"
grep -q '^timer_last_trigger=never$' <<<"$output" ||
  fail "never-triggered PASS audit timer was not explicit"
grep -q '^service_run_state=never_run$' <<<"$output" ||
  fail "never-run PASS audit service was not explicit"
grep -q '^service_last_finished_at=never$' <<<"$output" ||
  fail "never-run PASS audit service invented a completion timestamp"
grep -q '^service_last_result=unavailable$' <<<"$output" ||
  fail "never-run PASS audit service invented a successful result"
grep -q '^service_last_exit_status=unavailable$' <<<"$output" ||
  fail "never-run PASS audit service invented a zero exit status"

output="$(AUDIT_SERVICE_SCENARIO=running run_snapshot)"
grep -q '^service_active_state=activating$' <<<"$output" ||
  fail "running PASS audit service active state missing"
grep -q '^service_run_state=running$' <<<"$output" ||
  fail "running PASS audit service was reported never-run"
grep -q '^service_last_started_at=Sun 2026-07-26 10:30:00 CST$' <<<"$output" ||
  fail "running PASS audit service start timestamp missing"
grep -q '^service_last_finished_at=pending$' <<<"$output" ||
  fail "running PASS audit service invented a completion timestamp"
grep -q '^service_last_result=unavailable$' <<<"$output" ||
  fail "running PASS audit service invented a completed result"

output="$(
  AUDIT_SERVICE_SCENARIO=failed_before_completion \
  AUDIT_SERVICE_RESULT_OVERRIDE=exit-code \
    run_snapshot
)"
grep -q '^service_active_state=failed$' <<<"$output" ||
  fail "pre-completion PASS audit failure active state missing"
grep -q '^service_run_state=failed_before_completion$' <<<"$output" ||
  fail "pre-completion PASS audit failure was reported never-run"
grep -q '^service_last_result=exit-code$' <<<"$output" ||
  fail "pre-completion PASS audit failure result was hidden"
grep -q '^service_last_exit_status=203$' <<<"$output" ||
  fail "pre-completion PASS audit failure exit status was hidden"

output="$(AUDIT_TIMER_NEVER_TRIGGERED=1 run_snapshot)"
grep -q '^timer_last_trigger=never$' <<<"$output" ||
  fail "first deploy did not expose the timer's legitimate never-triggered state"
grep -q '^service_run_state=observed$' <<<"$output" ||
  fail "first deploy hid the completed manual PASS audit smoke"
grep -q '^service_last_result=success$' <<<"$output" ||
  fail "first deploy hid the manual PASS audit smoke result"

output="$(
  AUDIT_SERVICE_RESULT_OVERRIDE=exit-code \
  AUDIT_SERVICE_STATUS_OVERRIDE=1 \
  AUDIT_SERVICE_EXIT_TIMESTAMP_OVERRIDE='Sat 2026-07-25 10:31:00 CST' \
    run_snapshot
)"
grep -q '^service_last_finished_at=Sat 2026-07-25 10:31:00 CST$' <<<"$output" ||
  fail "PASS audit service stale completion timestamp was hidden"
grep -q '^service_last_result=exit-code$' <<<"$output" ||
  fail "failed PASS audit service result was hidden"
grep -q '^service_last_exit_status=1$' <<<"$output" ||
  fail "failed PASS audit service exit status was hidden"
pass "PASS audit evidence distinguishes first deploy, running, never-run, observed, stale, and failed states"

output="$(FAIL_SUPERVISOR_GIT=1 run_snapshot)"
grep -q 'status=unavailable reason=git_head_unreadable' <<<"$output" ||
  fail "unreadable supervisor checkout HEAD did not degrade explicitly"
grep -q 'RUNTIME GIT OBSERVATION' <<<"$output" ||
  fail "unreadable supervisor checkout HEAD aborted later diagnostic sections"
pass "unreadable supervisor checkout HEAD degrades without aborting the snapshot"

cat > "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-020000.log" <<'LOG'
[2026-07-26 02:00:00 +0000] [quota-loop] No unscored articles and no workers in-flight. Sleeping 30min (interruptible).
[2026-07-26 02:04:00 +0000] [quota-loop] CONTROLLER: mode=normal cooldown=300 workers=1
[2026-07-26 02:05:00 +0000] [quota-loop] 7 unscored articles remaining. in-flight=0 workers=1
[2026-07-26 02:06:00 +0000] [publisher] No unscored articles and no workers in-flight.
LOG
touch -t 202607260205 \
  "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-020000.log"
output="$(run_snapshot)"
grep -q 'status=observed semantics=last_observed count=7 ' <<<"$output" ||
  fail "newer positive observation did not win over zero"
grep -q 'CONTROLLER: mode=normal cooldown=300 workers=1' <<<"$output" ||
  fail "controller decision missing from selected supervisor log"
grep -q 'count=0 ' <<<"$output" &&
  fail "publisher noise spoofed the quota-loop queue observation"
pass "latest observations win within the most recently updated supervisor log"

cat > "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-030000.log" <<'LOG'
[2026-07-26 03:00:00 +0000] [quota-loop] === Tribunal Quota-Aware Loop started ===
LOG
touch -t 202607260100 \
  "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-030000.log"
output="$(run_snapshot)"
grep -q 'status=observed semantics=last_observed count=7 .*source=.score-loop/logs/tribunal-quota-loop-20260726-020000.log' <<<"$output" ||
  fail "newer filename masked the more recently updated active supervisor log"
pass "log mtime wins over a newer filename from an older failed launch"

cat > "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-040000.log" <<'LOG'
[2026-07-26 04:00:00 +0000] [quota-loop] === Tribunal Quota-Aware Loop started ===
LOG
touch -t 202607260400 \
  "$runtime_root/.score-loop/logs/tribunal-quota-loop-20260726-040000.log"
output="$(run_snapshot)"
grep -q 'status=unavailable reason=no_observation source=.score-loop/logs/tribunal-quota-loop-20260726-040000.log' <<<"$output" ||
  fail "selected log without an observation fell back to a stale run"
grep -q 'count=7 ' <<<"$output" &&
  fail "queue count leaked from a stale supervisor run"
pass "selected log without a queue observation stays unavailable"

printf '{not-json\n' > "$runtime_root/.score-loop/state/tribunal-progress.json"
output="$(run_snapshot)"
grep -q '(unavailable: invalid runtime ledger)' <<<"$output" ||
  fail "invalid runtime ledger was not reported explicitly"
grep -q 'RUNTIME GIT OBSERVATION' <<<"$output" ||
  fail "invalid ledger aborted later diagnostic sections"
pass "invalid runtime ledger degrades one section without aborting snapshot"

printf '"valid JSON, wrong schema"\n' > "$runtime_root/.score-loop/state/tribunal-progress.json"
output="$(run_snapshot)"
grep -q '(unavailable: invalid runtime ledger schema)' <<<"$output" ||
  fail "valid scalar ledger was treated as an empty object ledger"

printf '[{"status":"PASS","finishedAt":"2026-07-26T00:00:00Z"}]\n' \
  > "$runtime_root/.score-loop/state/tribunal-progress.json"
output="$(run_snapshot)"
grep -q '(unavailable: invalid runtime ledger schema)' <<<"$output" ||
  fail "valid array ledger was allowed to invent numeric article keys"
pass "valid JSON with the wrong ledger schema fails closed"

jq -n '
  reduce range(0; 16) as $i ({};
    ($i | tostring) as $raw
    | (if $i < 10 then "0" + $raw else $raw end) as $second
    | .["entry-\($i).mdx"] = {
        status: "FAILED",
        failedStage: "fact",
        finishedAt: ("2026-07-26T00:00:" + $second + "Z")
      }
  )
' > "$runtime_root/.score-loop/state/tribunal-progress.json"
output="$(run_snapshot)"
[ "$(grep -c '^{"article":"entry-' <<<"$output")" -eq 15 ] ||
  fail "finished attempt output did not enforce the max-15 bound"
grep -q '"article":"entry-15.mdx","status":"FAILED","failedStage":"fact"' <<<"$output" ||
  fail "newest failed attempt or failedStage missing"
grep -q '"article":"entry-0.mdx"' <<<"$output" &&
  fail "oldest attempt leaked past the max-15 bound"
pass "finished attempts are newest-first and bounded to 15"

output="$(
  env -u USER \
    HOME="$fake_home" \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    JOURNALCTL_CALLS="$journalctl_calls" \
    GIT_CALLS="$git_calls" \
    EXPECTED_SUPERVISOR="$runtime_root" \
    EXPECTED_WORKTREE="$worker_root" \
    PATH="$fake_bin:$PATH" \
    bash "$SNAPSHOT"
)"
grep -q '^linger=' <<<"$output" ||
  fail "unset USER aborted the snapshot instead of degrading linger lookup"
pass "unset USER degrades safely"

bad_home="$tmp_dir/bad-home"
mkdir -p "$bad_home/.config/gu-log"
printf 'false\n' > "$bad_home/.config/gu-log/tribunal.env"
set +e
bad_output="$(
  HOME="$bad_home" \
    GU_LOG_DIR="$runtime_root" \
    PATH="$fake_bin:$PATH" \
    bash "$SNAPSHOT" 2>&1
)"
bad_rc=$?
set -e
[ "$bad_rc" -eq 78 ] ||
  fail "invalid deploy env continued with inherited GU_LOG_DIR (rc=$bad_rc)"
grep -Eq '(Invalid .*tribunal[.]env|Missing GU_LOG_DIR)' <<<"$bad_output" ||
  fail "invalid deploy env did not report an actionable error"
pass "deploy env source failure exits before using inherited state"

malicious_home="$tmp_dir/malicious-home"
malicious_sentinel="$tmp_dir/deploy-env-command-ran"
mkdir -p "$malicious_home/.config/gu-log"
cat > "$malicious_home/.config/gu-log/tribunal.env" <<EOF
GU_LOG_DIR="$runtime_root"
MALICIOUS=\$(touch '$malicious_sentinel')
lowercase_unknown=value
; systemd comment
opaque future syntax without equals
EOF
malicious_output="$(
  HOME="$malicious_home" \
    PATH="$fake_bin:$PATH" \
    bash "$SNAPSHOT" 2>&1
)"
[ ! -e "$malicious_sentinel" ] ||
  fail "monitor executed shell content from tribunal.env"
grep -q '^generated_at=' <<<"$malicious_output" ||
  fail "unknown deploy env syntax narrowed the systemd EnvironmentFile contract"

known_malicious_home="$tmp_dir/known-malicious-home"
known_malicious_sentinel="$tmp_dir/known-deploy-env-command-ran"
mkdir -p "$known_malicious_home/.config/gu-log"
cat > "$known_malicious_home/.config/gu-log/tribunal.env" <<EOF
GU_LOG_DIR=\$(touch '$known_malicious_sentinel')
EOF
set +e
known_malicious_output="$(
  HOME="$known_malicious_home" \
    PATH="$fake_bin:$PATH" \
    bash "$SNAPSHOT" 2>&1
)"
known_malicious_rc=$?
set -e
[ "$known_malicious_rc" -eq 78 ] ||
  fail "unsafe GU_LOG_DIR data did not fail closed (rc=$known_malicious_rc)"
[ ! -e "$known_malicious_sentinel" ] ||
  fail "monitor executed shell content from GU_LOG_DIR"
grep -Eq '(Invalid .*tribunal[.]env|Missing GU_LOG_DIR|Invalid GU_LOG_DIR)' \
  <<<"$known_malicious_output" ||
  fail "unsafe GU_LOG_DIR data did not report an actionable error"
pass "deploy env is parsed as data without executing shell content or narrowing unknown keys"

for skill in \
  "$ROOT/.agents/skills/tribunal-monitor/SKILL.md" \
  "$ROOT/.claude/skills/tribunal-monitor/SKILL.md"; do
  grep -q 'scripts/tribunal-monitor-snapshot.sh' "$skill" ||
    fail "$skill does not reference the shared snapshot entrypoint"
  if grep -Fq "with \`GU_LOG_DIR\` and \`USAGE_MONITOR\`" "$skill"; then
    fail "$skill still requires the retired off-repo quota monitor"
  fi
  procedure="$(
    sed -n '/^## Procedure$/,/^## Interpreting results$/p' "$skill"
  )"
  if grep -q 'journalctl' <<<"$procedure"; then
    fail "$skill still carries an inline journal parser"
  fi
done

if grep -Ev \
  '^(--user status tribunal-loop|--user show tribunal-loop -p Environment --value|--user is-enabled tribunal-loop|--user is-enabled tribunal-pass-audit.timer|--user is-active tribunal-pass-audit.timer|--user show tribunal-pass-audit.service -p FragmentPath --value|--user show tribunal-pass-audit.timer -p FragmentPath --value|--user show tribunal-pass-audit.service -p NeedDaemonReload --value|--user show tribunal-pass-audit.timer -p NeedDaemonReload --value|--user show tribunal-pass-audit.timer -p NextElapseUSecRealtime --value|--user show tribunal-pass-audit.timer -p LastTriggerUSec --value|--user show tribunal-pass-audit.service -p Result --value|--user show tribunal-pass-audit.service -p ExecMainStatus --value|--user show tribunal-pass-audit.service -p ActiveState --value|--user show tribunal-pass-audit.service -p SubState --value|--user show tribunal-pass-audit.service -p ExecMainStartTimestamp --value|--user show tribunal-pass-audit.service -p ExecMainExitTimestamp --value|--user show tribunal-pass-audit.service -p DropInPaths --value|--user show tribunal-pass-audit.timer -p DropInPaths --value|--user show tribunal-loop --property=MemoryPeak)$' \
  "$systemctl_calls"; then
  fail "snapshot issued an unexpected systemctl command"
fi
[ ! -s "$journalctl_calls" ] ||
  fail "snapshot consulted the journal despite state/log-only semantics"
if [ ! -s "$git_calls" ]; then
  fail "snapshot did not issue read-only git observations"
fi
while IFS= read -r git_call; do
  case "$git_call" in
    "-C $runtime_root rev-parse --verify HEAD" | \
      "-C $worker_root rev-parse --short HEAD") ;;
    *) fail "snapshot issued a git command beyond read-only HEAD observations: $git_call" ;;
  esac
done < "$git_calls"
pass "both skills use one non-mutating snapshot entrypoint"
