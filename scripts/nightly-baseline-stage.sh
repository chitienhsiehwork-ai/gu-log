#!/usr/bin/env bash
# Stages a nightly-generated baseline/history file onto a fixed remote
# staging branch, without ever force-pushing or clobbering existing
# progress on that branch.
#
# main's branch protection blocks direct pushes, and this repo's Actions
# permissions block Actions-created pull requests (repo-owner security
# setting — see nightly-deep.yml's persist steps for the full story), so
# the nightly workflow can only push a plain branch. That branch is meant
# to be turned into a real PR by a human or the next agent session; this
# script must never overwrite whatever progress is already sitting there
# waiting to be merged.
#
# Usage: nightly-baseline-stage.sh <branch> <commit-message> <file...>
#
# Behavior:
#   - No diff in the given files          -> exit 0, no-op.
#   - Remote branch doesn't exist yet     -> create it with a normal push.
#   - Remote branch already exists        -> leave it untouched, exit 0.
#     (The baseline-freshness job is the escalation signal for "this has
#     been sitting too long" — this script does not try to be that too.)
#   - Existence check itself fails        -> exit 1 (fail closed). A
#     network/API error is NOT the same as "branch absent", and treating
#     it that way risks silently overwriting real progress.
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: $0 <branch> <commit-message> <file...>" >&2
  exit 1
fi

BRANCH="$1"
COMMIT_MSG="$2"
shift 2
FILES=("$@")

if git diff --quiet -- "${FILES[@]}"; then
  echo "No change in: ${FILES[*]} — skipping staging push."
  exit 0
fi

set +e
ls_output=$(git ls-remote --exit-code --heads origin "$BRANCH" 2>&1)
ls_exit=$?
set -e

if [ "$ls_exit" -eq 0 ]; then
  echo "Remote branch '$BRANCH' already exists — preserving it untouched (it's presumably awaiting merge)."
  echo "Skipping publish. The baseline-freshness job is the signal that this needs attention."
  exit 0
elif [ "$ls_exit" -eq 2 ]; then
  echo "Remote branch '$BRANCH' does not exist yet — creating it."
else
  echo "::error::Could not determine whether '$BRANCH' exists on origin (git ls-remote exit $ls_exit)." >&2
  echo "Failing closed instead of guessing — a network/API failure here must not be treated as \"branch absent\", or a real existing branch could get force-overwritten." >&2
  echo "$ls_output" >&2
  exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git checkout -b "$BRANCH"
git add "${FILES[@]}"
git commit -m "$COMMIT_MSG"
git push origin "$BRANCH"
