#!/usr/bin/env bash
# Explicitly reopen one current-version, same-revision NEEDS_REVIEW article.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/tribunal-helpers.sh
source "$SCRIPT_DIR/tribunal-helpers.sh"

if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/tribunal-requeue.sh <filename.mdx>" >&2
  exit 64
fi

article="$1"
if [ "$article" != "$(basename "$article")" ] || [[ "$article" != *.mdx ]]; then
  echo "ERROR: article must be an .mdx basename under src/content/posts" >&2
  exit 64
fi

post_path="$ROOT_DIR/src/content/posts/$article"
if [ -L "$post_path" ] || [ ! -f "$post_path" ]; then
  echo "ERROR: post is not a safe regular file: $post_path" >&2
  exit 66
fi

if ! TRIBUNAL_VERSION="$(node "$SCRIPT_DIR/tribunal-version.mjs" current 2>/dev/null)" ||
   ! [[ "$TRIBUNAL_VERSION" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: cannot resolve the current Tribunal version" >&2
  exit 70
fi

PROGRESS_FILE="${PROGRESS_FILE:-$(tribunal_progress_file_default "$ROOT_DIR")}"
export RC_ROOT_DIR="$ROOT_DIR"
# shellcheck source=scripts/tribunal-run-control.sh
source "$SCRIPT_DIR/tribunal-run-control.sh"

ensure_tribunal_progress_file "$PROGRESS_FILE" "$ROOT_DIR"

requeue_rc=0
current_revision=""
(
  flock -x 9
  # Compute the revision only after acquiring the same lock that protects the
  # ledger comparison and write. Otherwise a body edit between hash and flock
  # could preserve stale PASS stages in a newly reopened attempt.
  current_revision="$(tribunal_reader_revision_for_file "$post_path")" || {
    echo "ERROR: cannot compute reader revision; progress was not changed" >&2
    exit 70
  }
  status="$(jq -r --arg a "$article" '.[$a].status // ""' "$PROGRESS_FILE")"
  stored_version="$(jq -r --arg a "$article" '.[$a].tribunalVersion // 0' "$PROGRESS_FILE")"
  stored_revision="$(jq -r --arg a "$article" '.[$a].readerRevision // ""' "$PROGRESS_FILE")"

  if [ "$status" != "NEEDS_REVIEW" ] || [ "$stored_version" != "$TRIBUNAL_VERSION" ]; then
    echo "ERROR: $article is not current-version NEEDS_REVIEW" >&2
    exit 66
  fi
  if [ "$stored_revision" != "$current_revision" ]; then
    echo "ERROR: reader-visible content already changed; normal dispatch will reopen it" >&2
    exit 65
  fi

  tmp="$(mktemp "$(dirname "$PROGRESS_FILE")/.tribunal-progress.XXXXXX")" || exit 70
  if ! jq --arg a "$article" \
    --arg reason "operator_requeue" \
    --arg readerRevision "$current_revision" \
    --argjson tribunalVersion "$TRIBUNAL_VERSION" \
    --arg ts "$(TZ=Asia/Taipei date -Iseconds)" '
      .[$a].status = "PENDING"
      | .[$a].failedStage = "pending"
      | .[$a].topLevelAttempts = 0
      | .[$a].startedAt = $ts
      | .[$a].requeueCount = ((.[$a].requeueCount // 0) + 1)
      | .[$a].requeuedAt = $ts
      | .[$a].requeueReason = $reason
      | .[$a].requeueReaderRevision = $readerRevision
      | .[$a].requeueTribunalVersion = $tribunalVersion
      | del(.[$a].finishedAt)
    ' "$PROGRESS_FILE" > "$tmp"; then
    rm -f "$tmp"
    exit 70
  fi
  mv "$tmp" "$PROGRESS_FILE" || {
    rm -f "$tmp"
    exit 70
  }
  printf 'Requeued %s at reader revision %s (reason=operator_requeue).\n' \
    "$article" "$current_revision"
) 9>>"$RC_PROGRESS_LOCK" || requeue_rc=$?

case "$requeue_rc" in
  0) ;;
  65|66|70) exit "$requeue_rc" ;;
  *) exit 70 ;;
esac
