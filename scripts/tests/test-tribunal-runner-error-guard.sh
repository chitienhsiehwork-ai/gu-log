#!/usr/bin/env bash
# Regression test: a broken judge runner must stop Tribunal as infrastructure
# failure, not mark the article FAILED/EXHAUSTED.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fake_bin="$TMP/bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  echo "fake codex runner crashed before writing score" >&2
  exit 1
fi
echo "fake codex" >&2
exit 1
FAKE_CODEX
chmod +x "$fake_bin/codex"

progress="$TMP/progress.json"
printf '{}\n' > "$progress"

set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/tribunal.out" 2>"$TMP/tribunal.err"
rc=$?
set -e

if [ "$rc" -ne 70 ]; then
  sed -n '1,120p' "$TMP/tribunal.out" >&2 || true
  sed -n '1,120p' "$TMP/tribunal.err" >&2 || true
  fail "runner crash should exit 70, got $rc"
fi
pass "runner crash exits with temporary infrastructure failure"

article_status="$(jq -r '."gp-1-20260128-demo.mdx".status // empty' "$progress")"
stage_status="$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status // empty' "$progress")"
attempts="$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts // empty' "$progress")"

[ "$article_status" = "RUNNER_ERROR" ] || fail "article status should be RUNNER_ERROR, got '$article_status'"
[ "$stage_status" = "runner_error" ] || fail "stage status should be runner_error, got '$stage_status'"
[ "$attempts" = "0" ] || fail "runner error should not consume topLevelAttempts, got '$attempts'"
pass "runner error is recorded as retryable infrastructure state"

if jq -e '."gp-1-20260128-demo.mdx".status == "FAILED" or ."gp-1-20260128-demo.mdx".status == "EXHAUSTED"' "$progress" >/dev/null; then
  fail "runner crash polluted content status as FAILED/EXHAUSTED"
fi
pass "runner crash does not become content failure/exhaustion"

# The stage runner intentionally normalizes a watchdog kill to infrastructure
# rc=70. The supervisor must recover the original stall signal from that
# worker's isolated output and classify it as rc=124 before alerting/draining.
stall_bin="$TMP/stall-bin"
mkdir -p "$stall_bin"
cat > "$stall_bin/codex" <<'STALL_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" = "exec" ]; then
  exec sleep 30
fi
STALL_CODEX
chmod +x "$stall_bin/codex"
stall_progress="$TMP/stall-progress.json"
stall_log="$TMP/stall-worker.log"
printf '{}\n' > "$stall_progress"
set +e
PATH="$stall_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$stall_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=20 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=1 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$stall_log" 2>&1
stall_rc=$?
set -e
[ "$stall_rc" -eq 70 ] || fail "watchdog-normalized tribunal result should be rc=70, got $stall_rc"
grep -q '\[tribunal-watchdog\] idle .* no output/score-file progress' "$stall_log" ||
  fail "actual watchdog marker missing from worker output"
# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"
classified_rc="$(tribunal_classify_worker_result "$stall_rc" "$stall_log")"
[ "$classified_rc" = "124" ] ||
  fail "supervisor should classify watchdog-marked rc=70 as rc=124, got $classified_rc"
pass "actual watchdog stall propagates through supervisor classification as rc=124"

# A judge can produce valid score JSON and still fail the provenance contract.
# That infrastructure error must win over the valid content payload.
provenance_bin="$TMP/provenance-bin"
mkdir -p "$provenance_bin"
cat > "$provenance_bin/codex" <<'PROVENANCE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
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
  cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 8,
    "consistency": 8,
    "sourceBoundary": 8,
    "commentarySeparation": 8
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
  rm -f "$TRIBUNAL_ACTUAL_PROVIDER_FILE"
  mkdir "$TRIBUNAL_ACTUAL_PROVIDER_FILE"
  exit 0
fi
exit 1
PROVENANCE_CODEX
chmod +x "$provenance_bin/codex"

provenance_progress="$TMP/provenance-progress.json"
printf '{}\n' > "$provenance_progress"
set +e
PATH="$provenance_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$provenance_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/provenance.out" 2>"$TMP/provenance.err"
provenance_rc=$?
set -e

[ "$provenance_rc" -eq 70 ] || fail "provenance failure with valid score should exit 70, got $provenance_rc"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status' "$provenance_progress")" = "RUNNER_ERROR" ] || \
  fail "provenance failure should record RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".stages.factChecker.status' "$provenance_progress")" = "runner_error" ] || \
  fail "provenance failure should record stage runner_error"
pass "valid score cannot mask provenance runner failure"

if ! grep -q 'runner_error propagated' "$ROOT_DIR/scripts/tribunal-quota-loop.sh"; then
  fail "quota loop does not drain on tribunal runner_error"
fi
pass "quota loop drains instead of sweeping the queue after runner_error"

old_bin="$TMP/old-bin"
mkdir -p "$old_bin"
cat > "$old_bin/codex" <<'OLD_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "old codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.106.0"
  exit 0
fi
echo "old codex should not run a judge" >&2
exit 1
OLD_CODEX
chmod +x "$old_bin/codex"

old_progress="$TMP/old-progress.json"
printf '{}\n' > "$old_progress"
set +e
PATH="$old_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$old_progress" \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/old.out" 2>"$TMP/old.err"
old_rc=$?
set -e

[ "$old_rc" -eq 70 ] || fail "old Codex CLI should exit 70 before judging, got $old_rc"
[ "$(jq 'length' "$old_progress")" = "0" ] || fail "old Codex CLI should not initialize article progress"
grep -q 'older than required' "$TMP/old.err" || fail "old Codex rejection did not explain version requirement"
pass "old Codex CLI is rejected before article progress is touched"

interrupted_progress="$TMP/interrupted-progress.json"
cat > "$interrupted_progress" <<'JSON'
{
  "gp-1-20260128-demo.mdx": {
    "article": "gp-1-20260128-demo.mdx",
    "topLevelAttempts": 5,
    "tribunalVersion": 8,
    "stages": {
      "factChecker": {
        "status": "in_progress",
        "score": null,
        "model": "codex-gpt-5.5-medium",
        "attempts": 1,
        "tribunalVersion": 8
      }
    }
  }
}
JSON

set +e
PATH="$fake_bin:$PATH" \
TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$interrupted_progress" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
bash "$TRIBUNAL" --score-only --only-stage factChecker gp-1-20260128-demo.mdx \
  >"$TMP/interrupted.out" 2>"$TMP/interrupted.err"
interrupted_rc=$?
set -e

[ "$interrupted_rc" -eq 70 ] || fail "interrupted in-progress retry should surface runner error, got $interrupted_rc"
[ "$(jq -r '."gp-1-20260128-demo.mdx".status' "$interrupted_progress")" = "RUNNER_ERROR" ] || fail "interrupted retry should be RUNNER_ERROR"
[ "$(jq -r '."gp-1-20260128-demo.mdx".topLevelAttempts' "$interrupted_progress")" = "0" ] || fail "interrupted retry should reset non-terminal attempts"
if jq -e '."gp-1-20260128-demo.mdx".status == "EXHAUSTED"' "$interrupted_progress" >/dev/null; then
  fail "interrupted in-progress retry must not become EXHAUSTED"
fi
pass "interrupted in-progress runs do not consume attempts or exhaust articles"
