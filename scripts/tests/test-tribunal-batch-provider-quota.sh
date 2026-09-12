#!/usr/bin/env bash
# Focused/no-token regression tests for the batch runner's provider-aware quota gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_ROOT="$ROOT_DIR"
BATCH_RUNNER="$ROOT_DIR/scripts/tribunal-batch-runner.sh"
QUOTA_LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"

# shellcheck source=scripts/tribunal-helpers.sh
source "$HELPERS"

# Load only the quota section; sourcing the full batch runner would execute its
# main program. The section is deliberately bounded by stable headings.
quota_section=$(awk '
  /^# ─── Quota Check/ { capture=1 }
  capture && /^# ─── Build Unscored/ { exit }
  capture { print }
' "$BATCH_RUNNER")
eval "$quota_section"

# Load the selector without executing the batch runner's main program.
selector_section=$(awk '
  /^# ─── Build Unscored/ { capture=1 }
  capture && /^# ─── Main/ { exit }
  capture { print }
' "$BATCH_RUNNER")
eval "$selector_section"

# Load the continuous scheduler selector under a distinct name so both
# canonical dispatch paths must agree on revision-bound NEEDS_REVIEW.
quota_selector_section=$(awk '
  /^# ─── Build Unscored/ { capture=1 }
  capture && /^# ─── Dry Run/ { exit }
  capture { print }
' "$QUOTA_LOOP" | sed 's/get_unscored_articles()/get_quota_unscored_articles()/')
eval "$quota_selector_section"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
fake_monitor="$tmp_dir/usage-monitor.sh"
cat > "$fake_monitor" <<'MONITOR'
#!/usr/bin/env bash
if [ "${FAKE_USAGE_RC:-0}" -ne 0 ]; then
  exit "$FAKE_USAGE_RC"
fi
printf '%s\n' "${FAKE_USAGE_JSON:-[]}"
MONITOR
chmod +x "$fake_monitor"

USAGE_MONITOR="$fake_monitor"
QUOTA_FLOOR_PCT=3
export USAGE_MONITOR QUOTA_FLOOR_PCT
ACTIVE_GLOBAL_PROVIDER=codex
ACTIVE_VIBE_PROVIDER=codex
ACTIVE_WRITER_MODE=none
ACTIVE_WRITER_PROVIDER=claude
CLAUDE_AVAILABLE=true
GP_JUDGE_ALLOW_CLAUDE=0
LOG_OUTPUT=""

# Override only provider discovery; the production gate must still call the
# canonical resolver interfaces from tribunal-helpers.sh.
tribunal_llm_provider() {
  case "$ACTIVE_GLOBAL_PROVIDER" in
    codex|claude) printf '%s\n' "$ACTIVE_GLOBAL_PROVIDER" ;;
    *) return 1 ;;
  esac
}

tribunal_judge_provider() {
  if [ "${1:-}" = "vibe-opus-scorer" ]; then
    case "$ACTIVE_VIBE_PROVIDER" in
      codex|claude) printf '%s\n' "$ACTIVE_VIBE_PROVIDER" ;;
      *) return 1 ;;
    esac
    return
  fi
  tribunal_llm_provider
}

tribunal_writer_mode() {
  printf '%s\n' "$ACTIVE_WRITER_MODE"
}

tribunal_writer_provider() {
  case "$ACTIVE_WRITER_PROVIDER" in
    codex|claude) printf '%s\n' "$ACTIVE_WRITER_PROVIDER" ;;
    *) return 1 ;;
  esac
}

tribunal_claude_cmd() {
  [ "$CLAUDE_AVAILABLE" = true ] || return 1
  printf '%s\n' claude
}

tlog() {
  LOG_OUTPUT="${LOG_OUTPUT}${LOG_OUTPUT:+; }$*"
}

fail() {
  echo "x $*" >&2
  exit 1
}

pass() {
  echo "ok $*"
}

declare -F get_unscored_articles >/dev/null || fail "batch selector section was not loaded"

