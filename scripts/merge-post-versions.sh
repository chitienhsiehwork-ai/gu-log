#!/bin/sh
# scripts/merge-post-versions.sh
#
# Custom git merge driver for `src/data/post-versions.json`.
#
# Wired up by .gitattributes + the `post-versions-regen` merge config
# installed by `scripts/setup-hooks.sh`. Git invokes this whenever it would
# otherwise report a textual merge conflict on post-versions.json — which
# happens constantly because the file is auto-generated from `git log` and
# main + feature branches both touch it.
#
# Git calling convention:
#   $1 = %O — ancestor version (temp file)
#   $2 = %A — our version (temp file, AND the file we must overwrite with
#             the merged result; git reads the merged content from here
#             after we exit 0)
#   $3 = %B — their version (temp file)
#   $4 = %P — pathname in the worktree (for logging)
#
# Strategy: throw all three temp inputs away. `build-version-manifest.mjs`
# recomputes the whole manifest from the full git log (HEAD + the incoming
# heads during a merge — see the merge-aware branch in that script). Then we copy
# the freshly regenerated worktree file onto %A so git can pick it up.
#
# Exit 0 on success. Exit non-zero leaves git in the conflicted state and
# lets the developer resolve manually.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"

# %A is always $2 per git merge driver ABI. Bail loudly if it's missing.
if [ -z "$2" ]; then
    echo "merge-post-versions.sh: expected %A as arg 2" >&2
    exit 2
fi

# Regenerate the manifest from the combined git log. Git runs this driver
# before it writes MERGE_HEAD (and before the other merged files reach the
# worktree), so tell the generator which commits are being merged in.
# `git merge` exports GITHEAD_<oid>=<name> for every incoming head.
if [ -z "${POST_VERSIONS_MERGE_HEADS:-}" ]; then
    POST_VERSIONS_MERGE_HEADS="$(env | sed -n 's/^GITHEAD_\([0-9a-f]\{40,64\}\)=.*/\1/p' | tr '\n' ' ')"
fi
export POST_VERSIONS_MERGE_HEADS
if ! node "$REPO_ROOT/scripts/build-version-manifest.mjs" >&2; then
    echo "merge-post-versions.sh: regenerator failed — leaving conflict for manual resolution" >&2
    exit 1
fi

# Copy the regenerated file from the worktree onto the %A temp path that
# git will read back. Using `cat >` instead of `cp` so the original inode
# at %A is preserved (some git versions care).
cat "$REPO_ROOT/src/data/post-versions.json" > "$2"

echo "merge-post-versions.sh: regenerated and resolved ${4:-post-versions.json}" >&2
