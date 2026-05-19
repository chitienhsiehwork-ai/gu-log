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
bash "$TRIBUNAL" --score-only --only-stage factChecker sp-1-20260128-demo.mdx \
  >"$TMP/tribunal.out" 2>"$TMP/tribunal.err"
rc=$?
set -e

if [ "$rc" -ne 70 ]; then
  sed -n '1,120p' "$TMP/tribunal.out" >&2 || true
  sed -n '1,120p' "$TMP/tribunal.err" >&2 || true
  fail "runner crash should exit 70, got $rc"
fi
pass "runner crash exits with temporary infrastructure failure"

article_status="$(jq -r '."sp-1-20260128-demo.mdx".status // empty' "$progress")"
stage_status="$(jq -r '."sp-1-20260128-demo.mdx".stages.factChecker.status // empty' "$progress")"
attempts="$(jq -r '."sp-1-20260128-demo.mdx".topLevelAttempts // empty' "$progress")"

[ "$article_status" = "RUNNER_ERROR" ] || fail "article status should be RUNNER_ERROR, got '$article_status'"
[ "$stage_status" = "runner_error" ] || fail "stage status should be runner_error, got '$stage_status'"
[ "$attempts" = "0" ] || fail "runner error should not consume topLevelAttempts, got '$attempts'"
pass "runner error is recorded as retryable infrastructure state"

if jq -e '."sp-1-20260128-demo.mdx".status == "FAILED" or ."sp-1-20260128-demo.mdx".status == "EXHAUSTED"' "$progress" >/dev/null; then
  fail "runner crash polluted content status as FAILED/EXHAUSTED"
fi
pass "runner crash does not become content failure/exhaustion"

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
bash "$TRIBUNAL" --score-only --only-stage factChecker sp-1-20260128-demo.mdx \
  >"$TMP/old.out" 2>"$TMP/old.err"
old_rc=$?
set -e

[ "$old_rc" -eq 70 ] || fail "old Codex CLI should exit 70 before judging, got $old_rc"
[ "$(jq 'length' "$old_progress")" = "0" ] || fail "old Codex CLI should not initialize article progress"
grep -q 'older than required' "$TMP/old.err" || fail "old Codex rejection did not explain version requirement"
pass "old Codex CLI is rejected before article progress is touched"
