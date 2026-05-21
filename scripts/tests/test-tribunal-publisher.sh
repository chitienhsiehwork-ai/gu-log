#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PUBLISHER="$ROOT_DIR/scripts/tribunal-publisher.sh"

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

cat > "$seed/src/content/posts/sp-1-test.mdx" <<'POST'
---
ticketId: SP-1
translatedDate: 2026-05-21
scores:
  tribunalVersion: 5
---
Base one.
POST
cat > "$seed/src/content/posts/en-sp-1-test.mdx" <<'POST'
---
ticketId: SP-1
translatedDate: 2026-05-21
scores:
  tribunalVersion: 5
---
Base one en.
POST
cat > "$seed/src/content/posts/sp-2-test.mdx" <<'POST'
---
ticketId: SP-2
translatedDate: 2026-05-21
scores:
  tribunalVersion: 5
---
Base two.
POST
cat > "$seed/src/content/posts/en-sp-2-test.mdx" <<'POST'
---
ticketId: SP-2
translatedDate: 2026-05-21
scores:
  tribunalVersion: 5
---
Base two en.
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
mkdir -p "$runtime/.score-loop/state"

cat > "$runtime/.score-loop/state/tribunal-progress.json" <<'JSON'
{
  "sp-1-test.mdx": { "status": "PASS", "tribunalVersion": 5 },
  "sp-2-test.mdx": { "status": "FAILED", "tribunalVersion": 5 }
}
JSON

out="$(cd "$runtime" && bash scripts/tribunal-publisher.sh --dry-run --max 10)"
grep -q 'publishable PASS: 1' <<<"$out" || fail "dry-run should report one publishable PASS"
grep -q 'FAILED metadata: 1' <<<"$out" || fail "dry-run should report one FAILED article"
pass "dry-run reports publishable and failed counts"

printf 'Runtime rewritten one.\n' >> "$runtime/src/content/posts/sp-1-test.mdx"
printf 'Runtime rewritten one en.\n' >> "$runtime/src/content/posts/en-sp-1-test.mdx"

batch_dir="$TMP/batch-worktree"
apply_out="$(cd "$runtime" && bash scripts/tribunal-publisher.sh --apply --max 10 --branch publisher/test-batch --worktree "$batch_dir")"

[ -e "$batch_dir/.git" ] || fail "apply should create publisher worktree"
grep -q 'selected sp-1-test.mdx' <<<"$apply_out" || fail "apply should select PASS article"
grep -q 'publishState' "$runtime/.score-loop/state/tribunal-publisher.json" || fail "publisher state file missing"
[ "$(jq -r '.entries["sp-1-test.mdx"].publishState' "$runtime/.score-loop/state/tribunal-publisher.json")" = "batch_selected" ] || fail "PASS article should move to batch_selected"
grep -q 'Runtime rewritten one.' "$batch_dir/src/content/posts/sp-1-test.mdx" || fail "publisher worktree should receive runtime artifact"
grep -q 'Runtime rewritten one en.' "$batch_dir/src/content/posts/en-sp-1-test.mdx" || fail "publisher worktree should receive runtime EN artifact"
pass "apply materializes PASS artifact into clean origin/main-based worktree"
