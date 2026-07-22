#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=scripts/tribunal-helpers.sh
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

make_repo() {
  local repo="$1"
  mkdir -p "$repo/src/content/posts"
  cat > "$repo/src/content/posts/gp-test.mdx" <<'POST'
---
ticketId: "GP-TEST"
title: "Test"
originalDate: "2026-06-15"
translatedDate: "2026-06-15"
translatedBy:
  model: "Test"
  harness: "Test"
source: "Test"
sourceUrl: "https://example.com"
lang: "zh-tw"
summary: "Test"
---

Original body.
POST
}

wait_for_request() {
  local broker="$1"
  local deadline=$((SECONDS + 5))
  local request=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    request="$(find "$broker" -name '*.request.json' -print -quit)"
    if [ -n "$request" ]; then
      printf '%s\n' "$request"
      return 0
    fi
    sleep 0.1
  done
  return 1
}

run_writer() {
  local mode="$1"
  local broker="$2"
  local work_dir="$3"
  GP_WRITER_MODE="$mode" \
    GP_WRITER_BROKER_DIR="$broker" \
    GP_WRITER_BROKER_TIMEOUT="${GP_WRITER_BROKER_TIMEOUT:-5}" \
    GP_WRITER_BROKER_POLL_INTERVAL=0.1 \
    TRIBUNAL_WRITER_POST_FILE="gp-test.mdx" \
    TRIBUNAL_WRITER_STAGE="vibe" \
    TRIBUNAL_WRITER_ATTEMPT=2 \
    tribunal_writer_exec "$work_dir" "tribunal-writer" "rewrite prompt"
}

repo="$TMP/repo-success"
broker="$TMP/broker-success"
work="$TMP/work-success"
make_repo "$repo"
mkdir -p "$broker" "$work"
export REPO_ROOT="$repo"

(
  request="$(wait_for_request "$broker")" || exit 1
  id="$(jq -r '.id' "$request")"
  post_path="$(jq -r '.post_path' "$request")"
  [ "$(jq -r '.agent_name' "$request")" = "tribunal-writer" ] || exit 2
  [ "$(jq -r '.post_file' "$request")" = "gp-test.mdx" ] || exit 3
  [ "$(jq -r '.stage' "$request")" = "vibe" ] || exit 4
  [ "$(jq -r '.attempt' "$request")" = "2" ] || exit 5
  printf '\nFake rewrite complete.\n' >> "$post_path"
  : > "$broker/$id.done"
) &
fulfiller_pid=$!

run_writer subagent "$broker" "$work" >/dev/null
wait "$fulfiller_pid"
grep -q 'Fake rewrite complete' "$repo/src/content/posts/gp-test.mdx" || fail "subagent success did not alter target file"
if find "$broker" -name '*.request.json' -o -name '*.done' -o -name '*.failed' -o -name '*.claimed' | grep -q .; then
  fail "subagent success did not clean request/marker files"
fi
pass "subagent mode emits request, fake fulfiller satisfies it, and writer returns success"

repo="$TMP/repo-failed"
broker="$TMP/broker-failed"
work="$TMP/work-failed"
make_repo "$repo"
mkdir -p "$broker" "$work"
export REPO_ROOT="$repo"
(
  request="$(wait_for_request "$broker")" || exit 1
  id="$(jq -r '.id' "$request")"
  : > "$broker/$id.failed"
) &
fulfiller_pid=$!
set +e
run_writer subagent "$broker" "$work" >/dev/null 2>&1
rc=$?
set -e
wait "$fulfiller_pid"
[ "$rc" -ne 0 ] || fail "subagent failed marker should return non-zero"
pass "subagent mode returns non-zero when fake fulfiller writes failed marker"

repo="$TMP/repo-timeout"
broker="$TMP/broker-timeout"
work="$TMP/work-timeout"
make_repo "$repo"
mkdir -p "$broker" "$work"
export REPO_ROOT="$repo"
set +e
GP_WRITER_BROKER_TIMEOUT=1 run_writer subagent "$broker" "$work" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || fail "subagent timeout should return non-zero"
if find "$broker" -name '*.request.json' -o -name '*.done' -o -name '*.failed' -o -name '*.claimed' | grep -q .; then
  fail "subagent timeout did not clean request/marker files"
fi
pass "subagent mode times out non-zero and cleans request files"

repo="$TMP/repo-none"
broker="$TMP/broker-none"
work="$TMP/work-none"
make_repo "$repo"
mkdir -p "$broker" "$work"
export REPO_ROOT="$repo"
set +e
run_writer none "$broker" "$work" >/dev/null 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || fail "none mode should not report writer success"
if find "$broker" -name '*.request.json' | grep -q .; then
  fail "none mode emitted a broker request"
fi
pass "none mode skips rewrite without emitting a broker request"

grep -q 'Rewrite skipped (GP_WRITER_MODE=none); failing score-only' "$ROOT_DIR/scripts/tribunal.sh" \
  || fail "tribunal.sh should log none-mode score-only skip"
# shellcheck disable=SC2016 # Intentionally matching literal shell variables in tribunal.sh.
grep -q 'write_stage_progress "$post_file" "$stage_key" "fail"' "$ROOT_DIR/scripts/tribunal.sh" \
  || fail "tribunal.sh should write fail progress when none mode skips rewrite"
pass "none mode stage branch records fail progress"

broker="$TMP/wait-helper"
mkdir -p "$broker"
broker_real="$(cd "$broker" && pwd -P)"
sleep 5 &
pipeline_pid=$!
request="$broker/manual.request.json"
request_real="$broker_real/manual.request.json"
cat > "$request" <<'JSON'
{"id":"manual"}
JSON
event="$("$ROOT_DIR/scripts/writer-broker-wait.sh" --dir "$broker" --pid "$pipeline_pid" --timeout 2)"
case "$event" in
  REQUEST\ "$request_real") ;;
  *) fail "wait helper should print REQUEST path, got: $event" ;;
esac
[ -f "$broker/manual.claimed" ] || fail "wait helper did not claim request"
rm -f "$request" "$broker/manual.claimed"
kill "$pipeline_pid" >/dev/null 2>&1 || true
wait "$pipeline_pid" 2>/dev/null || true
event="$("$ROOT_DIR/scripts/writer-broker-wait.sh" --dir "$broker" --pid "$pipeline_pid" --timeout 2)"
[ "$event" = "PIPELINE_DONE" ] || fail "wait helper should print PIPELINE_DONE, got: $event"
pass "wait helper claims requests and reports pipeline completion"
