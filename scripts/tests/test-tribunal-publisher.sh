#!/usr/bin/env bash
set -euo pipefail

if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
  echo "SKIP: Tribunal publisher requires Bash 4+ (mapfile)."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

origin="$TMP/origin.git"
seed="$TMP/seed"
runtime="$TMP/runtime"

git init --bare "$origin" >/dev/null
git clone "$origin" "$seed" >/dev/null 2>&1
git -C "$seed" config user.email test@example.invalid
git -C "$seed" config user.name "Tribunal Publisher Test"
mkdir -p "$seed/src/content/posts"

cat > "$seed/package.json" <<'JSON'
{
  "scripts": {
    "build": "astro build"
  },
  "packageManager": "pnpm@10.29.3"
}
JSON
cat > "$seed/pnpm-lock.yaml" <<'YAML'
lockfileVersion: '9.0'
YAML
cat > "$seed/pnpm-workspace.yaml" <<'YAML'
onlyBuiltDependencies:
  - esbuild
  - sharp
YAML
cat > "$seed/.gitignore" <<'IGNORE'
node_modules/
IGNORE

cat > "$seed/src/content/posts/gp-1-test.mdx" <<'POST'
---
ticketId: GP-1
title: "GP1"
originalDate: 2026-05-20
translatedDate: 2026-05-21
source: "X"
sourceUrl: "https://example.com/gp1"
summary: "Summary one."
lang: zh-tw
scores:
  tribunalVersion: 8
---
This is a sufficiently long body for publisher validation. It explains one coherent idea, adds supporting detail, and stays comfortably above the minimum content length that the deterministic content validator requires for a real publishable artifact in gu-log.
POST
cat > "$seed/src/content/posts/en-gp-1-test.mdx" <<'POST'
---
ticketId: GP-1
title: "GP1 EN"
originalDate: 2026-05-20
translatedDate: 2026-05-21
source: "X"
sourceUrl: "https://example.com/gp1"
summary: "Summary one en."
lang: en
scores:
  tribunalVersion: 8
---
This is a sufficiently long English body for publisher validation. It mirrors the publishable structure expected by the content validator and avoids failing on missing metadata or minimum-length requirements during the clean batch materialization step.
POST
cat > "$seed/src/content/posts/gp-2-test.mdx" <<'POST'
---
ticketId: GP-2
title: "GP2"
originalDate: 2026-05-20
translatedDate: 2026-05-21
source: "X"
sourceUrl: "https://example.com/gp2"
summary: "Summary two."
lang: zh-tw
scores:
  tribunalVersion: 8
---
This is another sufficiently long body for publisher validation. It exists so the test can later turn it into an invalid candidate and verify that validation-blocked events isolate only the broken article instead of stopping the clean publisher batch.
POST
cat > "$seed/src/content/posts/en-gp-2-test.mdx" <<'POST'
---
ticketId: GP-2
title: "GP2 EN"
originalDate: 2026-05-20
translatedDate: 2026-05-21
source: "X"
sourceUrl: "https://example.com/gp2"
summary: "Summary two en."
lang: en
scores:
  tribunalVersion: 8
---
This is another sufficiently long English body for publisher validation. It gives the test a clean bilingual pair so the batch publisher can materialize both files and still isolate the broken candidate later when the zh file is intentionally damaged.
POST

git -C "$seed" add .
git -C "$seed" commit -m "base" >/dev/null
git -C "$seed" push origin HEAD:main >/dev/null 2>&1

git clone "$origin" "$runtime" >/dev/null 2>&1
git -C "$runtime" checkout -b tribunal-runtime origin/main >/dev/null 2>&1
git -C "$runtime" config user.email test@example.invalid
git -C "$runtime" config user.name "Runtime"
mkdir -p "$runtime/scripts"
cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$runtime/scripts/tribunal-publisher.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$runtime/scripts/tribunal-helpers.sh"
chmod +x "$runtime/scripts/tribunal-publisher.sh"
cat > "$runtime/scripts/test-validate-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
article="$1"
if [ "${TRIBUNAL_PUBLISHER_FORCE_INVALID:-}" = "$article" ]; then
  exit 1
fi
exit 0
HOOK
chmod +x "$runtime/scripts/test-validate-hook.sh"
mkdir -p "$runtime/.score-loop/state"

setup_reconciliation_runtime() {
  local target="$1"
  git clone "$origin" "$target" >/dev/null 2>&1
  git -C "$target" checkout -b tribunal-reconciliation-runtime origin/main >/dev/null 2>&1
  git -C "$target" config user.email test@example.invalid
  git -C "$target" config user.name "Runtime"
  mkdir -p "$target/scripts" "$target/.score-loop/state"
  cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$target/scripts/tribunal-publisher.sh"
  cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$target/scripts/tribunal-helpers.sh"
  chmod +x "$target/scripts/tribunal-publisher.sh"
  cat > "$target/scripts/test-validate-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
article="$1"
if [ "${TRIBUNAL_PUBLISHER_FORCE_INVALID:-}" = "$article" ]; then
  exit 1
fi
exit 0
HOOK
  chmod +x "$target/scripts/test-validate-hook.sh"
  printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$target/.score-loop/state/tribunal-publisher.json"
  printf '{"schemaVersion":1,"events":{}}\n' > "$target/.score-loop/state/tribunal-triage-events.json"
}

cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "FAILED", "tribunalVersion": 8 }
}
JSON

out="$(cd "$runtime" && TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 1' <<<"$out" || fail "dry-run should report one publishable PASS"
grep -q 'FAILED metadata: 1' <<<"$out" || fail "dry-run should report one FAILED article"
jq -e '. == {"schemaVersion": 1, "entries": {}, "batches": {}}' "$runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
  || fail "missing publisher state should initialize with the default shape"
jq -e '. == {"schemaVersion": 1, "events": {}}' "$runtime/.score-loop/state/tribunal-triage-events.json" >/dev/null \
  || fail "missing triage state should initialize with the default shape"
pass "dry-run reports counts and initializes missing runtime ledgers"

already_on_main_runtime="$TMP/already-on-main-runtime"
setup_reconciliation_runtime "$already_on_main_runtime"
cp "$already_on_main_runtime/src/content/posts/gp-1-test.mdx" \
  "$already_on_main_runtime/src/content/posts/gp-3-test.mdx"
already_on_main_pre_fetch_sha="$(git -C "$already_on_main_runtime" rev-parse origin/main)"
printf 'fresh main marker\n' > "$seed/publisher-main-marker.txt"
git -C "$seed" add publisher-main-marker.txt
git -C "$seed" commit -m "advance main without article changes" >/dev/null
git -C "$seed" push origin HEAD:main >/dev/null 2>&1
already_on_main_fresh_sha="$(git --git-dir="$origin" rev-parse refs/heads/main)"
[ "$already_on_main_pre_fetch_sha" != "$already_on_main_fresh_sha" ] \
  || fail "mainCommit fixture must start from a stale runtime origin/main ref"
cat > "$already_on_main_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-3-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
cat > "$already_on_main_runtime/.score-loop/state/tribunal-publisher.json" <<'JSON'
{
  "schemaVersion": 1,
  "entries": {
    "gp-1-test.mdx": {
      "publishState": "ready_for_batch",
      "batchId": "stale-batch",
      "prNumber": 41,
      "mergeCommit": "stale-merge",
      "mergedAt": "2026-05-20T00:00:00Z",
      "branch": "publisher/stale"
    },
    "gp-2-test.mdx": {
      "publishState": "ready_for_batch",
      "batchId": "stale-batch",
      "prNumber": 42,
      "mergeCommit": "stale-merge",
      "mergedAt": "2026-05-20T00:00:00Z",
      "branch": "publisher/stale"
    }
  },
  "batches": {}
}
JSON
already_on_main_gh="$TMP/already-on-main-gh"
already_on_main_gh_log="$TMP/already-on-main-gh.log"
cat > "$already_on_main_gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_CALL_LOG"
exit 70
GH
chmod +x "$already_on_main_gh"
empty_batch_dir="$TMP/already-on-main-worktree"
empty_batch_branch="publisher/already-on-main"
empty_batch_out="$(cd "$already_on_main_runtime" && \
  GH_BIN="$already_on_main_gh" \
  GH_CALL_LOG="$already_on_main_gh_log" \
  GU_LOG_GH_TOKEN_FILE="$TMP/already-on-main-missing-token" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$already_on_main_runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --push-pr --max 2 \
    --branch "$empty_batch_branch" --worktree "$empty_batch_dir")"
