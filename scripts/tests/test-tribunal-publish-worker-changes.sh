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

cat > "$main/src/content/posts/mp-999-test.mdx" <<'POST'
---
title: Original
ticketId: MP-999
lang: zh-tw
translatedDate: 2026-04-28
---

Original body.
POST
cat > "$main/src/content/posts/en-mp-999-test.mdx" <<'POST'
---
title: Original EN
ticketId: MP-999
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

cat > "$worker/src/content/posts/mp-999-test.mdx" <<'POST'
---
title: Original
 ticketId: MP-999
lang: zh-tw
translatedDate: 2026-04-28
scores:
  tribunalVersion: 8
  vibe:
    score: 8
---

Rewritten body with Tribunal changes.
POST
cat > "$worker/src/content/posts/en-mp-999-test.mdx" <<'POST'
---
title: Original EN
ticketId: MP-999
lang: en
translatedDate: 2026-04-28
scores:
  tribunalVersion: 8
  vibe:
    score: 8
---

Rewritten EN body with Tribunal changes.
POST

bash "$HELPER" "$worker" "$main" "mp-999-test.mdx"

grep -q 'Rewritten body with Tribunal changes' "$main/src/content/posts/mp-999-test.mdx" \
  || fail "zh post rewrite was not copied from worker to main"
grep -q 'Rewritten EN body with Tribunal changes' "$main/src/content/posts/en-mp-999-test.mdx" \
  || fail "en post rewrite was not copied from worker to main"
grep -q 'tribunalVersion: 8' "$main/src/content/posts/mp-999-test.mdx" \
  || fail "score frontmatter was not copied to main"

git -C "$main" add src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
if git -C "$main" diff --cached --quiet -- src/content/posts; then
  fail "main repo has no staged post diff after publishing worker rewrite"
fi

pass "worker Tribunal rewrites are published into main repo and stageable"

same_main_hash_before="$(git -C "$main" hash-object src/content/posts/mp-999-test.mdx)"
bash "$HELPER" "$main" "$main" "mp-999-test.mdx"
same_main_hash_after="$(git -C "$main" hash-object src/content/posts/mp-999-test.mdx)"
[ "$same_main_hash_before" = "$same_main_hash_after" ] || fail "same-repo publish should be a no-op"
pass "same-repo publish is safe no-op"

if ! grep -q 'tribunal-publish-worker-changes.sh' "$ROOT_DIR/scripts/tribunal.sh"; then
  fail "tribunal.sh does not call publish helper before committing progress"
fi
if ! grep -q 'src/content/posts/\$POST_FILE' "$ROOT_DIR/scripts/tribunal.sh"; then
  fail "tribunal.sh does not stage target post files in commit_progress"
fi
pass "tribunal.sh wires post publishing into commit_progress"

# Exercise commit_progress itself without starting judges, writers, or the
# daemon. The function's closing brace is the only one at column zero.
commit_progress_source="$(
  awk '
    /^commit_progress\(\) \{/ { capture = 1 }
    capture { print }
    capture && /^}$/ { exit }
  ' "$ROOT_DIR/scripts/tribunal.sh"
)"
[ -n "$commit_progress_source" ] || fail "could not extract commit_progress"
eval "$commit_progress_source"

REAL_GIT="$(command -v git)"
PROJECT_SCRIPT_DIR="$ROOT_DIR/scripts"

setup_commit_repo() {
  local repo="$1"
  mkdir -p "$repo/src/content/posts"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name "Tribunal Test"
  printf '{}\n' > "$repo/progress.json"
  git -C "$repo" add progress.json
  git -C "$repo" commit -q -m initial
}

run_commit_progress() {
  local main_repo="$1"
  local worker_repo="$2"
  local post_file="$3"
  local progress_file="$4"
  (
    SCRIPT_DIR="$PROJECT_SCRIPT_DIR"
    ROOT_DIR="$worker_repo"
    TRIBUNAL_MAIN_REPO="$main_repo"
    POST_FILE="$post_file"
    PROGRESS_FILE="$progress_file"
    LOG_FILE="$TMP/commit-progress.log"
    RC_PUSH_LOCK="$TMP/commit-progress.lock"
    TRIBUNAL_NO_COMMIT=0
    TRIBUNAL_ALLOW_PUSH=0
    tlog() { printf '%s\n' "$*" >> "$LOG_FILE"; }
    commit_progress "tribunal fixture progress"
  )
}

cd_failure_repo="$TMP/commit-cd-failure"
set +e
run_commit_progress "$cd_failure_repo" "$TMP" "" "progress.json"
cd_failure_rc=$?
set -e
[ "$cd_failure_rc" -eq 70 ] \
  || fail "commit_progress cd failure returned rc=$cd_failure_rc instead of 70"
pass "commit_progress fails closed when the target repo cannot be entered"

add_main="$TMP/commit-add-main"
add_worker="$TMP/commit-add-worker"
setup_commit_repo "$add_main"
setup_commit_repo "$add_worker"
mkdir -p "$add_main/.score-loop/state"
printf '.score-loop/state/\n' > "$add_main/.gitignore"
printf '{}\n' > "$add_main/.score-loop/state/tribunal-progress.json"
cat > "$add_main/src/content/posts/mp-998-add-failure.mdx" <<'POST'
Original main post.
POST
cat > "$add_worker/src/content/posts/mp-998-add-failure.mdx" <<'POST'
Rewritten worker post.
POST
git -C "$add_main" add src/content/posts/mp-998-add-failure.mdx
git -C "$add_main" add .gitignore
git -C "$add_main" commit -q -m post
git -C "$add_worker" add src/content/posts/mp-998-add-failure.mdx
git -C "$add_worker" commit -q -m post
printf 'Rewritten worker post after initial commit.\n' \
  > "$add_worker/src/content/posts/mp-998-add-failure.mdx"
