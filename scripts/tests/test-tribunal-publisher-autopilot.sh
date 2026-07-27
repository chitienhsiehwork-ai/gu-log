#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

runtime="$TMP/runtime"
mkdir -p "$runtime/scripts" "$runtime/.score-loop/state" "$runtime/.score-loop/locks"
cp "$ROOT_DIR/scripts/tribunal-publisher-autopilot.sh" "$runtime/scripts/tribunal-publisher-autopilot.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$runtime/scripts/tribunal-helpers.sh"
chmod +x "$runtime/scripts/tribunal-publisher-autopilot.sh"

cat > "$runtime/.score-loop/state/tribunal-publisher.json" <<'JSON'
{
  "schemaVersion": 1,
  "entries": {
    "gp-1-test.mdx": { "publishState": "branch_pushed", "batchId": "batch-1" },
    "gp-2-test.mdx": { "publishState": "pr_open", "batchId": "batch-2" },
    "gp-3-test.mdx": { "publishState": "pr_open", "batchId": "batch-3" }
  },
  "batches": {
    "batch-1": { "batchId": "batch-1", "branch": "publisher/batch-1", "entries": ["gp-1-test.mdx"], "state": "branch_pushed" },
    "batch-2": { "batchId": "batch-2", "branch": "publisher/batch-2", "entries": ["gp-2-test.mdx"], "state": "pr_open" },
    "batch-3": { "batchId": "batch-3", "branch": "publisher/batch-3", "entries": ["gp-3-test.mdx"], "state": "pr_open" }
  }
}
JSON

cat > "$runtime/.score-loop/state/tribunal-triage-events.json" <<'JSON'
{ "schemaVersion": 1, "events": {} }
JSON

cat > "$TMP/open.json" <<'JSON'
[
  { "number": 141, "url": "https://example.com/pr/141", "isDraft": true, "headRefName": "publisher/batch-1", "baseRefName": "release", "state": "OPEN" },
  { "number": 142, "url": "https://example.com/pr/142", "isDraft": true, "headRefName": "publisher/batch-2", "baseRefName": "release", "state": "OPEN" },
  { "number": 42, "url": "https://example.com/pr/42", "isDraft": true, "headRefName": "publisher/batch-2", "baseRefName": "main", "state": "OPEN" },
  { "number": 143, "url": "https://example.com/pr/143", "isDraft": false, "headRefName": "publisher/batch-3", "baseRefName": "release", "state": "OPEN" },
  { "number": 43, "url": "https://example.com/pr/43", "isDraft": false, "headRefName": "publisher/batch-3", "baseRefName": "main", "state": "OPEN" }
]
JSON

cat > "$TMP/merged-none.json" <<'JSON'
[]
JSON

cat > "$TMP/merged-batch3.json" <<'JSON'
[
  {
    "number": 242,
    "url": "https://example.com/pr/242",
    "headRefName": "publisher/batch-2",
    "baseRefName": "release",
    "state": "MERGED",
    "mergedAt": "2026-05-21T09:00:00Z",
    "mergeCommit": { "oid": "wrong-off-base-only-commit" }
  },
  {
    "number": 143,
    "url": "https://example.com/pr/143",
    "headRefName": "publisher/batch-3",
    "baseRefName": "release",
    "state": "MERGED",
    "mergedAt": "2026-05-22T09:00:00Z",
    "mergeCommit": { "oid": "wrong-off-base-commit" }
  },
  {
    "number": 43,
    "url": "https://example.com/pr/43",
    "headRefName": "publisher/batch-3",
    "baseRefName": "main",
    "state": "MERGED",
    "mergedAt": "2026-05-23T09:00:00Z",
    "mergeCommit": { "oid": "abc123def456" }
  }
]
JSON

ready_log="$TMP/ready.log"
guard_log="$TMP/guard.log"
create_log="$TMP/create.log"

cat > "$TMP/ready-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo "$1" >> "$READY_LOG"
HOOK
chmod +x "$TMP/ready-hook.sh"

cat > "$TMP/guard-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo "$1" >> "$GUARD_LOG"
exit 0
HOOK
chmod +x "$TMP/guard-hook.sh"

cat > "$TMP/create-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo "$1 $2" >> "$CREATE_LOG"
echo "https://example.com/pr/41"
HOOK
chmod +x "$TMP/create-hook.sh"

(cd "$runtime" && \
  READY_LOG="$ready_log" \
  GUARD_LOG="$guard_log" \
  CREATE_LOG="$create_log" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_OPEN_PRS_JSON_FILE="$TMP/open.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGED_PRS_JSON_FILE="$TMP/merged-none.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK="$TMP/ready-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK="$TMP/guard-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_CREATE_PR_HOOK="$TMP/create-hook.sh" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply)