grep -q 'Selected artifacts already match origin/main' <<<"$empty_batch_out" \
  || fail "empty batch should report already-materialized PASS artifacts"
[ ! -e "$empty_batch_dir" ] \
  || fail "already-materialized PASS artifacts should not leave a publisher worktree"
git -C "$already_on_main_runtime" show-ref --verify --quiet "refs/heads/$empty_batch_branch" \
  && fail "already-materialized PASS artifacts should not leave an empty branch"
git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$empty_batch_branch" \
  && fail "already-materialized PASS artifacts should not push an empty branch"
[ ! -s "$already_on_main_gh_log" ] \
  || fail "already-materialized PASS artifacts should not attempt PR lifecycle"
for article in gp-1-test.mdx gp-2-test.mdx; do
  jq -e --arg article "$article" \
    --arg mainCommit "$already_on_main_fresh_sha" '
      (.entries[$article].publishState == "published")
      and (.entries[$article].publicationMethod == "already_on_main")
      and (.entries[$article].mainCommit == $mainCommit)
      and (.entries[$article].updatedAt | type == "string" and test("T.*[+-][0-9]{2}:[0-9]{2}$"))
      and (.entries[$article] | has("batchId") | not)
      and (.entries[$article] | has("prNumber") | not)
      and (.entries[$article] | has("mergeCommit") | not)
      and (.entries[$article] | has("mergedAt") | not)
      and (.entries[$article] | has("branch") | not)
    ' "$already_on_main_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
    || fail "already-materialized $article should have terminal provenance without stale lifecycle metadata"
done
[ "$(git -C "$already_on_main_runtime" rev-parse origin/main)" = "$already_on_main_fresh_sha" ] \
  || fail "publisher apply should refresh the runtime clone to the new origin/main"
jq -e '.batches == {}' "$already_on_main_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
  || fail "already-materialized PASS artifacts must not create a synthetic batch"
empty_batch_retry_out="$(cd "$already_on_main_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$already_on_main_runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --max 2 \
    --branch "$empty_batch_branch-retry" --worktree "$empty_batch_dir-retry")"
grep -q 'selected gp-3-test.mdx' <<<"$empty_batch_retry_out" \
  || fail "the next apply should select the changed artifact behind reconciled entries"
[ ! -e "$empty_batch_dir-retry" ] \
  || fail "normal changed-artifact cleanup should remove its publisher worktree"
git -C "$already_on_main_runtime" show-ref --verify --quiet "refs/heads/$empty_batch_branch-retry" \
  || fail "the changed artifact behind reconciled entries should enter normal batch lifecycle"
[ "$(jq -r '.entries["gp-3-test.mdx"].publishState' \
  "$already_on_main_runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] \
  || fail "the changed artifact behind reconciled entries should reserve normal batch state"
pass "already-materialized PASS artifacts reconcile once without starving later batches"

mixed_runtime="$TMP/publisher-mixed-runtime"
mixed_worktree="$TMP/publisher-mixed-worktree"
mixed_branch="publisher/mixed-diff"
setup_reconciliation_runtime "$mixed_runtime"
cat > "$mixed_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
printf 'Runtime en-only mixed-batch rewrite.\n' \
  >> "$mixed_runtime/src/content/posts/en-gp-2-test.mdx"
mixed_out="$(cd "$mixed_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$mixed_runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --max 2 \
    --branch "$mixed_branch" --worktree "$mixed_worktree")"
for article in gp-1-test.mdx gp-2-test.mdx; do
  grep -q "selected $article" <<<"$mixed_out" \
    || fail "mixed batch should select both unchanged and changed candidates"
  [ "$(jq -r --arg article "$article" '.entries[$article].publishState' \
    "$mixed_runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] \
    || fail "mixed batch candidate $article should enter normal batch lifecycle"
  jq -e --arg article "$article" \
    '.entries[$article] | has("publicationMethod") | not' \
    "$mixed_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
    || fail "mixed batch candidate $article must not use already-on-main provenance"
done
mixed_batch_id="$(jq -r '.entries["gp-1-test.mdx"].batchId' \
  "$mixed_runtime/.score-loop/state/tribunal-publisher.json")"
if [ -z "$mixed_batch_id" ] || [ "$mixed_batch_id" = "null" ]; then
  fail "mixed batch should reserve one real batchId"
fi
jq -e --arg batchId "$mixed_batch_id" '
  (.entries["gp-2-test.mdx"].batchId == $batchId)
  and ((.batches[$batchId].entries | sort) == ["gp-1-test.mdx", "gp-2-test.mdx"])
' "$mixed_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
  || fail "mixed candidates should share one normal batch record"
[ ! -e "$mixed_worktree" ] \
  || fail "mixed batch cleanup should remove its publisher worktree"
git -C "$mixed_runtime" show-ref --verify --quiet "refs/heads/$mixed_branch" \
  || fail "mixed batch should preserve the committed normal lifecycle branch"
pass "one changed sidecar keeps the entire mixed selection in normal batch lifecycle"

queue_runtime="$TMP/publisher-limit-runtime"
setup_reconciliation_runtime "$queue_runtime"
jq -n '
  {
    "gp-1-test.mdx": {status: "PASS", tribunalVersion: 8},
    "gp-2-test.mdx": {status: "PASS", tribunalVersion: 8}
  }
  + reduce range(1; 13) as $n ({};
      .["zz-queued-\($n).mdx"] = {status: "PASS", tribunalVersion: 8}
    )
' > "$queue_runtime/.score-loop/state/tribunal-progress.json"
queue_report_before="$(cd "$queue_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  bash scripts/tribunal-publisher.sh --dry-run --max 2)"
grep -q 'publishable PASS: 14' <<<"$queue_report_before" \
  || fail "dry-run should count the complete queue even when report display is bounded"
queue_branch="publisher/collector-limit"
queue_worktree="$TMP/publisher-limit-worktree"
queue_apply_out="$(cd "$queue_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$queue_runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --max 2 \
    --branch "$queue_branch" --worktree "$queue_worktree" 2>&1)"
grep -q 'Broken pipe' <<<"$queue_apply_out" \
  && fail "collector-owned MAX_BATCH stopping must not produce Broken pipe"
for article in gp-1-test.mdx gp-2-test.mdx; do
  [ "$(jq -r --arg article "$article" '.entries[$article].publishState' \
    "$queue_runtime/.score-loop/state/tribunal-publisher.json")" = "published" ] \
    || fail "deterministic MAX_BATCH selection should process $article"
done
jq -e '.entries | has("zz-queued-1.mdx") | not' \
  "$queue_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
  || fail "collector must leave entries beyond MAX_BATCH for a later run"
queue_report_after="$(cd "$queue_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  bash scripts/tribunal-publisher.sh --dry-run --max 2)"
grep -q 'publishable PASS: 12' <<<"$queue_report_after" \
  || fail "dry-run should retain a complete count of entries beyond MAX_BATCH"
pass "collector enforces MAX_BATCH without SIGPIPE while dry-run counts the full queue"

for changed_side in zh en; do
  sidecar_runtime="$TMP/publisher-sidecar-$changed_side-runtime"
  sidecar_worktree="$TMP/publisher-sidecar-$changed_side-worktree"
  sidecar_branch="publisher/sidecar-$changed_side"
  setup_reconciliation_runtime "$sidecar_runtime"
  cat > "$sidecar_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
  if [ "$changed_side" = "zh" ]; then
    printf 'Runtime zh-only rewrite.\n' >> "$sidecar_runtime/src/content/posts/gp-1-test.mdx"
  else
    printf 'Runtime en-only rewrite.\n' >> "$sidecar_runtime/src/content/posts/en-gp-1-test.mdx"
  fi
  sidecar_out="$(cd "$sidecar_runtime" && \
    TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
    TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
    TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$sidecar_runtime/scripts/test-validate-hook.sh" \
    bash scripts/tribunal-publisher.sh --apply --max 1 \
      --branch "$sidecar_branch" --worktree "$sidecar_worktree")"
  grep -q 'selected gp-1-test.mdx' <<<"$sidecar_out" \
    || fail "$changed_side-only sidecar diff should enter normal batch lifecycle"
  [ "$(jq -r '.entries["gp-1-test.mdx"].publishState' \
    "$sidecar_runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] \
    || fail "$changed_side-only sidecar diff must not use already-on-main reconciliation"
  jq -e '.entries["gp-1-test.mdx"] | has("publicationMethod") | not' \
    "$sidecar_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
    || fail "$changed_side-only sidecar diff must not record already-on-main provenance"
