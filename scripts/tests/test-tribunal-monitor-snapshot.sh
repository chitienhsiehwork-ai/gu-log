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
  "$worker_root" \
  "$fake_home/.config/gu-log" \
  "$fake_bin"
printf 'worker fixture\n' > "$worker_root/.sentinel"

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
pass "zero observation wins over an older positive count without journal fallback"

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
grep -q 'Invalid .*tribunal.env' <<<"$bad_output" ||
  fail "invalid deploy env did not report an actionable error"
pass "deploy env source failure exits before using inherited state"

for skill in \
  "$ROOT/.agents/skills/tribunal-monitor/SKILL.md" \
  "$ROOT/.claude/skills/tribunal-monitor/SKILL.md"; do
  grep -q 'scripts/tribunal-monitor-snapshot.sh' "$skill" ||
    fail "$skill does not reference the shared snapshot entrypoint"
  procedure="$(
    sed -n '/^## Procedure$/,/^## Interpreting results$/p' "$skill"
  )"
  if grep -q 'journalctl' <<<"$procedure"; then
    fail "$skill still carries an inline journal parser"
  fi
done

if grep -Ev \
  '^(--user status tribunal-loop|--user show tribunal-loop -p Environment --value|--user is-enabled tribunal-loop|--user show tribunal-loop --property=MemoryPeak)$' \
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
