#!/usr/bin/env bash
# tribunal-audit-pass-commits.sh — detect Tribunal PASS commits that did not
# publish target post artifacts. Intended for pre-push and daily cron/systemd.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT="$SCRIPT_DIR/tribunal-assert-pass-artifacts.sh"

repo="."
limit=50
range=""

usage() {
  cat >&2 <<'USAGE'
Usage:
  tribunal-audit-pass-commits.sh [--repo PATH] [--limit N] [--range REV_RANGE]

Scans commits whose subject looks like:
  tribunal(<post-slug>): all 4 stages PASS + final build
and fails if the commit lacks src/content/posts/<post>.mdx artifacts.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --limit) limit="$2"; shift 2 ;;
    --range) range="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

repo="$(cd "$repo" && pwd -P)"
if ! [[ "$limit" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --limit must be an integer: $limit" >&2
  exit 2
fi

log_args=(--format=%H%x09%s --grep='all 4 stages PASS + final build')
if [ -n "$range" ]; then
  log_args+=("$range")
else
  log_args+=(-n "$limit")
fi

failures=0
checked=0
while IFS=$'\t' read -r sha subject; do
  [ -n "$sha" ] || continue
  if [[ "$subject" != tribunal\(* || "$subject" != *"all 4 stages PASS + final build"* ]]; then
    continue
  fi
  slug="${subject#tribunal(}"
  slug="${slug%%):*}"
  post_file="$slug.mdx"
  checked=$((checked + 1))
  if ! "$ASSERT" "$repo" "$post_file" --commit "$sha" >/tmp/tribunal-audit-assert.out 2>&1; then
    failures=$((failures + 1))
    echo "ERROR: progress-only Tribunal PASS commit detected: $sha $subject" >&2
    sed 's/^/       /' /tmp/tribunal-audit-assert.out >&2
  fi
done < <(git -C "$repo" log "${log_args[@]}")

rm -f /tmp/tribunal-audit-assert.out

if [ "$failures" -gt 0 ]; then
  echo "❌ Tribunal PASS artifact audit failed: $failures bad commit(s), checked $checked." >&2
  exit 1
fi

echo "✓ Tribunal PASS artifact audit passed: checked $checked commit(s)."
exit 0