done
pass "a diff in either zh-tw or en sidecar preserves normal batch lifecycle"

invalid_identical_runtime="$TMP/publisher-invalid-identical-runtime"
invalid_identical_worktree="$TMP/publisher-invalid-identical-worktree"
invalid_identical_branch="publisher/invalid-identical"
setup_reconciliation_runtime "$invalid_identical_runtime"
cat > "$invalid_identical_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
invalid_identical_out="$(cd "$invalid_identical_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$invalid_identical_runtime/scripts/test-validate-hook.sh" \
  TRIBUNAL_PUBLISHER_FORCE_INVALID="gp-1-test.mdx" \
  bash scripts/tribunal-publisher.sh --apply --max 1 \
    --branch "$invalid_identical_branch" --worktree "$invalid_identical_worktree")"
grep -q 'validation_blocked gp-1-test.mdx' <<<"$invalid_identical_out" \
  || fail "invalid identical artifact should remain validation_blocked"
jq -e '.entries["gp-1-test.mdx"] | has("publishState") | not' \
  "$invalid_identical_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
  || fail "invalid identical artifact must not be reconciled as published"
[ ! -e "$invalid_identical_worktree" ] \
  || fail "invalid identical artifact should stop before worktree materialization"
git -C "$invalid_identical_runtime" show-ref --verify --quiet "refs/heads/$invalid_identical_branch" \
  && fail "invalid identical artifact should stop before branch creation"
pass "validation remains authoritative before already-on-main reconciliation"

transaction_bin="$TMP/publisher-transaction-bin"
mkdir -p "$transaction_bin"
transaction_real_jq="$(command -v jq)"
transaction_real_mv="$(command -v mv)"
cat > "$transaction_bin/jq" <<'JQ'
#!/usr/bin/env bash
set -euo pipefail
is_reconciliation_write=0
previous=""
for argument in "$@"; do
  if [ "$previous" = "--arg" ] && [ "$argument" = "mainCommit" ]; then
    is_reconciliation_write=1
    break
  fi
  previous="$argument"
done
if [ "$is_reconciliation_write" -eq 1 ]; then
  case "$TRANSACTION_FAILURE_STAGE" in
    candidate-write)
      exit 71
      ;;
    candidate-validation)
      printf '{}\n'
      exit 0
      ;;
  esac
fi
exec "$TRANSACTION_REAL_JQ" "$@"
JQ
chmod +x "$transaction_bin/jq"
cat > "$transaction_bin/mv" <<'MV'
#!/usr/bin/env bash
set -euo pipefail
if [ "$TRANSACTION_FAILURE_STAGE" = "final-rename" ] &&
   [[ "$1" == *tribunal-publisher.json.reconcile.* ]] &&
   [[ "$2" == *tribunal-publisher.json ]]; then
  exit 73
fi
exec "$TRANSACTION_REAL_MV" "$@"
MV
chmod +x "$transaction_bin/mv"

for transaction_failure_stage in candidate-write candidate-validation final-rename; do
  transaction_runtime="$TMP/publisher-transaction-$transaction_failure_stage-runtime"
  transaction_worktree="$TMP/publisher-transaction-$transaction_failure_stage-worktree"
  transaction_branch="publisher/transaction-$transaction_failure_stage"
  transaction_gh_log="$TMP/publisher-transaction-$transaction_failure_stage-gh.log"
  transaction_before="$TMP/publisher-transaction-$transaction_failure_stage.before"
  setup_reconciliation_runtime "$transaction_runtime"
  cat > "$transaction_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
  cat > "$transaction_runtime/.score-loop/state/tribunal-publisher.json" <<'JSON'
{
  "schemaVersion": 1,
  "entries": {
    "gp-1-test.mdx": {"publishState": "ready_for_batch", "sentinel": "byte-identical"}
  },
  "batches": {}
}
JSON
  cp "$transaction_runtime/.score-loop/state/tribunal-publisher.json" \
    "$transaction_before"
  if transaction_out="$(cd "$transaction_runtime" && \
    PATH="$transaction_bin:$PATH" \
    TRANSACTION_FAILURE_STAGE="$transaction_failure_stage" \
    TRANSACTION_REAL_JQ="$transaction_real_jq" \
    TRANSACTION_REAL_MV="$transaction_real_mv" \
    GH_BIN="$already_on_main_gh" \
    GH_CALL_LOG="$transaction_gh_log" \
    GU_LOG_GH_TOKEN_FILE="$TMP/transaction-missing-token" \
    TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
    TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
    TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$transaction_runtime/scripts/test-validate-hook.sh" \
    bash scripts/tribunal-publisher.sh --apply --push-pr --max 1 \
      --branch "$transaction_branch" --worktree "$transaction_worktree" 2>&1)"; then
    fail "publisher must return nonzero for $transaction_failure_stage ledger failure"
  fi
  cmp -s "$transaction_before" \
    "$transaction_runtime/.score-loop/state/tribunal-publisher.json" \
    || fail "$transaction_failure_stage must preserve the original ledger byte-for-byte"
  if find "$transaction_runtime/.score-loop/state" -maxdepth 1 \
    -name 'tribunal-publisher.json.reconcile.*' -print -quit | grep -q .; then
    fail "$transaction_failure_stage must clean its same-directory temp file"
  fi
  [ ! -e "$transaction_worktree" ] \
    || fail "$transaction_failure_stage should clean the no-diff worktree"
  git -C "$transaction_runtime" show-ref --verify --quiet "refs/heads/$transaction_branch" \
    && fail "$transaction_failure_stage should not leave a publisher branch"
  git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$transaction_branch" \
    && fail "$transaction_failure_stage should not push a publisher branch"
  [ ! -s "$transaction_gh_log" ] \
    || fail "$transaction_failure_stage should stop before PR lifecycle"
  grep -q 'publisher ledger' <<<"$transaction_out" \
    || fail "publisher should explain the $transaction_failure_stage ledger failure"

  transaction_retry_out="$(cd "$transaction_runtime" && \
    PATH="$transaction_bin:$PATH" \
    TRANSACTION_FAILURE_STAGE="none" \
    TRANSACTION_REAL_JQ="$transaction_real_jq" \
    TRANSACTION_REAL_MV="$transaction_real_mv" \
    TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
    TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
    TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$transaction_runtime/scripts/test-validate-hook.sh" \
    bash scripts/tribunal-publisher.sh --apply --max 1 \
      --branch "$transaction_branch" --worktree "$transaction_worktree")"
  grep -q 'Selected artifacts already match origin/main' <<<"$transaction_retry_out" \
    || fail "$transaction_failure_stage should leave the entry retryable"
  jq -e '
    .entries["gp-1-test.mdx"].publishState == "published"
    and .entries["gp-1-test.mdx"].publicationMethod == "already_on_main"
  ' "$transaction_runtime/.score-loop/state/tribunal-publisher.json" >/dev/null \
    || fail "$transaction_failure_stage retry should reconcile the same entry"
done
pass "all ledger transaction stages fail atomically, clean up, and remain retryable"

setup_batch_validation_runtime() {
  local target="$1"
  git clone "$origin" "$target" >/dev/null 2>&1
  git -C "$target" checkout -b tribunal-validation-runtime origin/main >/dev/null 2>&1
  git -C "$target" config user.email test@example.invalid
  git -C "$target" config user.name "Runtime"
  mkdir -p "$target/scripts" "$target/.score-loop/state"
  cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$target/scripts/tribunal-publisher.sh"
  cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$target/scripts/tribunal-helpers.sh"
  chmod +x "$target/scripts/tribunal-publisher.sh"
  cat > "$target/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
  printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$target/.score-loop/state/tribunal-publisher.json"
  printf '{"schemaVersion":1,"events":{}}\n' > "$target/.score-loop/state/tribunal-triage-events.json"
  printf 'Runtime validation rewrite one.\n' >> "$target/src/content/posts/gp-1-test.mdx"
  printf 'Runtime validation rewrite one en.\n' >> "$target/src/content/posts/en-gp-1-test.mdx"
  printf 'Runtime validation rewrite two.\n' >> "$target/src/content/posts/gp-2-test.mdx"
  printf 'Runtime validation rewrite two en.\n' >> "$target/src/content/posts/en-gp-2-test.mdx"
}