grep -q '^42$' "$ready_log" || fail "draft publisher PR should be marked ready"
grep -q '^42$' "$guard_log" || fail "merge guard should run for ready'd PR"
grep -q '^43$' "$guard_log" || fail "merge guard should run for already-ready PR"
! grep -qE '^(141|142|143)$' "$ready_log" || fail "off-base PR must not be marked ready"
! grep -qE '^(141|142|143)$' "$guard_log" || fail "off-base PR must not reach merge guard"
grep -q '^batch-1 publisher/batch-1$' "$create_log" || fail "branch_pushed batch should recover a PR"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "pr_open" ] || fail "recovered PR should move entry to pr_open"
[ "$(jq -r '.entries["gp-1-test.mdx"].prNumber' "$runtime/.score-loop/state/tribunal-publisher.json")" = "41" ] || fail "recovered PR should store prNumber"
pass "autopilot recovers missing PRs and advances open PRs"

cat > "$TMP/open-empty.json" <<'JSON'
[]
JSON

(cd "$runtime" && \
  READY_LOG="$ready_log" \
  GUARD_LOG="$guard_log" \
  CREATE_LOG="$create_log" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_OPEN_PRS_JSON_FILE="$TMP/open-empty.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGED_PRS_JSON_FILE="$TMP/merged-batch3.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK="$TMP/ready-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK="$TMP/guard-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_CREATE_PR_HOOK="$TMP/create-hook.sh" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply)

[ "$(jq -r '.entries["gp-3-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "published" ] || fail "merged publisher PR should reconcile to published"
[ "$(jq -r '.entries["gp-3-test.mdx"].mergeCommit' "$runtime/.score-loop/state/tribunal-publisher.json")" = "abc123def456" ] || fail "published entry should record merge commit"
[ "$(jq -r '.batches["batch-3"].state' "$runtime/.score-loop/state/tribunal-publisher.json")" = "published" ] || fail "batch state should reconcile to published"
[ "$(jq -r '.entries["gp-2-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "pr_open" ] || fail "off-base-only merged PR must not publish a batch"
[ "$(jq -r '.entries["gp-2-test.mdx"].mergeCommit // ""' "$runtime/.score-loop/state/tribunal-publisher.json")" = "" ] || fail "off-base-only merged PR must not record merge metadata"
pass "autopilot reconciles merged publisher PRs back into published state"

cat > "$runtime/.score-loop/state/tribunal-publisher.json" <<'JSON'
{
  "schemaVersion": 1,
  "entries": {
    "gp-2-test.mdx": { "publishState": "pr_open", "batchId": "batch-2" },
    "gp-3-test.mdx": { "publishState": "pr_open", "batchId": "batch-3" }
  },
  "batches": {
    "batch-2": { "batchId": "batch-2", "branch": "publisher/batch-2", "entries": ["gp-2-test.mdx"], "state": "pr_open" },
    "batch-3": { "batchId": "batch-3", "branch": "publisher/batch-3", "entries": ["gp-3-test.mdx"], "state": "pr_open" }
  }
}
JSON

cat > "$TMP/open-ready-failure.json" <<'JSON'
[
  { "number": 42, "url": "https://example.com/pr/42", "isDraft": true, "headRefName": "publisher/batch-2", "baseRefName": "main", "state": "OPEN" },
  { "number": 43, "url": "https://example.com/pr/43", "isDraft": false, "headRefName": "publisher/batch-3", "baseRefName": "main", "state": "OPEN" }
]
JSON

failed_ready_log="$TMP/failed-ready.log"
ready_failure_guard_log="$TMP/ready-failure-guard.log"
ready_failure_audit_log="$TMP/ready-failure-audit.jsonl"

cat > "$TMP/failing-ready-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
echo "$1" >> "$FAILED_READY_LOG"
[ "$1" != "42" ]
HOOK
chmod +x "$TMP/failing-ready-hook.sh"

(cd "$runtime" && \
  FAILED_READY_LOG="$failed_ready_log" \
  GUARD_LOG="$ready_failure_guard_log" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_OPEN_PRS_JSON_FILE="$TMP/open-ready-failure.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGED_PRS_JSON_FILE="$TMP/merged-none.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK="$TMP/failing-ready-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK="$TMP/guard-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_AUDIT_LOG="$ready_failure_audit_log" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply)

grep -q '^42$' "$failed_ready_log" || fail "draft publisher PR should attempt the ready transition"
! grep -q '^42$' "$ready_failure_guard_log" || fail "failed ready transition must not reach merge guard"
grep -q '^43$' "$ready_failure_guard_log" || fail "ready failure must not block an already-ready batch"
jq -e 'select(.event == "pr_ready_failed" and (.detail | contains("batch=batch-2 pr=42")) and (.detail | contains("rc=1")))' "$ready_failure_audit_log" >/dev/null \
  || fail "failed ready transition should be recorded honestly"
if jq -e 'select(.event == "pr_ready" and (.detail | contains("batch=batch-2 pr=42")))' "$ready_failure_audit_log" >/dev/null; then
  fail "failed ready transition must not be recorded as pr_ready"
fi
if jq -e 'select((.event == "merge_guard_allow" or .event == "merge_guard_defer") and (.detail | contains("batch=batch-2 pr=42")))' "$ready_failure_audit_log" >/dev/null; then
  fail "failed ready transition must not record a merge guard decision"
