#!/bin/sh
# scripts/merge-article-counter.sh
#
# Custom git merge driver for `scripts/article-counter.json`.
#
# Git calling convention:
#   $1 = %O — ancestor version (temp file)
#   $2 = %A — our version (temp file, AND the file we must overwrite with
#             the merged result; git reads the merged content from here
#             after we exit 0)
#   $3 = %B — their version (temp file)
#   $4 = %P — pathname in the worktree (for logging)
#
# Strategy: JSON-aware three-way merge. Counter `next` values are monotonic,
# so matching prefixes resolve to max(ours.next, theirs.next). Other fields
# use normal three-way semantics and fail closed if both sides changed
# differently.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ -z "$2" ]; then
    echo "merge-article-counter.sh: expected %A as arg 2" >&2
    exit 2
fi

node "$REPO_ROOT/scripts/merge-article-counter.mjs" "$1" "$2" "$3" "$4"
