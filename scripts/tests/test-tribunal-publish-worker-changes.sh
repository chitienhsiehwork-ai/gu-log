#!/usr/bin/env bash
# test-tribunal-publish-worker-changes.sh — regression tests for publishing
# worker-worktree Tribunal rewrites into the main repo before PASS commits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$ROOT_DIR/scripts/tribunal-publish-worker-changes.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "✓ $*"; }

setup_repo() {
  local repo="$1"
  mkdir -p "$repo/src/content/posts" "$repo/scores"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name "Tribunal Test"
}

main="$TMP/main"
worker="$TMP/worker"
setup_repo "$main"
setup_repo "$worker"

cat > "$main/src/content/posts/cp-999-test.mdx" <<'POST'
---
title: Original
ticketId: CP-999
lang: zh-tw
translatedDate: 2026-04-28
---

Original body.
POST
cat > "$main/src/content/posts/en-cp-999-test.mdx" <<'POST'
---
title: Original EN
ticketId: CP-999
lang: en
translatedDate: 2026-04-28
---

Original EN body.
POST
printf '{}\n' > "$main/scores/tribunal-progress.json"
git -C "$main" add . && git -C "$main" commit -q -m initial

cp -a "$main/src" "$worker/"
cp -a "$main/scores" "$worker/"
git -C "$worker" add . && git -C "$worker" commit -q -m initial

cat > "$worker/src/content/posts/cp-999-test.mdx" <<'POST'
---
title: Original
 ticketId: CP-999
lang: zh-tw
translatedDate: 2026-04-28
scores:
  tribunalVersion: 3
  vibe:
    score: 8
---

Rewritten body with Tribunal changes.
POST
cat > "$worker/src/content/posts/en-cp-999-test.mdx" <<'POST'
---
title: Original EN
ticketId: CP-999
lang: en
translatedDate: 2026-04-28
scores:
  tribunalVersion: 3
  vibe:
    score: 8
---

Rewritten EN body with Tribunal changes.
POST

bash "$HELPER" "$worker" "$main" "cp-999-test.mdx"

grep -q 'Rewritten body with Tribunal changes' "$main/src/content/posts/cp-999-test.mdx" \
  || fail "zh post rewrite was not copied from worker to main"
grep -q 'Rewritten EN body with Tribunal changes' "$main/src/content/posts/en-cp-999-test.mdx" \
  || fail "en post rewrite was not copied from worker to main"
grep -q 'tribunalVersion: 3' "$main/src/content/posts/cp-999-test.mdx" \
  || fail "score frontmatter was not copied to main"

git -C "$main" add src/content/posts/cp-999-test.mdx src/content/posts/en-cp-999-test.mdx
if git -C "$main" diff --cached --quiet -- src/content/posts; then
  fail "main repo has no staged post diff after publishing worker rewrite"
fi

pass "worker Tribunal rewrites are published into main repo and stageable"

same_main_hash_before="$(git -C "$main" hash-object src/content/posts/cp-999-test.mdx)"
bash "$HELPER" "$main" "$main" "cp-999-test.mdx"
same_main_hash_after="$(git -C "$main" hash-object src/content/posts/cp-999-test.mdx)"
[ "$same_main_hash_before" = "$same_main_hash_after" ] || fail "same-repo publish should be a no-op"
pass "same-repo publish is safe no-op"

if ! grep -q 'tribunal-publish-worker-changes.sh' "$ROOT_DIR/scripts/tribunal-all-claude.sh"; then
  fail "tribunal-all-claude.sh does not call publish helper before committing progress"
fi
if ! grep -q 'src/content/posts/\$POST_FILE' "$ROOT_DIR/scripts/tribunal-all-claude.sh"; then
  fail "tribunal-all-claude.sh does not stage target post files in commit_progress"
fi
pass "tribunal-all-claude.sh wires post publishing into commit_progress"