fi
[ "$(jq -r '.entries["gp-2-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "pr_open" ] || fail "failed ready transition should remain retryable"
[ "$(jq -r '.batches["batch-2"].state' "$runtime/.score-loop/state/tribunal-publisher.json")" = "pr_open" ] || fail "failed ready transition should keep the batch retryable"
[ "$(jq -r '.entries["gp-2-test.mdx"].prNumber' "$runtime/.score-loop/state/tribunal-publisher.json")" = "42" ] || fail "failed ready transition should retain PR metadata"

retry_ready_log="$TMP/retry-ready.log"
retry_guard_log="$TMP/retry-guard.log"
(cd "$runtime" && \
  READY_LOG="$retry_ready_log" \
  GUARD_LOG="$retry_guard_log" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_OPEN_PRS_JSON_FILE="$TMP/open-ready-failure.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGED_PRS_JSON_FILE="$TMP/merged-none.json" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_READY_HOOK="$TMP/ready-hook.sh" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_MERGE_GUARD_HOOK="$TMP/guard-hook.sh" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply)

grep -q '^42$' "$retry_ready_log" || fail "later cycle should retry the ready transition"
grep -q '^42$' "$retry_guard_log" || fail "successful ready retry should reach merge guard"
pass "autopilot defers merge automation when marking a draft PR ready fails"

gh_log="$TMP/gh.log"
cat > "$TMP/gh-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
if [ "$1 $2" = "pr list" ]; then
  printf '[]\n'
  exit 0
fi
exit 1
HOOK
chmod +x "$TMP/gh-hook.sh"

(cd "$runtime" && \
  GH_LOG="$gh_log" \
  GH_BIN="$TMP/gh-hook.sh" \
  GU_LOG_GH_TOKEN="fixture-token" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply)

grep -q '^pr list ' "$gh_log" || fail "autopilot should query live PR state"
if grep '^pr list ' "$gh_log" | grep -qv -- '--base main'; then
  fail "every live open/merged PR lookup must constrain base to main"
fi
grep '^pr list ' "$gh_log" | grep -- '--state open' | grep -q -- '--base main' \
  || fail "live open PR lookup must constrain base to main"
grep '^pr list ' "$gh_log" | grep -- '--state merged' | grep -q -- '--base main' \
  || fail "live merged PR lookup must constrain base to main"
pass "autopilot constrains live PR lookup to the main base"

corrupt_publisher_state="$TMP/corrupt-publisher-state.json"
corrupt_publisher_before="$TMP/corrupt-publisher-state.before"
missing_triage_state="$TMP/autopilot-missing-triage-state.json"
publisher_preflight_side_effects="$TMP/autopilot-publisher-preflight-side-effects"
printf '{"sentinel":"publisher"\n' > "$corrupt_publisher_state"
cp "$corrupt_publisher_state" "$corrupt_publisher_before"

if corrupt_out="$(cd "$runtime" && \
  PUBLISHER_STATE_FILE="$corrupt_publisher_state" \
  TRIAGE_EVENTS_FILE="$missing_triage_state" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_LOCK_FILE="$publisher_preflight_side_effects/locks/autopilot.lock" \
  TRIBUNAL_PUBLISHER_AUTOPILOT_AUDIT_LOG="$publisher_preflight_side_effects/state/audit.jsonl" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply 2>&1)"; then
  fail "autopilot must reject corrupt publisher state"
fi
cmp -s "$corrupt_publisher_before" "$corrupt_publisher_state" || fail "autopilot must not overwrite corrupt publisher state"
[ ! -e "$missing_triage_state" ] || fail "autopilot must validate all ledgers before initializing a missing sibling"
[ ! -e "$publisher_preflight_side_effects" ] || fail "autopilot must validate runtime ledgers before creating lock or audit directories"
grep -q 'invalid JSON' <<<"$corrupt_out" || fail "autopilot should explain corrupt publisher state"
grep -Fq "$corrupt_publisher_state" <<<"$corrupt_out" || fail "autopilot should identify the corrupt publisher state path"

missing_publisher_state="$TMP/autopilot-missing-publisher-state.json"
corrupt_triage_state="$TMP/corrupt-triage-state.json"
corrupt_triage_before="$TMP/corrupt-triage-state.before"
printf '{"sentinel":"triage"\n' > "$corrupt_triage_state"
cp "$corrupt_triage_state" "$corrupt_triage_before"

if corrupt_out="$(cd "$runtime" && \
  PUBLISHER_STATE_FILE="$missing_publisher_state" \
  TRIAGE_EVENTS_FILE="$corrupt_triage_state" \
  bash scripts/tribunal-publisher-autopilot.sh --skip-apply 2>&1)"; then
  fail "autopilot must reject corrupt triage state"
fi
cmp -s "$corrupt_triage_before" "$corrupt_triage_state" || fail "autopilot must not overwrite corrupt triage state"
[ ! -e "$missing_publisher_state" ] || fail "autopilot must not initialize publisher state before triage preflight passes"
grep -q 'invalid JSON' <<<"$corrupt_out" || fail "autopilot should explain corrupt triage state"
grep -Fq "$corrupt_triage_state" <<<"$corrupt_out" || fail "autopilot should identify the corrupt triage state path"
pass "autopilot preflights all runtime ledgers before mutation"
