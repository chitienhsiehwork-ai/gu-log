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
  { "number": 42, "url": "https://example.com/pr/42", "isDraft": true, "headRefName": "publisher/batch-2", "state": "OPEN" },
  { "number": 43, "url": "https://example.com/pr/43", "isDraft": false, "headRefName": "publisher/batch-3", "state": "OPEN" }
]
JSON

cat > "$TMP/merged-none.json" <<'JSON'
[]
JSON

cat > "$TMP/merged-batch3.json" <<'JSON'
[
  {
    "number": 43,
    "url": "https://example.com/pr/43",
    "headRefName": "publisher/batch-3",
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
pass "autopilot reconciles merged publisher PRs back into published state"
