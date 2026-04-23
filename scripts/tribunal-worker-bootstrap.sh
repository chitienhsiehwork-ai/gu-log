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
#   scripts/tribunal-worker-bootstrap.sh sync [id]      # fast-forward worker(s) to origin/main
#   scripts/tribunal-worker-bootstrap.sh remove <id>    # git worktree remove
#   scripts/tribunal-worker-bootstrap.sh remove-all     # remove every gu-log-worker-*
#
# Notes:
#   - Disk cost is ~500MB per worker (pnpm node_modules per worktree).
#   - Safe to run create on an id that already exists: prints a warning and
#     exits 0 so this is idempotent for supervisor startup.
#   - `sync` MUST be run after every main-branch change to tribunal code or
#     workers will continue running the stale snapshot of their worktree.
#     Supervisor invokes `sync` at startup; also run it manually when you
#     see new code on main that should reach running workers without a
#     full service restart.

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

cmd_sync() {
  local only_id="${1:-}"
  cd "$MAIN_REPO"
  git fetch origin main >/dev/null 2>&1 || { echo "WARN: git fetch origin main failed" >&2; }
  local target_sha
  target_sha=$(git rev-parse origin/main)

  local dir id before_sha lockfile_changed pkg_changed
  local any=0
  for dir in "$WORKER_PARENT"/gu-log-worker-*; do
    [ -d "$dir" ] || continue
    id="${dir##*/gu-log-worker-}"
    if [ -n "$only_id" ] && [ "$id" != "$only_id" ]; then
      continue
    fi
    any=1

    before_sha=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo "unknown")
    if [ "$before_sha" = "$target_sha" ]; then
      echo "worker-$id: already at ${target_sha:0:8} (origin/main) — nothing to do"
      continue
    fi

    # Detect lockfile / package.json drift BEFORE reset so we can decide
    # whether to re-run pnpm install after the reset.
    lockfile_changed=0
    pkg_changed=0
    if ! git -C "$dir" diff --quiet "$before_sha" "$target_sha" -- pnpm-lock.yaml 2>/dev/null; then
      lockfile_changed=1
    fi
    if ! git -C "$dir" diff --quiet "$before_sha" "$target_sha" -- package.json 2>/dev/null; then
      pkg_changed=1
    fi

    echo "worker-$id: ${before_sha:0:8} -> ${target_sha:0:8}"
    # Reset is safe: worker worktrees are detached-HEAD, ephemeral snapshots
    # rebuilt from origin/main. Nothing worth preserving lives in them.
    if ! git -C "$dir" reset --hard "$target_sha" >/dev/null 2>&1; then
      echo "  ERROR: reset failed for worker-$id" >&2
      continue
    fi

    if [ "$lockfile_changed" = 1 ] || [ "$pkg_changed" = 1 ]; then
      echo "  pnpm-lock / package.json changed — running pnpm install"
      ( cd "$dir" && pnpm install --frozen-lockfile >/dev/null 2>&1 ) \
        || echo "  WARN: pnpm install failed for worker-$id" >&2
    fi
  done

  if [ "$any" -eq 0 ]; then
    if [ -n "$only_id" ]; then
      echo "No worker worktree matches id=$only_id"
    else
      echo "No worker worktrees found — nothing to sync"
    fi
  fi
}

cmd_remove() {
  local id="${1:-}"
  [ -z "$id" ] && { echo "ERROR: missing worker id" >&2; usage 1; }
  local path=""
  path=$(worker_path "$id")
  if [ ! -d "$path" ]; then
    echo "Worker worktree not found: $path"
    return 0
  fi
  cd "$MAIN_REPO"
  echo "Removing worktree ${path}..."
  git worktree remove --force "$path" 2>&1 || rm -rf "$path"
  git worktree prune
  echo "Removed."
}

cmd_remove_all() {
  local dir id
  for dir in "$WORKER_PARENT"/gu-log-worker-*; do
    [ -d "$dir" ] || continue
    id="${dir##*/gu-log-worker-}"
    cmd_remove "$id"
  done
  git -C "$MAIN_REPO" worktree list
}

case "${1:-}" in
  create)     shift; cmd_create "$@" ;;
  status|ls)  cmd_status ;;
  sync)       shift; cmd_sync "$@" ;;
  remove|rm)  shift; cmd_remove "$@" ;;
  remove-all) cmd_remove_all ;;
  ""|help|-h|--help) usage 0 ;;
  *) echo "Unknown subcommand: $1" >&2; usage 1 ;;
esac