run_case() {
  local global_provider="$1"
  local vibe_provider="$2"
  local json="$3"
  local monitor_rc="${4:-0}"

  ACTIVE_GLOBAL_PROVIDER="$global_provider"
  ACTIVE_VIBE_PROVIDER="$vibe_provider"
  FAKE_USAGE_JSON="$json"
  FAKE_USAGE_RC="$monitor_rc"
  export FAKE_USAGE_JSON FAKE_USAGE_RC
  LOG_OUTPUT=""

  set +e
  check_quota_above_floor
  CASE_RC=$?
  set -e
}

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "codex-only quota should pass; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"codex"*"minimum=70"*) ;; *) fail "codex-only log lacks provider/minimum: $LOG_OUTPUT" ;; esac
pass "codex-only requires OpenAI short and weekly buckets"

run_case codex codex '[{"provider":"codex","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "legacy Codex provider alias should pass; rc=$CASE_RC log=$LOG_OUTPUT"
pass "Codex telemetry alias remains supported"

run_case claude claude '[{"provider":"claude","status":"ok","five_hr_remaining_pct":65,"weekly_remaining_pct":60}]'
[ "$CASE_RC" -eq 0 ] || fail "claude-only quota should pass; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"claude"*"minimum=60"*) ;; *) fail "claude-only log lacks provider/minimum: $LOG_OUTPUT" ;; esac
pass "claude-only requires Claude short and weekly buckets"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":75,"weekly_remaining_pct":70},{"provider":"claude","status":"ok","five_hr_remaining_pct":40,"weekly_remaining_pct":35}]'
[ "$CASE_RC" -eq 0 ] || fail "mixed quota should pass above floor; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"codex"*"claude"*"minimum=35"*) ;; *) fail "mixed quota did not select the strict minimum: $LOG_OUTPUT" ;; esac
pass "mixed providers gate on the strictest active bucket"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":75,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "missing active Claude entry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "missing active provider fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "missing active short bucket must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "missing active provider bucket fails closed"

run_case codex codex '[{"provider":"openai","status":"error","session_remaining_pct":90,"weekly_remaining_pct":90}]'
[ "$CASE_RC" -eq 2 ] || fail "active provider error status must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "active provider error status fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":1,"weekly_remaining_pct":1},{"provider":"openai","status":"ok","session_remaining_pct":90,"weekly_remaining_pct":90}]'
[ "$CASE_RC" -eq 2 ] || fail "duplicate active provider telemetry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "duplicate active provider telemetry fails closed"

run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70},{"provider":"claude","status":"error"}]'
[ "$CASE_RC" -eq 0 ] || fail "inactive provider error must not block an active healthy provider; rc=$CASE_RC log=$LOG_OUTPUT"
pass "inactive provider errors are ignored"

run_case codex claude '[{"provider":"openai","status":"ok","session_remaining_pct":90,"weekly_remaining_pct":90},{"provider":"claude","status":"ok","five_hr_remaining_pct":3,"weekly_remaining_pct":80}]'
[ "$CASE_RC" -eq 1 ] || fail "one provider at floor must stop all work; rc=$CASE_RC log=$LOG_OUTPUT"
case "$LOG_OUTPUT" in *"minimum=3"*) ;; *) fail "low-provider log lacks strict minimum: $LOG_OUTPUT" ;; esac
pass "one low active provider stops the mixed run"

run_case codex codex '[]' 9
[ "$CASE_RC" -eq 2 ] || fail "usage-monitor failure must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "usage-monitor failure fails closed"

run_case codex codex '{not-json'
[ "$CASE_RC" -eq 2 ] || fail "malformed telemetry must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "malformed telemetry fails closed"

QUOTA_FLOOR_PCT=invalid
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "invalid quota floor must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "invalid quota floor fails closed"
QUOTA_FLOOR_PCT=3

run_case unknown codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "provider resolver failure must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "provider resolver failure fails closed"

GP_JUDGE_ALLOW_CLAUDE=1
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "enabled Claude judge fallback must require Claude telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "enabled Claude judge fallback joins active providers"
GP_JUDGE_ALLOW_CLAUDE=0

ACTIVE_WRITER_MODE=cli
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "CLI writer must require Claude telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "CLI writer provider joins active providers"

