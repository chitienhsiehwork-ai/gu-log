#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gu-log-hooks-worktree.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT

MAIN_REPO="$TMP_ROOT/main"
LINKED_WORKTREE="$TMP_ROOT/linked"

git init -q "$MAIN_REPO"
git -C "$MAIN_REPO" config user.name "Hook Test"
git -C "$MAIN_REPO" config user.email "hook-test@example.invalid"
mkdir -p "$MAIN_REPO/scripts/hooks" "$MAIN_REPO/.githooks"
cp "$REPO_ROOT/scripts/setup-hooks.sh" "$MAIN_REPO/scripts/setup-hooks.sh"
cp "$REPO_ROOT/scripts/hooks/pre-commit" "$MAIN_REPO/scripts/hooks/pre-commit"
cp "$REPO_ROOT/scripts/hooks/pre-push" "$MAIN_REPO/scripts/hooks/pre-push"
git -C "$MAIN_REPO" add scripts .githooks
git -C "$MAIN_REPO" commit -q -m "fixture"
git -C "$MAIN_REPO" worktree add -q -b linked "$LINKED_WORKTREE"

(cd "$MAIN_REPO" && bash scripts/setup-hooks.sh >/dev/null)
MAIN_HOOKS=$(git -C "$MAIN_REPO" config --worktree --get core.hooksPath)
EXPECTED_MAIN=$(git -C "$MAIN_REPO" rev-parse --absolute-git-dir)/hooks

(cd "$LINKED_WORKTREE" && bash scripts/setup-hooks.sh >/dev/null)
LINKED_HOOKS=$(git -C "$LINKED_WORKTREE" config --worktree --get core.hooksPath)
EXPECTED_LINKED=$(git -C "$LINKED_WORKTREE" rev-parse --absolute-git-dir)/hooks
MAIN_AFTER_LINKED=$(git -C "$MAIN_REPO" config --worktree --get core.hooksPath)

if [ "$MAIN_HOOKS" != "$EXPECTED_MAIN" ]; then
  echo "main hooksPath mismatch: $MAIN_HOOKS != $EXPECTED_MAIN" >&2
  exit 1
fi
if [ "$LINKED_HOOKS" != "$EXPECTED_LINKED" ]; then
  echo "linked hooksPath mismatch: $LINKED_HOOKS != $EXPECTED_LINKED" >&2
  exit 1
fi
if [ "$MAIN_AFTER_LINKED" != "$MAIN_HOOKS" ]; then
  echo "linked installer overwrote main hooksPath" >&2
  exit 1
fi
if [ "$MAIN_HOOKS" = "$LINKED_HOOKS" ]; then
  echo "worktrees unexpectedly share one hooksPath" >&2
  exit 1
fi

echo "setup-hooks linked-worktree isolation: PASS"