batch_validation_runtime="$TMP/batch-validation-runtime"
batch_validation_bin="$TMP/batch-validation-bin"
batch_validation_log="$TMP/batch-validation.log"
batch_validation_worktree="$TMP/batch-validation-worktree"
validation_real_node="$(command -v node)"
setup_batch_validation_runtime "$batch_validation_runtime"
mkdir -p "$batch_validation_bin"
cat > "$batch_validation_bin/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  */scripts/validate-posts.mjs) printf '%s\n' "$*" >> "$VALIDATE_NODE_LOG" ;;
  *) exec "$VALIDATE_REAL_NODE" "$@" ;;
esac
NODE
chmod +x "$batch_validation_bin/node"

batch_validation_out="$(cd "$batch_validation_runtime" && \
  PATH="$batch_validation_bin:$PATH" \
  VALIDATE_NODE_LOG="$batch_validation_log" \
  VALIDATE_REAL_NODE="$validation_real_node" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  bash scripts/tribunal-publisher.sh --apply --max 10 \
    --branch publisher/batch-validation-fast-path \
    --worktree "$batch_validation_worktree")"
batch_validation_calls="$(wc -l < "$batch_validation_log" | tr -d ' ')"
[ "$batch_validation_calls" = "1" ] \
  || fail "valid batch should invoke validate-posts exactly once (got $batch_validation_calls: $(tr '\n' ';' < "$batch_validation_log"))"
for expected in gp-1-test.mdx en-gp-1-test.mdx gp-2-test.mdx en-gp-2-test.mdx; do
  grep -qw "$expected" "$batch_validation_log" \
    || fail "batch validation argv should include $expected"
done
grep -q 'selected gp-1-test.mdx' <<<"$batch_validation_out" \
  || fail "batch validation fast path should select gp-1"
grep -q 'selected gp-2-test.mdx' <<<"$batch_validation_out" \
  || fail "batch validation fast path should select gp-2"
pass "valid candidates use one batched validate-posts invocation"

fallback_validation_runtime="$TMP/fallback-validation-runtime"
fallback_validation_bin="$TMP/fallback-validation-bin"
fallback_validation_log="$TMP/fallback-validation.log"
fallback_validation_worktree="$TMP/fallback-validation-worktree"
setup_batch_validation_runtime "$fallback_validation_runtime"
mkdir -p "$fallback_validation_bin"
cat > "$fallback_validation_bin/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  */scripts/validate-posts.mjs) ;;
  *) exec "$VALIDATE_REAL_NODE" "$@" ;;
esac
printf '%s\n' "$*" >> "$VALIDATE_NODE_LOG"
if [ "$#" -gt 3 ]; then
  exit 1
fi
case " $* " in
  *" gp-2-test.mdx "*) exit 1 ;;
esac
NODE
chmod +x "$fallback_validation_bin/node"

fallback_validation_out="$(cd "$fallback_validation_runtime" && \
  PATH="$fallback_validation_bin:$PATH" \
  VALIDATE_NODE_LOG="$fallback_validation_log" \
  VALIDATE_REAL_NODE="$validation_real_node" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  bash scripts/tribunal-publisher.sh --apply --max 10 \
    --branch publisher/batch-validation-fallback \
    --worktree "$fallback_validation_worktree")"
[ "$(wc -l < "$fallback_validation_log" | tr -d ' ')" = "3" ] \
  || fail "failed batch validation should retry each candidate exactly once"
grep -q 'validation_blocked gp-2-test.mdx' <<<"$fallback_validation_out" \
  || fail "fallback validation should isolate the invalid candidate"
grep -q 'selected gp-1-test.mdx' <<<"$fallback_validation_out" \
  || fail "fallback validation should keep the valid candidate"
grep -q 'selected gp-2-test.mdx' <<<"$fallback_validation_out" \
  && fail "fallback validation must not select the invalid candidate"
[ "$(jq -r '[.events[] | select(.kind=="validation_blocked")] | length' \
  "$fallback_validation_runtime/.score-loop/state/tribunal-triage-events.json")" = "1" ] \
  || fail "fallback validation should record exactly one validation_blocked event"
pass "failed batch validation falls back to per-candidate isolation"

fetch_runtime="$TMP/fetch-runtime"
fetch_batch_dir="$TMP/fetch-failure-batch"
fetch_branch="publisher/fetch-must-succeed"
fetch_gh_log="$TMP/fetch-failure-gh.log"
git clone "$origin" "$fetch_runtime" >/dev/null 2>&1
git -C "$fetch_runtime" checkout -b tribunal-fetch-runtime origin/main >/dev/null 2>&1
git -C "$fetch_runtime" config user.email test@example.invalid
git -C "$fetch_runtime" config user.name "Runtime"
mkdir -p "$fetch_runtime/scripts" "$fetch_runtime/.score-loop/state"
cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$fetch_runtime/scripts/tribunal-publisher.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$fetch_runtime/scripts/tribunal-helpers.sh"
chmod +x "$fetch_runtime/scripts/tribunal-publisher.sh"
cat > "$fetch_runtime/scripts/test-validate-hook.sh" <<'HOOK'
#!/usr/bin/env bash
exit 0
HOOK
chmod +x "$fetch_runtime/scripts/test-validate-hook.sh"
cat > "$fetch_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$fetch_runtime/.score-loop/state/tribunal-publisher.json"
printf '{"schemaVersion":1,"events":{}}\n' > "$fetch_runtime/.score-loop/state/tribunal-triage-events.json"
printf 'Runtime rewrite must not publish from a stale cached ref.\n' >> "$fetch_runtime/src/content/posts/gp-1-test.mdx"
cp "$fetch_runtime/.score-loop/state/tribunal-publisher.json" "$TMP/fetch-publisher-state.before"
git -C "$fetch_runtime" remote set-url origin "$TMP/missing-origin.git"

if fetch_failure_out="$(cd "$fetch_runtime" && \
  GH_BIN="$already_on_main_gh" \
  GH_CALL_LOG="$fetch_gh_log" \
  GU_LOG_GH_TOKEN_FILE="$TMP/fetch-missing-token" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$fetch_runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --push-pr --max 10 \
    --branch "$fetch_branch" --worktree "$fetch_batch_dir" 2>&1)"; then
  fail "publisher must reject apply when origin/main cannot be refreshed"
fi
[ ! -e "$fetch_batch_dir" ] || fail "failed origin/main refresh must not create a publisher worktree"
git -C "$fetch_runtime" show-ref --verify --quiet "refs/heads/$fetch_branch" \
  && fail "failed origin/main refresh must not create a publisher branch"
git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$fetch_branch" \
  && fail "failed origin/main refresh must not push a publisher branch"
[ ! -s "$fetch_gh_log" ] \
  || fail "failed origin/main refresh must stop before PR lifecycle"
cmp -s "$TMP/fetch-publisher-state.before" "$fetch_runtime/.score-loop/state/tribunal-publisher.json" \
  || fail "failed origin/main refresh must not reserve publisher state"
grep -q 'origin/main' <<<"$fetch_failure_out" || fail "publisher should explain the failed origin/main refresh"
pass "apply fails closed before branch, worktree, or state reservation when origin/main refresh fails"

auth_runtime="$TMP/auth-runtime"
auth_publisher_state="$TMP/auth-publisher-state.json"
auth_triage_state="$TMP/auth-triage-state.json"
auth_validate_sentinel="$TMP/auth-validate-ran"
auth_gh_log="$TMP/auth-gh.log"
auth_progress_before="$TMP/auth-progress.before"
auth_fake_gh="$TMP/auth-fake-gh"
auth_missing_token="$TMP/auth-missing-token"
git clone "$origin" "$auth_runtime" >/dev/null 2>&1
git -C "$auth_runtime" checkout -b tribunal-auth-runtime origin/main >/dev/null 2>&1
git -C "$auth_runtime" config user.email test@example.invalid
git -C "$auth_runtime" config user.name "Runtime"
mkdir -p "$auth_runtime/scripts" "$auth_runtime/.score-loop/state"
cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$auth_runtime/scripts/tribunal-publisher.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$auth_runtime/scripts/tribunal-helpers.sh"
chmod +x "$auth_runtime/scripts/tribunal-publisher.sh"
cat > "$auth_runtime/scripts/test-validate-hook.sh" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
: > "$TRIBUNAL_PUBLISHER_VALIDATE_SENTINEL"
HOOK
chmod +x "$auth_runtime/scripts/test-validate-hook.sh"
cat > "$auth_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
printf 'Runtime rewrite must not publish without a verified conflict snapshot.\n' >> "$auth_runtime/src/content/posts/gp-1-test.mdx"
cp "$auth_runtime/.score-loop/state/tribunal-progress.json" "$auth_progress_before"
cat > "$auth_fake_gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_CALL_LOG"
echo "not authenticated" >&2
exit 1
GH
chmod +x "$auth_fake_gh"

