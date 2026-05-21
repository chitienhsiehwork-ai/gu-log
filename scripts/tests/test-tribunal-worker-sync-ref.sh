#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BOOTSTRAP="$ROOT_DIR/scripts/tribunal-worker-bootstrap.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

repo="$TMP/gu-log"
mkdir -p "$repo"
git -C "$repo" init -q
git -C "$repo" config user.email test@example.invalid
git -C "$repo" config user.name "Worker Sync Ref Test"
printf 'one\n' > "$repo/file.txt"
git -C "$repo" add file.txt
git -C "$repo" commit -q -m base

mkdir -p "$repo/scripts"
cp "$BOOTSTRAP" "$repo/scripts/tribunal-worker-bootstrap.sh"
chmod +x "$repo/scripts/tribunal-worker-bootstrap.sh"

git -C "$repo" worktree add "$TMP/gu-log-worker-a" HEAD >/dev/null 2>&1
printf 'two\n' >> "$repo/file.txt"
git -C "$repo" add file.txt
git -C "$repo" commit -q -m second

(cd "$repo" && TRIBUNAL_WORKER_SYNC_REF=HEAD bash scripts/tribunal-worker-bootstrap.sh sync a >/tmp/worker-sync.out 2>&1)

main_sha="$(git -C "$repo" rev-parse HEAD)"
worker_sha="$(git -C "$TMP/gu-log-worker-a" rev-parse HEAD)"
[ "$main_sha" = "$worker_sha" ] || fail "worker did not sync to supervisor HEAD"
pass "worker sync can follow supervisor HEAD instead of origin/main"