add_failure_before="$(git -C "$add_main" rev-list --count HEAD)"
mkdir -p "$TMP/failing-git-bin"
cat > "$TMP/failing-git-bin/git" <<'SCRIPT'
#!/usr/bin/env bash
if [ "${1:-}" = "add" ]; then
  exit 61
fi
exec "$REAL_GIT" "$@"
SCRIPT
chmod +x "$TMP/failing-git-bin/git"
set +e
PATH="$TMP/failing-git-bin:$PATH" REAL_GIT="$REAL_GIT" \
  run_commit_progress \
    "$add_main" "$add_worker" "mp-998-add-failure.mdx" \
    "$add_main/.score-loop/state/tribunal-progress.json"
add_failure_rc=$?
set -e
[ "$add_failure_rc" -eq 70 ] \
  || fail "commit_progress git add failure returned rc=$add_failure_rc instead of 70"
[ "$(git -C "$add_main" rev-list --count HEAD)" = "$add_failure_before" ] \
  || fail "commit_progress created a commit after git add failed"
pass "commit_progress fails closed when staging post artifacts fails"

commit_failure_repo="$TMP/commit-hook-failure"
setup_commit_repo "$commit_failure_repo"
printf '{"updated":true}\n' > "$commit_failure_repo/progress.json"
commit_failure_before="$(git -C "$commit_failure_repo" rev-list --count HEAD)"
cat > "$commit_failure_repo/.git/hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
exit 42
HOOK
chmod +x "$commit_failure_repo/.git/hooks/pre-commit"
set +e
run_commit_progress \
  "$commit_failure_repo" "$commit_failure_repo" "" "progress.json"
commit_failure_rc=$?
set -e
[ "$commit_failure_rc" -eq 70 ] \
  || fail "commit_progress git commit failure returned rc=$commit_failure_rc instead of 70"
[ "$(git -C "$commit_failure_repo" rev-list --count HEAD)" = "$commit_failure_before" ] \
  || fail "commit_progress advanced HEAD after git commit failed"
[ "$(git -C "$commit_failure_repo" diff --cached --name-only)" = "progress.json" ] \
  || fail "commit_progress lost the staged artifact after git commit failed"
pass "commit_progress fails closed when git commit rejects the staged change"

no_diff_repo="$TMP/commit-no-diff"
setup_commit_repo "$no_diff_repo"
no_diff_before="$(git -C "$no_diff_repo" rev-list --count HEAD)"
run_commit_progress "$no_diff_repo" "$no_diff_repo" "" "progress.json"
no_diff_after="$(git -C "$no_diff_repo" rev-list --count HEAD)"
[ "$no_diff_before" = "$no_diff_after" ] \
  || fail "commit_progress created a commit without a staged diff"
pass "commit_progress keeps a real no-staged-diff run successful"

ignored_progress_repo="$TMP/commit-ignored-progress"
setup_commit_repo "$ignored_progress_repo"
mkdir -p "$ignored_progress_repo/.score-loop/state"
printf '.score-loop/state/\n' > "$ignored_progress_repo/.gitignore"
git -C "$ignored_progress_repo" add .gitignore
git -C "$ignored_progress_repo" commit -q -m ignore-runtime-ledger
printf '{"runtime":true}\n' \
  > "$ignored_progress_repo/.score-loop/state/tribunal-progress.json"
ignored_progress_before="$(git -C "$ignored_progress_repo" rev-list --count HEAD)"
run_commit_progress \
  "$ignored_progress_repo" "$ignored_progress_repo" "" \
  "$ignored_progress_repo/.score-loop/state/tribunal-progress.json"
ignored_progress_after="$(git -C "$ignored_progress_repo" rev-list --count HEAD)"
[ "$ignored_progress_before" = "$ignored_progress_after" ] \
  || fail "commit_progress committed the ignored runtime progress ledger"
pass "commit_progress skips the absolute ignored runtime progress ledger"

missing_en_repo="$TMP/commit-missing-en"
setup_commit_repo "$missing_en_repo"
cat > "$missing_en_repo/src/content/posts/mp-997-no-en.mdx" <<'POST'
Original post without an English sidecar.
POST
git -C "$missing_en_repo" add src/content/posts/mp-997-no-en.mdx
git -C "$missing_en_repo" commit -q -m post
printf 'Updated post without an English sidecar.\n' \
  > "$missing_en_repo/src/content/posts/mp-997-no-en.mdx"
missing_en_before="$(git -C "$missing_en_repo" rev-list --count HEAD)"
run_commit_progress \
  "$missing_en_repo" "$missing_en_repo" "mp-997-no-en.mdx" "progress.json"
missing_en_after="$(git -C "$missing_en_repo" rev-list --count HEAD)"
[ "$missing_en_after" -eq "$((missing_en_before + 1))" ] \
  || fail "commit_progress did not commit a post with no English sidecar"
[ "$(git -C "$missing_en_repo" show --format= --name-only HEAD)" = \
  "src/content/posts/mp-997-no-en.mdx" ] \
  || fail "commit_progress staged unexpected artifacts for a missing English sidecar"
pass "commit_progress treats a missing untracked English sidecar as optional"