for auth_mode in apply-only push-pr; do
  auth_batch_dir="$TMP/auth-failure-batch-$auth_mode"
  auth_branch="publisher/github-scan-must-succeed-$auth_mode"
  auth_args=(--apply --max 10 --branch "$auth_branch" --worktree "$auth_batch_dir")
  if [ "$auth_mode" = "push-pr" ]; then
    auth_args+=(--push-pr)
  fi

  if auth_failure_out="$(cd "$auth_runtime" && \
    env -u GU_LOG_GH_TOKEN \
    GH_BIN="$auth_fake_gh" \
    GH_CALL_LOG="$auth_gh_log" \
    GU_LOG_GH_TOKEN_FILE="$auth_missing_token" \
    PUBLISHER_STATE_FILE="$auth_publisher_state" \
    TRIAGE_EVENTS_FILE="$auth_triage_state" \
    TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
    TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$auth_runtime/scripts/test-validate-hook.sh" \
    TRIBUNAL_PUBLISHER_VALIDATE_SENTINEL="$auth_validate_sentinel" \
    bash scripts/tribunal-publisher.sh "${auth_args[@]}" 2>&1)"; then
    fail "publisher must reject $auth_mode when the GitHub conflict snapshot cannot be read"
  fi
  [ ! -e "$auth_publisher_state" ] || fail "failed GitHub preflight must not initialize publisher state"
  [ ! -e "$auth_triage_state" ] || fail "failed GitHub preflight must not initialize triage state"
  [ ! -e "$auth_validate_sentinel" ] || fail "failed GitHub preflight must not validate candidates"
  [ ! -e "$auth_batch_dir" ] || fail "failed GitHub preflight must not create a publisher worktree"
  git -C "$auth_runtime" show-ref --verify --quiet "refs/heads/$auth_branch" \
    && fail "failed GitHub preflight must not create a publisher branch"
  git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$auth_branch" \
    && fail "failed GitHub preflight must not push a publisher branch"
  cmp -s "$auth_progress_before" "$auth_runtime/.score-loop/state/tribunal-progress.json" \
    || fail "failed GitHub preflight must not mutate progress state"
  grep -q 'pulls?state=open&per_page=100' "$auth_gh_log" \
    || fail "publisher must verify conflict-scan access with a paginated PR list request"
  grep -q '^pr create ' "$auth_gh_log" && fail "failed GitHub preflight must stop before PR creation"
  grep -q 'GitHub conflict snapshot' <<<"$auth_failure_out" || fail "publisher should explain the failed GitHub conflict snapshot"
done
pass "GitHub conflict scan fails closed before ledger, validation, branch, worktree, or push mutations"

recovery_branch="publisher/pr-create-recovery"
recovery_batch_dir="$TMP/pr-create-recovery-worktree"
: > "$auth_gh_log"
recovery_out="$(cd "$auth_runtime" && \
  env -u GU_LOG_GH_TOKEN \
  GH_BIN="$auth_fake_gh" \
  GH_CALL_LOG="$auth_gh_log" \
  GU_LOG_GH_TOKEN_FILE="$auth_missing_token" \
  PUBLISHER_STATE_FILE="$auth_publisher_state" \
  TRIAGE_EVENTS_FILE="$auth_triage_state" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$auth_runtime/scripts/test-validate-hook.sh" \
  TRIBUNAL_PUBLISHER_VALIDATE_SENTINEL="$auth_validate_sentinel" \
  bash scripts/tribunal-publisher.sh --apply --push-pr --max 10 --branch "$recovery_branch" --worktree "$recovery_batch_dir")"
[ ! -e "$recovery_batch_dir" ] || fail "PR creation failure after a successful push should still clean the publisher worktree"
git -C "$auth_runtime" show-ref --verify --quiet "refs/heads/$recovery_branch" \
  || fail "PR creation failure cleanup must preserve the local publisher branch"
git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$recovery_branch" \
  || fail "PR creation failure cleanup must preserve the pushed remote branch"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$auth_publisher_state")" = "branch_pushed" ] \
  || fail "PR creation failure after push must leave a branch_pushed recovery checkpoint"
grep -q '^pr create ' "$auth_gh_log" || fail "publisher should attempt PR creation after a successful push"
grep -Fq "worktree removed: $recovery_batch_dir" <<<"$recovery_out" \
  || fail "publisher should report cleanup after a recoverable PR creation failure"
pass "PR creation failure cleans the worktree while preserving local, remote, and ledger recovery state"

printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$auth_publisher_state"
printf '{"schemaVersion":1,"events":{}}\n' > "$auth_triage_state"
cat > "$auth_runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
cat > "$origin/hooks/pre-receive" <<'HOOK'
#!/usr/bin/env bash
exit 1
HOOK
chmod +x "$origin/hooks/pre-receive"
git --git-dir="$origin" config core.hooksPath "$origin/hooks"
push_failure_branch="publisher/push-failure-preserves"
push_failure_batch_dir="$TMP/push-failure-worktree"
if push_failure_out="$(cd "$auth_runtime" && \
  PUBLISHER_STATE_FILE="$auth_publisher_state" \
  TRIAGE_EVENTS_FILE="$auth_triage_state" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_SKIP_BUILD=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$auth_runtime/scripts/test-validate-hook.sh" \
  TRIBUNAL_PUBLISHER_VALIDATE_SENTINEL="$auth_validate_sentinel" \
  bash scripts/tribunal-publisher.sh --apply --push-pr --max 10 --branch "$push_failure_branch" --worktree "$push_failure_batch_dir" 2>&1)"; then
  fail "publisher must return nonzero when the batch branch push fails"
fi
[ -e "$push_failure_batch_dir/.git" ] || fail "push failure must preserve the publisher worktree for recovery"
git -C "$auth_runtime" show-ref --verify --quiet "refs/heads/$push_failure_branch" \
  || fail "push failure must preserve the local publisher branch"
git --git-dir="$origin" show-ref --verify --quiet "refs/heads/$push_failure_branch" \
  && fail "a rejected push must not create the remote publisher branch"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$auth_publisher_state")" = "batch_selected" ] \
  || fail "push failure must preserve batch_selected instead of claiming branch_pushed"
grep -Fq "worktree removed: $push_failure_batch_dir" <<<"$push_failure_out" \
  && fail "push failure must not claim that it cleaned the recovery worktree"
git -C "$auth_runtime" worktree remove "$push_failure_batch_dir" --force
rm -f "$origin/hooks/pre-receive"
git --git-dir="$origin" config --unset core.hooksPath
pass "push failure returns nonzero and preserves the local worktree, branch, and honest ledger state"

printf 'Runtime rewritten one.\n' >> "$runtime/src/content/posts/gp-1-test.mdx"
printf 'Runtime rewritten one en.\n' >> "$runtime/src/content/posts/en-gp-1-test.mdx"

batch_dir="$TMP/batch-worktree"
apply_out="$(cd "$runtime" && TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 TRIBUNAL_PUBLISHER_SKIP_BUILD=1 TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" bash scripts/tribunal-publisher.sh --apply --max 10 --branch publisher/test-batch --worktree "$batch_dir")"

[ ! -e "$batch_dir" ] || fail "default apply should remove the publisher worktree after committing"
git -C "$runtime" show-ref --verify --quiet "refs/heads/publisher/test-batch" \
  || fail "default cleanup must preserve the local publisher branch"
grep -q 'selected gp-1-test.mdx' <<<"$apply_out" || fail "apply should select PASS article"
grep -q 'publishState' "$runtime/.score-loop/state/tribunal-publisher.json" || fail "publisher state file missing"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] || fail "PASS article should move to batch_selected"
git -C "$runtime" show "publisher/test-batch:src/content/posts/gp-1-test.mdx" | grep -q 'Runtime rewritten one.' \
  || fail "publisher branch should contain the runtime artifact after worktree cleanup"
git -C "$runtime" show "publisher/test-batch:src/content/posts/en-gp-1-test.mdx" | grep -q 'Runtime rewritten one en.' \
  || fail "publisher branch should contain the runtime EN artifact after worktree cleanup"
