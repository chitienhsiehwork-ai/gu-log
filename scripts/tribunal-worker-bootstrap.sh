#!/usr/bin/env bash
# tribunal-worker-bootstrap.sh — create / inspect / remove a tribunal worker worktree
#
# Worker worktrees live alongside the main repo at:
#   ~/clawd/projects/gu-log-worker-<id>
# where <id> is a short tag like "a" or "b". Each worker runs its own pnpm
# install + build so rewrites + build artifacts don't collide across
# parallel workers (OpenSpec: tribunal-safe-parallelism).
#
# Usage:
#   scripts/tribunal-worker-bootstrap.sh create <id>    # create worktree, pnpm install
#   scripts/tribunal-worker-bootstrap.sh status         # list all worker worktrees
#   scripts/tribunal-worker-bootstrap.sh remove <id>    # git worktree remove
#   scripts/tribunal-worker-bootstrap.sh remove-all     # remove every gu-log-worker-*
#
# Notes:
#   - Disk cost is ~500MB per worker (pnpm node_modules per worktree).
#   - Safe to run create on an id that already exists: prints a warning and
#     exits 0 so this is idempotent for supervisor startup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_PARENT="$(dirname "$MAIN_REPO")"   # usually ~/clawd/projects

usage() {
  grep '^# ' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

worker_path() {
  local id="$1"
  echo "$WORKER_PARENT/gu-log-worker-$id"
}

cmd_create() {
  local id="${1:-}"
  [ -z "$id" ] && { echo "ERROR: missing worker id" >&2; usage 1; }

  local path
  path=$(worker_path "$id")

  if [ -d "$path" ]; then
    echo "Worker worktree already exists: $path"
    git -C "$MAIN_REPO" worktree list | grep -F "$path" || echo "WARN: directory exists but git doesn't know it — may be stale"
    exit 0
  fi

  cd "$MAIN_REPO"
  echo "Creating worktree $path at origin/main…"
  # Fetch first so origin/main is current; bootstrap from a clean main.
  git fetch origin main
  git worktree add "$path" origin/main

  echo "Running pnpm install in $path (this will take a minute)…"
  cd "$path"
  pnpm install --frozen-lockfile

  echo
  echo "Worker worktree ready: $path"
  echo "  Next: supervisor will dispatch tribunal-all-claude.sh runs into this directory."
  echo "  Disk: $(du -sh "$path" 2>/dev/null | awk '{print $1}')"
}

cmd_status() {
  echo "All worktrees:"
  git -C "$MAIN_REPO" worktree list
  echo
  echo "Worker worktrees:"
  local found=0
  for dir in "$WORKER_PARENT"/gu-log-worker-*; do
    [ -d "$dir" ] || continue
    found=1
    local id size branch
    id="${dir##*/gu-log-worker-}"
    size=$(du -sh "$dir" 2>/dev/null | awk '{print $1}')
    branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "?")
    printf "  id=%s  path=%s  branch=%s  size=%s\n" "$id" "$dir" "$branch" "$size"
  done
  if [ "$found" -eq 0 ]; then
    echo "  (none)"
  fi
}

cmd_remove() {
  local id="${1:-}"
  [ -z "$id" ] && { echo "ERROR: missing worker id" >&2; usage 1; }
  local path
  path=$(worker_path "$id")
  if [ ! -d "$path" ]; then
    echo "Worker worktree not found: $path"
    exit 0
  fi
  cd "$MAIN_REPO"
  echo "Removing worktree $path…"
  git worktree remove --force "$path" 2>&1 || rm -rf "$path"
  git worktree prune
  echo "Removed."
}

cmd_remove_all() {
  for dir in "$WORKER_PARENT"/gu-log-worker-*; do
    [ -d "$dir" ] || continue
    local id="${dir##*/gu-log-worker-}"
    cmd_remove "$id"
  done
  git -C "$MAIN_REPO" worktree list
}

case "${1:-}" in
  create)     shift; cmd_create "$@" ;;
  status|ls)  cmd_status ;;
  remove|rm)  shift; cmd_remove "$@" ;;
  remove-all) cmd_remove_all ;;
  ""|help|-h|--help) usage 0 ;;
  *) echo "Unknown subcommand: $1" >&2; usage 1 ;;
esac
