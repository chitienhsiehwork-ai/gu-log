#!/bin/sh
# Setup git hooks by symlinking from scripts/
HOOK_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ln -sf "$SCRIPT_DIR/pre-commit" "$HOOK_DIR/pre-commit"
echo "Git hooks installed."