ACTIVE_WRITER_MODE=codex
run_case claude claude '[{"provider":"claude","status":"ok","five_hr_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "Codex writer must require OpenAI telemetry; rc=$CASE_RC log=$LOG_OUTPUT"
pass "Codex writer provider joins active providers"

ACTIVE_WRITER_MODE=subagent
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 0 ] || fail "external writer broker must not invent an in-process provider; rc=$CASE_RC log=$LOG_OUTPUT"
pass "external writer broker does not invent a provider"

ACTIVE_WRITER_MODE=unknown
run_case codex codex '[{"provider":"openai","status":"ok","session_remaining_pct":80,"weekly_remaining_pct":70}]'
[ "$CASE_RC" -eq 2 ] || fail "unknown writer mode must fail closed; rc=$CASE_RC log=$LOG_OUTPUT"
pass "unknown writer mode fails closed"

selector_posts="$tmp_dir/posts"
selector_progress="$tmp_dir/progress.json"
mkdir -p "$selector_posts"

write_selector_post() {
  local file="$1"
  local translated_date="$2"
  local status="${3:-}"
  {
    printf '%s\n' '---'
    printf 'title: %s\n' "$file"
    printf 'translatedDate: %s\n' "$translated_date"
    [ -n "$status" ] && printf 'status: %s\n' "$status"
    printf '%s\n' '---' 'body'
  } > "$selector_posts/$file"
}

write_selector_post pending.mdx 2026-01-08
write_selector_post needs-review-same.mdx 2026-01-09
write_selector_post needs-review-changed.mdx 2026-01-10
write_selector_post legacy-exhausted.mdx 2026-01-07
write_selector_post current-exhausted.mdx 2026-01-06
write_selector_post current-pass.mdx 2026-01-05
write_selector_post deprecated-unquoted.mdx 2026-01-04 deprecated
write_selector_post deprecated-single-quoted.mdx 2026-01-03 "'deprecated'"
write_selector_post deprecated-double-quoted.mdx 2026-01-02 '"deprecated"'

same_revision="$(tribunal_reader_revision_for_file "$selector_posts/needs-review-same.mdx")"
cat > "$selector_progress" <<JSON
{
  "needs-review-same.mdx": {
    "tribunalVersion": 9,
    "status": "NEEDS_REVIEW",
    "readerRevision": "$same_revision"
  },
  "needs-review-changed.mdx": {
    "tribunalVersion": 9,
    "status": "NEEDS_REVIEW",
    "readerRevision": "0000000000000000"
  },
  "legacy-exhausted.mdx": {
    "tribunalVersion": 8,
    "status": "EXHAUSTED"
  },
  "current-exhausted.mdx": {
    "tribunalVersion": 9,
    "status": "EXHAUSTED"
  },
  "current-pass.mdx": {
    "tribunalVersion": 9,
    "status": "PASS"
  }
}
JSON

POSTS_DIR="$selector_posts"
PROGRESS_FILE="$selector_progress"
ROOT_DIR="$tmp_dir"
TRIBUNAL_VERSION=9

selector_output=$(get_unscored_articles)
quota_selector_output=$(get_quota_unscored_articles)
expected_selector_output=$(printf '%s\n' needs-review-changed.mdx pending.mdx legacy-exhausted.mdx)
[ "$selector_output" = "$expected_selector_output" ] ||
  fail "selector included deprecated/current terminal entries: $selector_output"
[ "$quota_selector_output" = "$expected_selector_output" ] ||
  fail "quota selector disagreed with bounded selector: $quota_selector_output"
pass "both schedulers skip same-revision NEEDS_REVIEW and reopen changed content"

TRIBUNAL_READER_REVISION_HELPER="$tmp_dir/missing-reader-helper.mjs"
hash_failure_output=$(get_unscored_articles 2>/dev/null)
quota_hash_failure_output=$(get_quota_unscored_articles 2>/dev/null)
expected_hash_failure_output=$(printf '%s\n' pending.mdx legacy-exhausted.mdx)
[ "$hash_failure_output" = "$expected_hash_failure_output" ] ||
  fail "bounded selector did not fail closed on reader hash failure: $hash_failure_output"