grep -Fq "worktree removed: $batch_dir" <<<"$apply_out" || fail "default apply should report publisher worktree cleanup"
pass "apply materializes PASS artifacts, preserves the branch, and removes the default worktree"

pr_list_json="$TMP/pr-list.json"
pr_files_dir="$TMP/pr-files"
mkdir -p "$pr_files_dir"
cat > "$pr_list_json" <<'JSON'
[
  {
    "number": 77,
    "title": "Editorial rewrite in progress",
    "headRefName": "editorial/gp-1",
    "labels": []
  }
]
JSON
cat > "$pr_files_dir/77.json" <<'JSON'
{
  "files": [
    { "path": "src/content/posts/gp-1-test.mdx" }
  ]
}
JSON
cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
out_conflict="$(cd "$runtime" && TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE="$pr_list_json" TRIBUNAL_PUBLISHER_PR_FILES_DIR="$pr_files_dir" bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'conflicted: 1' <<<"$out_conflict" || fail "dry-run should report one conflicted article"
grep -q 'publishable PASS: 1' <<<"$out_conflict" || fail "conflicted article should not block clean publishable article"
grep -q 'gp-2-test.mdx' <<<"$out_conflict" || fail "clean article should remain publishable"
grep -q 'conflict' "$runtime/.score-loop/state/tribunal-triage-events.json" || fail "conflict event should be recorded"
pass "conflict triage blocks only overlapping article and leaves clean article publishable"

cat > "$runtime/src/content/posts/gp-2-test.mdx" <<'POST'
---
ticketId: GP-2
translatedDate: 2026-05-21
---
too short
POST
batch_dir2="$TMP/batch-worktree-2"
apply_out2="$(cd "$runtime" && TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE="$pr_list_json" TRIBUNAL_PUBLISHER_PR_FILES_DIR="$pr_files_dir" TRIBUNAL_PUBLISHER_SKIP_BUILD=1 TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" TRIBUNAL_PUBLISHER_FORCE_INVALID="gp-2-test.mdx" bash scripts/tribunal-publisher.sh --apply --max 10 --branch publisher/test-batch-2 --worktree "$batch_dir2")"
grep -q 'validation_blocked gp-2-test.mdx' <<<"$apply_out2" || fail "invalid candidate should become validation_blocked"
grep -q 'selected gp-1-test.mdx' <<<"$apply_out2" && fail "conflicted article should not be selected into batch"
[ "$(jq -r '[.events[] | select(.kind=="validation_blocked")] | length' "$runtime/.score-loop/state/tribunal-triage-events.json")" = "1" ] || fail "validation_blocked event should be recorded once"
pass "candidate validation failure is isolated into triage event"

corrupt_publisher_state="$TMP/publisher-corrupt-publisher-state.json"
corrupt_publisher_before="$TMP/publisher-corrupt-publisher-state.before"
missing_triage_state="$TMP/publisher-missing-triage-state.json"
missing_progress="$TMP/publisher-missing-progress.json"
printf '{"sentinel":"publisher"\n' > "$corrupt_publisher_state"
cp "$corrupt_publisher_state" "$corrupt_publisher_before"

if corrupt_out="$(cd "$runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  PROGRESS_FILE="$missing_progress" \
  PUBLISHER_STATE_FILE="$corrupt_publisher_state" \
  TRIAGE_EVENTS_FILE="$missing_triage_state" \
  bash scripts/tribunal-publisher.sh --status 2>&1)"; then
  fail "publisher must reject corrupt publisher state"
fi
cmp -s "$corrupt_publisher_before" "$corrupt_publisher_state" || fail "publisher must not overwrite corrupt publisher state"
[ ! -e "$missing_triage_state" ] || fail "publisher must validate all ledgers before initializing a missing sibling"
[ ! -e "$missing_progress" ] || fail "publisher must validate runtime ledgers before initializing progress"
grep -q 'invalid JSON' <<<"$corrupt_out" || fail "publisher should explain corrupt publisher state"
grep -Fq "$corrupt_publisher_state" <<<"$corrupt_out" || fail "publisher should identify the corrupt publisher state path"

missing_publisher_state="$TMP/publisher-missing-publisher-state.json"
corrupt_triage_state="$TMP/publisher-corrupt-triage-state.json"
corrupt_triage_before="$TMP/publisher-corrupt-triage-state.before"
printf '{"sentinel":"triage"\n' > "$corrupt_triage_state"
cp "$corrupt_triage_state" "$corrupt_triage_before"

if corrupt_out="$(cd "$runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  PUBLISHER_STATE_FILE="$missing_publisher_state" \
  TRIAGE_EVENTS_FILE="$corrupt_triage_state" \
  bash scripts/tribunal-publisher.sh --status 2>&1)"; then
  fail "publisher must reject corrupt triage state"
fi
cmp -s "$corrupt_triage_before" "$corrupt_triage_state" || fail "publisher must not overwrite corrupt triage state"
[ ! -e "$missing_publisher_state" ] || fail "publisher must not initialize publisher state before triage preflight passes"
grep -q 'invalid JSON' <<<"$corrupt_out" || fail "publisher should explain corrupt triage state"
grep -Fq "$corrupt_triage_state" <<<"$corrupt_out" || fail "publisher should identify the corrupt triage state path"

publisher_symlink_target="$TMP/publisher-symlink-target.json"
publisher_symlink_before="$TMP/publisher-symlink-target.before"
publisher_symlink="$TMP/publisher-state-symlink.json"
valid_triage_state="$TMP/publisher-valid-triage-state.json"
printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$publisher_symlink_target"
cp "$publisher_symlink_target" "$publisher_symlink_before"
ln -s "$publisher_symlink_target" "$publisher_symlink"
printf '{"schemaVersion":1,"events":{}}\n' > "$valid_triage_state"

if symlink_out="$(cd "$runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  PUBLISHER_STATE_FILE="$publisher_symlink" \
  TRIAGE_EVENTS_FILE="$valid_triage_state" \
  bash scripts/tribunal-publisher.sh --status 2>&1)"; then
  fail "publisher must reject a symlinked runtime ledger"
fi
[ -L "$publisher_symlink" ] || fail "publisher must leave a rejected ledger symlink intact"
cmp -s "$publisher_symlink_before" "$publisher_symlink_target" || fail "publisher must not mutate a symlink target"
grep -q 'symbolic link' <<<"$symlink_out" || fail "publisher should explain a rejected ledger symlink"
grep -Fq "$publisher_symlink" <<<"$symlink_out" || fail "publisher should identify the rejected ledger symlink path"
pass "publisher preflights all runtime ledgers before mutation"

printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$runtime/.score-loop/state/tribunal-publisher.json"
printf '{"schemaVersion":1,"events":{}}\n' > "$runtime/.score-loop/state/tribunal-triage-events.json"
cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
fake_pnpm_dir="$TMP/fake-pnpm-bin"
mkdir -p "$fake_pnpm_dir"
cat > "$fake_pnpm_dir/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
touch cleanup-dirty-sentinel
PNPM
chmod +x "$fake_pnpm_dir/pnpm"
dirty_branch="publisher/dirty-cleanup-preserves"
dirty_batch_dir="$TMP/dirty-cleanup-worktree"
if dirty_cleanup_out="$(cd "$runtime" && \
  PATH="$fake_pnpm_dir:$PATH" \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" \
  bash scripts/tribunal-publisher.sh --apply --max 10 --branch "$dirty_branch" --worktree "$dirty_batch_dir" 2>&1)"; then
  fail "publisher must return nonzero rather than force-removing a dirty worktree"
fi
[ -e "$dirty_batch_dir/.git" ] || fail "unexpected dirty state must preserve the registered publisher worktree"
[ -e "$dirty_batch_dir/cleanup-dirty-sentinel" ] || fail "unexpected untracked files must survive failed cleanup"
git -C "$runtime" show-ref --verify --quiet "refs/heads/$dirty_branch" \
  || fail "dirty cleanup failure must preserve the committed publisher branch"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] \
  || fail "dirty cleanup failure must preserve the honest batch_selected checkpoint"
grep -Fq "worktree removed: $dirty_batch_dir" <<<"$dirty_cleanup_out" \
  && fail "dirty cleanup failure must not claim that it removed the worktree"
git -C "$runtime" worktree remove "$dirty_batch_dir" --force
pass "unexpected dirty state blocks cleanup without deleting the worktree or its recovery evidence"

printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$runtime/.score-loop/state/tribunal-publisher.json"
printf '{"schemaVersion":1,"events":{}}\n' > "$runtime/.score-loop/state/tribunal-triage-events.json"
cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
keep_batch_dir="$TMP/batch-worktree-kept"
keep_out="$(cd "$runtime" && TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 TRIBUNAL_PUBLISHER_SKIP_BUILD=1 TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" bash scripts/tribunal-publisher.sh --apply --keep-worktree --max 10 --branch publisher/test-batch-kept --worktree "$keep_batch_dir")"
[ -e "$keep_batch_dir/.git" ] || fail "--keep-worktree should preserve the registered publisher worktree"
grep -q 'Runtime rewritten one.' "$keep_batch_dir/src/content/posts/gp-1-test.mdx" \
  || fail "kept publisher worktree should contain the runtime artifact"
grep -Fq "worktree kept at $keep_batch_dir for inspection" <<<"$keep_out" \
  || fail "--keep-worktree should report the preserved inspection path"
git -C "$runtime" worktree remove "$keep_batch_dir" --force
pass "--keep-worktree explicitly preserves the publisher worktree for inspection"

setup_dependency_runtime() {
  local target="$1"
  git clone "$origin" "$target" >/dev/null 2>&1
  git -C "$target" checkout -b tribunal-dependency-runtime origin/main >/dev/null 2>&1
  git -C "$target" config user.email test@example.invalid
  git -C "$target" config user.name "Runtime"
  mkdir -p "$target/scripts" "$target/.score-loop/state"
  cp "$ROOT_DIR/scripts/tribunal-publisher.sh" "$target/scripts/tribunal-publisher.sh"
  cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$target/scripts/tribunal-helpers.sh"
  chmod +x "$target/scripts/tribunal-publisher.sh"
  cat > "$target/scripts/test-validate-hook.sh" <<'HOOK'
#!/usr/bin/env bash
exit 0
HOOK
  chmod +x "$target/scripts/test-validate-hook.sh"
  cat > "$target/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 }
}
JSON
  printf '{"schemaVersion":1,"entries":{},"batches":{}}\n' > "$target/.score-loop/state/tribunal-publisher.json"
  printf '{"schemaVersion":1,"events":{}}\n' > "$target/.score-loop/state/tribunal-triage-events.json"
  printf 'Runtime dependency-test rewrite.\n' >> "$target/src/content/posts/gp-1-test.mdx"
}

dependency_fake_bin="$TMP/dependency-fake-bin"
dependency_fake_pnpm="$dependency_fake_bin/pnpm"
mkdir -p "$dependency_fake_bin"
cat > "$dependency_fake_pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PNPM_CALL_LOG"
case "$1" in
  install)
    [ "$*" = "install --frozen-lockfile --prefer-offline" ] || exit 64
    if [ "$FAKE_PNPM_MODE" = "install-fail" ]; then
      exit 75
    fi
    mkdir -p node_modules/.pnpm
    cp pnpm-lock.yaml node_modules/.pnpm/lock.yaml
    ;;
  run)
    [ "$*" = "run build" ] || exit 65
    : > "$BUILD_SENTINEL"
    case "$FAKE_PNPM_MODE" in
      reuse)
        [ -L node_modules ] || exit 76
        [ "$(readlink node_modules)" = "$EXPECTED_NODE_MODULES" ] || exit 77
        ;;
      install-success)
        [ -f node_modules/.pnpm/lock.yaml ] || exit 78
        ;;
      build-fail)
        exit 79
        ;;
      actionable-build-fail)
        printf '%s\n' 'src/content/posts/gp-1-test.mdx: MDX ParseError: Unexpected token'
        exit 81
        ;;
      informational-build-fail)
        printf '%s\n' 'INFO indexed src/content/posts/gp-1-test.mdx successfully'
        printf '%s\n' 'ERROR: database connection failed'
        exit 82
        ;;
      operational-target-build-fail)
        printf '%s\n' 'src/content/posts/gp-1-test.mdx: MDX ParseError: Unexpected token'
        printf '%s\n' 'FATAL ERROR: JavaScript heap out of memory'
        exit 137
        ;;
      install-fail)
        exit 80
        ;;
    esac
    ;;
  *)
    exit 66
    ;;
esac
PNPM
chmod +x "$dependency_fake_pnpm"

run_dependency_apply() {
  local runtime="$1" pnpm_log="$2" build_sentinel="$3" mode="$4"
  local branch="$5" worktree="$6"
  (
    cd "$runtime"
    PATH="$dependency_fake_bin:$PATH" \
    PNPM_CALL_LOG="$pnpm_log" \
    BUILD_SENTINEL="$build_sentinel" \
    FAKE_PNPM_MODE="$mode" \
    EXPECTED_NODE_MODULES="$runtime/node_modules" \
    TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
    TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" \
    bash scripts/tribunal-publisher.sh --apply --max 10 \
      --branch "$branch" --worktree "$worktree"
  )
}

reuse_runtime="$TMP/dependency-reuse-runtime"
reuse_worktree="$TMP/dependency-reuse-worktree"
reuse_branch="publisher/dependency-reuse"
reuse_log="$TMP/dependency-reuse.log"
reuse_build_sentinel="$TMP/dependency-reuse-build"
setup_dependency_runtime "$reuse_runtime"
mkdir -p "$reuse_runtime/node_modules/.pnpm" "$reuse_runtime/node_modules/.bin"
cp "$reuse_runtime/pnpm-lock.yaml" "$reuse_runtime/node_modules/.pnpm/lock.yaml"
cat > "$reuse_runtime/node_modules/.bin/astro" <<'ASTRO'
#!/usr/bin/env bash
exit 0
ASTRO
chmod +x "$reuse_runtime/node_modules/.bin/astro"
if ! reuse_out="$(
  run_dependency_apply "$reuse_runtime" "$reuse_log" "$reuse_build_sentinel" \
    reuse "$reuse_branch" "$reuse_worktree"
)"; then
  fail "publisher should reuse exact installed dependencies for a clean matching batch"
fi
[ "$(wc -l < "$reuse_log" | tr -d ' ')" = "1" ] \
  || fail "exact dependency reuse should call pnpm only for the build"
grep -Fxq 'run build' "$reuse_log" || fail "exact dependency reuse should skip pnpm install"
[ -e "$reuse_build_sentinel" ] || fail "exact dependency reuse should reach the build"
grep -q 'Reusing exact runtime dependencies' <<<"$reuse_out" \
  || fail "publisher should report exact dependency reuse"
pass "matching manifests and installed lock reuse runtime dependencies without install"

install_runtime="$TMP/dependency-install-runtime"
install_worktree="$TMP/dependency-install-worktree"
install_branch="publisher/dependency-install"
install_log="$TMP/dependency-install.log"
install_build_sentinel="$TMP/dependency-install-build"
setup_dependency_runtime "$install_runtime"
mkdir -p "$install_runtime/node_modules/.pnpm" "$install_runtime/node_modules/.bin"
printf 'stale installed lock\n' > "$install_runtime/node_modules/.pnpm/lock.yaml"
cat > "$install_runtime/node_modules/.bin/astro" <<'ASTRO'
#!/usr/bin/env bash
exit 0
ASTRO
chmod +x "$install_runtime/node_modules/.bin/astro"
if ! install_out="$(
  run_dependency_apply "$install_runtime" "$install_log" "$install_build_sentinel" \
    install-success "$install_branch" "$install_worktree"
)"; then
  fail "publisher should install clean-worktree dependencies when installed lock evidence is stale"
fi
[ "$(wc -l < "$install_log" | tr -d ' ')" = "2" ] \
  || fail "stale dependency evidence should install once and build once"
sed -n '1p' "$install_log" | grep -Fxq 'install --frozen-lockfile --prefer-offline' \
  || fail "publisher should use the exact fail-closed install command"
sed -n '2p' "$install_log" | grep -Fxq 'run build' \
  || fail "publisher should build only after dependency install succeeds"
[ -e "$install_build_sentinel" ] || fail "installed dependency path should reach the build"
grep -q 'Installing clean-worktree dependencies' <<<"$install_out" \
  || fail "publisher should report clean-worktree dependency install"
pass "stale installed lock falls back to frozen prefer-offline install before build"

