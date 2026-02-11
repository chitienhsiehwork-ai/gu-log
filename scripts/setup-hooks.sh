#!/bin/bash
# Setup git hooks for gu-log
# Uses .git/hooks/ (not .githooks/) to avoid confusion

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/hooks"
GIT_HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

echo "Setting up git hooks..."

# Ensure git uses .git/hooks/ (not a custom hooksPath)
git config --local core.hooksPath .git/hooks
echo "✓ Set core.hooksPath to .git/hooks"

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

echo "Done!"