[ "$quota_hash_failure_output" = "$expected_hash_failure_output" ] ||
  fail "quota selector did not fail closed on reader hash failure: $quota_hash_failure_output"
unset TRIBUNAL_READER_REVISION_HELPER
pass "both schedulers fail closed when NEEDS_REVIEW revision cannot be verified"

# Exercise the bounded supervisor's real dispatch/completion loop with a
# hermetic worker. Static selectors above prove the labels; this fixture proves
# rc=3 does not stop, drain, or count as generic failure.
supervisor_root="$tmp_dir/supervisor-runtime"
supervisor_bin="$tmp_dir/supervisor-bin"
supervisor_calls="$tmp_dir/supervisor-worker-calls"
supervisor_quota_calls="$tmp_dir/supervisor-quota-calls"
supervisor_model_calls="$tmp_dir/supervisor-model-calls"
mkdir -p "$supervisor_root/src/content/posts" "$supervisor_root/.score-loop/state" \
  "$supervisor_bin"
cp -a "$SOURCE_ROOT/scripts" "$supervisor_root/"
ln -s "$SOURCE_ROOT/node_modules" "$supervisor_root/node_modules"

write_supervisor_post() {
  local file="$1" date_value="$2"
  cat > "$supervisor_root/src/content/posts/$file" <<EOF
---
ticketId: "GP-SUPERVISOR-$file"
title: "Supervisor deterministic fixture"
originalDate: $date_value
translatedDate: $date_value
source: "Fixture"
sourceUrl: "https://example.invalid/fixture"
summary: "Reader-visible supervisor fixture."
lang: zh-tw
tags: ["fixture"]
---

This hermetic supervisor fixture never reaches a model or network provider.
EOF
}

first_supervisor_article="gp-supervisor-rc3-first-$$.mdx"
second_supervisor_article="gp-supervisor-rc3-second-$$.mdx"
write_supervisor_post "$first_supervisor_article" 2026-09-12
write_supervisor_post "$second_supervisor_article" 2026-09-11

cat > "$supervisor_root/scripts/tribunal.sh" <<'FAKE_SUPERVISOR_WORKER'
#!/usr/bin/env bash
set -euo pipefail

article="${1:?article is required}"
root="${PWD:?worker must inherit the runtime root as PWD}"
progress="$root/.score-loop/state/tribunal-progress.json"
calls="${TRIBUNAL_SUPERVISOR_CALLS:?call marker is required}"
printf '%s\n' "$article" >> "$calls"

revision="$(node "$root/scripts/reader-revision-of-stdin.mjs" < "$root/src/content/posts/$article")"
version="$(node "$root/scripts/tribunal-version.mjs" current)"
case "$article" in
  gp-supervisor-rc3-first-*.mdx)
    jq --arg article "$article" --arg revision "$revision" --argjson version "$version" \
      '.[$article] = {
        status: "NEEDS_REVIEW",
        failedStage: "factChecker",
        terminalReason: "gp_source_preservation_no_rewrite",
        readerRevision: $revision,
        tribunalVersion: $version,
        topLevelAttempts: 0
      }' "$progress" > "$progress.tmp"
    mv "$progress.tmp" "$progress"
    exit 3
    ;;
  gp-supervisor-rc3-second-*.mdx)
    jq --arg article "$article" --arg revision "$revision" --argjson version "$version" \
      '.[$article] = {
        status: "PASS",
        readerRevision: $revision,
        tribunalVersion: $version,
        topLevelAttempts: 1
      }' "$progress" > "$progress.tmp"
    mv "$progress.tmp" "$progress"
    exit 0
    ;;
  *)
    printf 'unexpected article: %s\n' "$article" >&2
    exit 97
    ;;
esac
FAKE_SUPERVISOR_WORKER
chmod +x "$supervisor_root/scripts/tribunal.sh"

cat > "$supervisor_bin/claude" <<'FAKE_SUPERVISOR_MODEL'
#!/usr/bin/env bash
: "${TRIBUNAL_SUPERVISOR_MODEL_CALLS:?model call marker is required}"
printf '%s\n' "$*" >> "$TRIBUNAL_SUPERVISOR_MODEL_CALLS"
exit 99
FAKE_SUPERVISOR_MODEL
chmod +x "$supervisor_bin/claude"

