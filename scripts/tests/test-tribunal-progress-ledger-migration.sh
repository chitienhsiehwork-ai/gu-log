#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$ROOT_DIR/scripts/tribunal-helpers.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

repo="$TMP/repo"
mkdir -p "$repo/scores"
cat > "$repo/scores/tribunal-progress.json" <<'JSON'
{
  "sp-test.mdx": {
    "status": "PASS",
    "tribunalVersion": 5
  }
}
JSON

target="$(tribunal_progress_file_default "$repo")"
ensure_tribunal_progress_file "$target" "$repo"

[ -f "$target" ] || fail "migrated ignored progress file missing"
cmp "$repo/scores/tribunal-progress.json" "$target" >/dev/null || fail "migrated progress content mismatch"

backup_count="$(find "$repo/.score-loop/state/migrations" -type f | wc -l | tr -d ' ')"
[ "$backup_count" = "1" ] || fail "expected one migration backup, got $backup_count"

ensure_tribunal_progress_file "$target" "$repo"
backup_count_after="$(find "$repo/.score-loop/state/migrations" -type f | wc -l | tr -d ' ')"
[ "$backup_count_after" = "1" ] || fail "migration should be idempotent once ignored ledger exists"
pass "legacy tracked progress migrates once into ignored ledger"