manifest_runtime="$TMP/dependency-manifest-runtime"
manifest_worktree="$TMP/dependency-manifest-worktree"
manifest_branch="publisher/dependency-manifest"
manifest_log="$TMP/dependency-manifest.log"
manifest_build_sentinel="$TMP/dependency-manifest-build"
setup_dependency_runtime "$manifest_runtime"
mkdir -p "$manifest_runtime/node_modules/.pnpm" "$manifest_runtime/node_modules/.bin"
cp "$manifest_runtime/pnpm-lock.yaml" "$manifest_runtime/node_modules/.pnpm/lock.yaml"
cat > "$manifest_runtime/node_modules/.bin/astro" <<'ASTRO'
#!/usr/bin/env bash
exit 0
ASTRO
chmod +x "$manifest_runtime/node_modules/.bin/astro"
printf '\n' >> "$manifest_runtime/package.json"
if ! manifest_out="$(
  run_dependency_apply "$manifest_runtime" "$manifest_log" "$manifest_build_sentinel" \
    install-success "$manifest_branch" "$manifest_worktree"
)"; then
  fail "publisher should install dependencies when root and batch manifests differ"
fi
sed -n '1p' "$manifest_log" | grep -Fxq 'install --frozen-lockfile --prefer-offline' \
  || fail "manifest mismatch must bypass dependency reuse"
grep -q 'Installing clean-worktree dependencies' <<<"$manifest_out" \
  || fail "publisher should report install after manifest mismatch"
pass "manifest mismatch bypasses runtime dependency reuse"

install_failure_runtime="$TMP/dependency-install-failure-runtime"
install_failure_worktree="$TMP/dependency-install-failure-worktree"
install_failure_branch="publisher/dependency-install-failure"
install_failure_log="$TMP/dependency-install-failure.log"
install_failure_build_sentinel="$TMP/dependency-install-failure-build"
setup_dependency_runtime "$install_failure_runtime"
if install_failure_out="$(
  run_dependency_apply "$install_failure_runtime" "$install_failure_log" \
    "$install_failure_build_sentinel" install-fail \
    "$install_failure_branch" "$install_failure_worktree" 2>&1
)"; then
  fail "publisher must fail closed when clean-worktree dependency install fails"
fi
[ ! -e "$install_failure_build_sentinel" ] \
  || fail "dependency install failure must stop before the build"
[ "$(jq '[.events[] | select(.kind=="validation_blocked")] | length' \
  "$install_failure_runtime/.score-loop/state/tribunal-triage-events.json")" = "0" ] \
  || fail "infrastructure install failure must not permanently block article validation"
[ ! -e "$install_failure_worktree" ] \
  || fail "dependency install failure should clean the disposable publisher worktree"
git -C "$install_failure_runtime" show-ref --verify --quiet "refs/heads/$install_failure_branch" \
  && fail "dependency install failure should delete the uncommitted publisher branch"
install_retry_out="$(cd "$install_failure_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 1' <<<"$install_retry_out" \
  || fail "dependency install failure must leave the article retryable"
grep -q 'Dependency install failed; publisher will retry' <<<"$install_failure_out" \
  || fail "publisher should explain retryable dependency install failure"
pass "dependency install failure stops before build and leaves PASS artifact retryable"

build_failure_runtime="$TMP/dependency-build-failure-runtime"
build_failure_worktree="$TMP/dependency-build-failure-worktree"
build_failure_branch="publisher/dependency-build-failure"
build_failure_log="$TMP/dependency-build-failure.log"
build_failure_sentinel="$TMP/dependency-build-failure-build"
setup_dependency_runtime "$build_failure_runtime"
if build_failure_out="$(
  run_dependency_apply "$build_failure_runtime" "$build_failure_log" \
    "$build_failure_sentinel" build-fail \
    "$build_failure_branch" "$build_failure_worktree" 2>&1
)"; then
  fail "publisher must fail closed when the whole-site build fails"
fi
[ -e "$build_failure_sentinel" ] || fail "build failure fixture should reach the build"
[ "$(jq '[.events[] | select(.kind=="validation_blocked")] | length' \
  "$build_failure_runtime/.score-loop/state/tribunal-triage-events.json")" = "0" ] \
  || fail "whole-site infrastructure failure must not permanently block article validation"
[ ! -e "$build_failure_worktree" ] \
  || fail "whole-site build failure should clean the disposable publisher worktree"
git -C "$build_failure_runtime" show-ref --verify --quiet "refs/heads/$build_failure_branch" \
  && fail "whole-site build failure should delete the uncommitted publisher branch"
build_retry_out="$(cd "$build_failure_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 1' <<<"$build_retry_out" \
  || fail "whole-site build failure must leave the article retryable"
grep -q 'Batch build failed; publisher will retry' <<<"$build_failure_out" \
  || fail "publisher should explain retryable whole-site build failure"
install_private_log="$(sed -n 's/.*log=\([^)]*\)).*/\1/p' <<<"$install_failure_out" | head -1)"
build_private_log="$(sed -n 's/.*log=\([^)]*\)).*/\1/p' <<<"$build_failure_out" | head -1)"
if [ -z "$install_private_log" ] || [ -z "$build_private_log" ]; then
  fail "publisher failure output should identify private diagnostic logs"
fi
[ "$install_private_log" != "$build_private_log" ] \
  || fail "separate publisher invocations must not share diagnostic logs"
if [ -e "$install_private_log" ] || [ -e "$build_private_log" ]; then
  fail "private publisher diagnostic logs should be removed on exit"
fi
pass "whole-site build failure stays fail-closed without poisoning article retry state"

actionable_runtime="$TMP/dependency-actionable-runtime"
actionable_worktree="$TMP/dependency-actionable-worktree"
actionable_branch="publisher/dependency-actionable-failure"
actionable_log="$TMP/dependency-actionable.log"
actionable_sentinel="$TMP/dependency-actionable-build"
setup_dependency_runtime "$actionable_runtime"
if actionable_out="$(
  run_dependency_apply "$actionable_runtime" "$actionable_log" \
    "$actionable_sentinel" actionable-build-fail \
    "$actionable_branch" "$actionable_worktree" 2>&1
)"; then
  fail "publisher must fail closed when the build identifies target-post MDX damage"
fi
[ "$(jq '[.events[] | select(.kind=="validation_blocked")] | length' \
  "$actionable_runtime/.score-loop/state/tribunal-triage-events.json")" = "1" ] \
  || fail "target-post MDX build evidence should create one durable validation block"
actionable_retry_out="$(cd "$actionable_runtime" && \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 0' <<<"$actionable_retry_out" \
  || fail "target-post MDX build failure must stay blocked until content is repaired"
grep -q 'blocked 1 target article' <<<"$actionable_out" \
  || fail "publisher should report the article-specific build block"
pass "target-post MDX build evidence remains a durable validation block"

for safe_failure_mode in informational-build-fail operational-target-build-fail; do
  safe_runtime="$TMP/dependency-$safe_failure_mode-runtime"
  safe_worktree="$TMP/dependency-$safe_failure_mode-worktree"
  safe_branch="publisher/dependency-$safe_failure_mode"
  safe_log="$TMP/dependency-$safe_failure_mode.log"
  safe_sentinel="$TMP/dependency-$safe_failure_mode-build"
  setup_dependency_runtime "$safe_runtime"
  if (
    run_dependency_apply "$safe_runtime" "$safe_log" "$safe_sentinel" \
      "$safe_failure_mode" "$safe_branch" "$safe_worktree" 2>&1
  ) >/dev/null; then
    fail "$safe_failure_mode must fail closed"
  fi
  [ "$(jq '[.events[] | select(.kind=="validation_blocked")] | length' \
    "$safe_runtime/.score-loop/state/tribunal-triage-events.json")" = "0" ] \
    || fail "$safe_failure_mode must not poison article retry state"
  safe_retry_out="$(cd "$safe_runtime" && \
    TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
    bash scripts/tribunal-publisher.sh --dry-run --max 10)"
  grep -q 'publishable PASS: 1' <<<"$safe_retry_out" \
    || fail "$safe_failure_mode must leave the PASS artifact retryable"
done
pass "informational target paths and operational failures never create article blocks"

failure_slug_log="$TMP/failure-slug-informational.log"
failure_slug="gp-99-error-handling.mdx"
printf 'INFO indexed src/content/posts/%s successfully\n' "$failure_slug" > "$failure_slug_log"
failure_slug_classification="$(
  source "$ROOT_DIR/scripts/tribunal-helpers.sh"
  tribunal_classify_build_failure 1 "$failure_slug_log" "$failure_slug"
)"
[ "$failure_slug_classification" = "unknown" ] \
  || fail "failure language inside a target filename must not make an informational line actionable"
pass "classifier removes exact target paths before inspecting diagnostic markers"
