#!/bin/bash
# Setup git hooks for gu-log

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/hooks"
GIT_HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

echo "Setting up git hooks..."

for hook in "$HOOKS_DIR"/*; do
    if [ -f "$hook" ]; then
        hookname=$(basename "$hook")
        cp "$hook" "$GIT_HOOKS_DIR/$hookname"
        chmod +x "$GIT_HOOKS_DIR/$hookname"
        echo "✓ Installed $hookname"
    fi
done

echo "Done!"