cat > "$supervisor_bin/usage-monitor.sh" <<'FAKE_SUPERVISOR_QUOTA'
#!/usr/bin/env bash
set -euo pipefail
: "${TRIBUNAL_SUPERVISOR_QUOTA_CALLS:?quota call marker is required}"
printf '1\n' >> "$TRIBUNAL_SUPERVISOR_QUOTA_CALLS"
printf '%s\n' '[{"provider":"claude","status":"ok","five_hr_remaining_pct":90,"weekly_remaining_pct":90}]'
FAKE_SUPERVISOR_QUOTA
chmod +x "$supervisor_bin/usage-monitor.sh"

# The runner has a ten-second inter-article cooldown. Replace only sleep in
# this disposable PATH prefix so the regression stays deterministic and fast.
cat > "$supervisor_bin/sleep" <<'FAKE_SUPERVISOR_SLEEP'
#!/usr/bin/env bash
exit 0
FAKE_SUPERVISOR_SLEEP
chmod +x "$supervisor_bin/sleep"

git -C "$supervisor_root" init -q

supervisor_output="$tmp_dir/supervisor.out"
set +e
PATH="$supervisor_bin:$PATH" \
  HOME="$tmp_dir/home-supervisor" \
  TRIBUNAL_FORCE_PROVIDER=claude \
  GP_WRITER_MODE=none \
  QUOTA_FLOOR_PCT=3 \
  USAGE_MONITOR="$supervisor_bin/usage-monitor.sh" \
  TRIBUNAL_SUPERVISOR_CALLS="$supervisor_calls" \
  TRIBUNAL_SUPERVISOR_QUOTA_CALLS="$supervisor_quota_calls" \
  TRIBUNAL_SUPERVISOR_MODEL_CALLS="$supervisor_model_calls" \
  bash "$supervisor_root/scripts/tribunal-batch-runner.sh" --max 2 \
  > "$supervisor_output" 2>&1
supervisor_rc=$?
set -e

[ "$supervisor_rc" -eq 0 ] || {
  sed -n '1,240p' "$supervisor_output" >&2
  find "$supervisor_root/.score-loop/logs" -type f -maxdepth 2 -print -exec sed -n '1,120p' {} \; >&2
  fail "bounded supervisor fixture exited rc=$supervisor_rc"
}
expected_supervisor_calls=$(printf '%s\n%s' \
  "$first_supervisor_article" "$second_supervisor_article")
[ "$(cat "$supervisor_calls")" = "$expected_supervisor_calls" ] || {
  cat "$supervisor_calls" >&2
  fail "rc=3 stopped or reordered the bounded supervisor dispatch"
}
grep -Fq 'Needs review: 1' "$supervisor_output" || {
  sed -n '1,240p' "$supervisor_output" >&2
  find "$supervisor_root/.score-loop/logs" -type f -maxdepth 2 -print -exec sed -n '1,120p' {} \; >&2
  fail "bounded supervisor did not record one NEEDS_REVIEW outcome"
}
grep -Fq 'Passed:  1' "$supervisor_output" ||
  fail "bounded supervisor did not continue to and pass the second article"
grep -Fq 'Failed:  0' "$supervisor_output" ||
  fail "bounded supervisor counted rc=3 as generic failure"
[ "$(wc -l < "$supervisor_quota_calls" | tr -d ' ')" -ge 2 ] ||
  fail "bounded supervisor did not perform a fresh quota gate for both articles"
[ ! -s "$supervisor_model_calls" ] ||
  fail "hermetic supervisor fixture invoked a model provider"
jq -e --arg a "$first_supervisor_article" --arg b "$second_supervisor_article" \
  '.[$a].status == "NEEDS_REVIEW" and .[$b].status == "PASS"' \
  "$supervisor_root/.score-loop/state/tribunal-progress.json" >/dev/null ||
  fail "worker outcome ledger did not preserve NEEDS_REVIEW then PASS"
pass "bounded supervisor consumes rc=3, continues to the next article, and avoids model/quota drain"
