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

cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "gp-1-test.mdx": { "status": "PASS", "tribunalVersion": 8 },
  "gp-2-test.mdx": { "status": "FAILED", "tribunalVersion": 8 }
}
JSON

out="$(cd "$runtime" && TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 1' <<<"$out" || fail "dry-run should report one publishable PASS"
grep -q 'FAILED metadata: 1' <<<"$out" || fail "dry-run should report one FAILED article"
pass "dry-run reports publishable and failed counts"

printf 'Runtime rewritten one.\n' >> "$runtime/src/content/posts/gp-1-test.mdx"
printf 'Runtime rewritten one en.\n' >> "$runtime/src/content/posts/en-gp-1-test.mdx"

batch_dir="$TMP/batch-worktree"
apply_out="$(cd "$runtime" && TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 TRIBUNAL_PUBLISHER_SKIP_BUILD=1 TRIBUNAL_PUBLISHER_VALIDATE_HOOK="$runtime/scripts/test-validate-hook.sh" bash scripts/tribunal-publisher.sh --apply --max 10 --branch publisher/test-batch --worktree "$batch_dir")"

[ -e "$batch_dir/.git" ] || fail "apply should create publisher worktree"
grep -q 'selected gp-1-test.mdx' <<<"$apply_out" || fail "apply should select PASS article"
grep -q 'publishState' "$runtime/.score-loop/state/tribunal-publisher.json" || fail "publisher state file missing"
[ "$(jq -r '.entries["gp-1-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] || fail "PASS article should move to batch_selected"
grep -q 'Runtime rewritten one.' "$batch_dir/src/content/posts/gp-1-test.mdx" || fail "publisher worktree should receive runtime artifact"
grep -q 'Runtime rewritten one en.' "$batch_dir/src/content/posts/en-gp-1-test.mdx" || fail "publisher worktree should receive runtime EN artifact"
pass "apply materializes PASS artifact into clean origin/main-based worktree"

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
