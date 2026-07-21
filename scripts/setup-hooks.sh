#!/bin/bash
# Setup git hooks for gu-log
# Uses .git/hooks/ (not .githooks/) to avoid confusion

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/hooks"
GIT_HOOKS_DIR="$(git rev-parse --absolute-git-dir)/hooks"

echo "Setting up git hooks..."

# core.hooksPath is checkout-specific: each linked worktree has its own git-dir
# and may be on a different branch with different hooks. Enable Git's
# worktree-config extension at clone scope, then store the path only in this
# worktree's config.worktree. Using --local here would overwrite the shared
# .git/config and redirect every linked worktree to whichever one ran setup
# most recently.
git config --local extensions.worktreeConfig true
git config --worktree core.hooksPath "$GIT_HOOKS_DIR"

# Migrate clones that ran the pre-worktree-safe setup script. That version
# stored an absolute hooksPath in the shared .git/config, so every sibling
# worktree inherited one checkout's hooks. The current worktree override above
# is already safe; remove only the legacy clone-scoped key so it cannot keep
# redirecting siblings that have not run this version yet.
if git config --local --get-all core.hooksPath >/dev/null 2>&1; then
    git config --local --unset-all core.hooksPath
    echo "✓ Removed legacy clone-scoped core.hooksPath"
fi
mkdir -p "$GIT_HOOKS_DIR"
echo "✓ Set worktree-scoped core.hooksPath to $GIT_HOOKS_DIR"

for hook in "$HOOKS_DIR"/*; do
    if [ -f "$hook" ]; then
        hookname=$(basename "$hook")
        cp "$hook" "$GIT_HOOKS_DIR/$hookname"
        chmod +x "$GIT_HOOKS_DIR/$hookname"
        echo "✓ Installed $hookname"
    fi
done

# Also sync to .githooks/ for repo tracking
if [ -d "$SCRIPT_DIR/../.githooks" ]; then
    for hook in "$HOOKS_DIR"/*; do
        if [ -f "$hook" ]; then
            hookname=$(basename "$hook")
            cp "$hook" "$SCRIPT_DIR/../.githooks/$hookname"
            chmod +x "$SCRIPT_DIR/../.githooks/$hookname"
        fi
    done
    echo "✓ Synced to .githooks/"
fi

# ── Custom merge driver: post-versions-regen ────────────────────────
# .gitattributes marks `src/data/post-versions.json` as needing this
# driver. Configure the driver command in the local .git/config so the
# driver is actually callable. Unlike core.hooksPath, merge-driver definitions
# are intentionally clone-scoped: every worktree in the clone shares the same
# .gitattributes and driver commands. Keep --local so these stay in the common
# .git/config, not one worktree's config.worktree.
git config --local merge.post-versions-regen.name \
    "Regenerate post-versions.json from git log (HEAD + MERGE_HEAD)"
git config --local merge.post-versions-regen.driver \
    "scripts/merge-post-versions.sh %O %A %B %P"
echo "✓ Configured merge driver post-versions-regen"

# ── Custom merge driver: article-counter-max ────────────────────────
# .gitattributes marks `scripts/article-counter.json` as needing this
# driver. The counter is monotonic, so concurrent `next` bumps resolve
# with a JSON-aware max strategy while metadata conflicts fail closed.
git config --local merge.article-counter-max.name \
    "Merge article-counter.json by taking max next values"
git config --local merge.article-counter-max.driver \
    "scripts/merge-article-counter.sh %O %A %B %P"
echo "✓ Configured merge driver article-counter-max"

echo "Done!"
