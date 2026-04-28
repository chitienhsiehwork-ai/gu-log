#!/usr/bin/env bash
# tribunal-publish-worker-changes.sh — copy Tribunal article artifacts from an
# isolated worker worktree into the main repo before committing progress.
#
# Usage:
#   bash scripts/tribunal-publish-worker-changes.sh <worker_repo> <main_repo> <post_file.mdx>
#
# The quota supervisor runs judges/writers in worker worktrees but serializes
# commits from the main repo. Writer rewrites and score frontmatter are created
# in the worker worktree, so they must be copied back to main before the PASS /
# FAILED progress commit is created. This helper is intentionally narrow: only
# the target zh-tw post and its en-* counterpart may be published.

set -euo pipefail

worker_repo="${1:-}"
main_repo="${2:-}"
post_file="${3:-}"

if [ -z "$worker_repo" ] || [ -z "$main_repo" ] || [ -z "$post_file" ]; then
  echo "Usage: $0 <worker_repo> <main_repo> <post_file.mdx>" >&2
  exit 2
fi

post_file="$(basename "$post_file")"
case "$post_file" in
  *.mdx) ;;
  *) echo "ERROR: post_file must be an .mdx basename: $post_file" >&2; exit 2 ;;
esac
case "$post_file" in
  en-*) echo "ERROR: post_file must be the zh-tw canonical post, not en-* ($post_file)" >&2; exit 2 ;;
esac

worker_repo="$(cd "$worker_repo" && pwd -P)"
main_repo="$(cd "$main_repo" && pwd -P)"

# Same repo / standalone mode: nothing to copy. Caller still stages local files.
if [ "$worker_repo" = "$main_repo" ]; then
  exit 0
fi

publish_one() {
  local rel="$1"
  local src="$worker_repo/$rel"
  local dst="$main_repo/$rel"

  if [ ! -e "$src" ]; then
    return 0
  fi

  case "$rel" in
    src/content/posts/*.mdx) ;;
    *) echo "ERROR: refusing to publish non-post path: $rel" >&2; exit 2 ;;
  esac

  mkdir -p "$(dirname "$dst")"
  if [ ! -f "$dst" ] || ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    echo "published $rel"
  fi
}

publish_one "src/content/posts/$post_file"
publish_one "src/content/posts/en-$post_file"
