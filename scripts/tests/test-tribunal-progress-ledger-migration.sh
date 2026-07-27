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
    "tribunalVersion": 8
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

corrupt_with_legacy="$TMP/corrupt-with-legacy"
mkdir -p "$corrupt_with_legacy/scores" "$corrupt_with_legacy/.score-loop/state"
printf '{"legacy":"valid"}\n' > "$corrupt_with_legacy/scores/tribunal-progress.json"
printf '{"runtime":\n' > "$corrupt_with_legacy/.score-loop/state/tribunal-progress.json"
cp \
  "$corrupt_with_legacy/.score-loop/state/tribunal-progress.json" \
  "$corrupt_with_legacy/runtime-before.json"
if ensure_tribunal_progress_file \
  "$corrupt_with_legacy/.score-loop/state/tribunal-progress.json" \
  "$corrupt_with_legacy"; then
  fail "corrupt runtime progress must not be replaced by a valid legacy snapshot"
fi
cmp \
  "$corrupt_with_legacy/runtime-before.json" \
  "$corrupt_with_legacy/.score-loop/state/tribunal-progress.json" >/dev/null ||
  fail "corrupt runtime progress bytes changed during rejected migration"
pass "corrupt runtime progress stays untouched when a valid legacy snapshot exists"

corrupt_without_legacy="$TMP/corrupt-without-legacy"
mkdir -p "$corrupt_without_legacy/.score-loop/state"
printf '{"runtime":\n' > "$corrupt_without_legacy/.score-loop/state/tribunal-progress.json"
cp \
  "$corrupt_without_legacy/.score-loop/state/tribunal-progress.json" \
  "$corrupt_without_legacy/runtime-before.json"
if ensure_tribunal_progress_file \
  "$corrupt_without_legacy/.score-loop/state/tribunal-progress.json" \
  "$corrupt_without_legacy"; then
  fail "corrupt runtime progress must not be reset to an empty object"
fi
cmp \
  "$corrupt_without_legacy/runtime-before.json" \
  "$corrupt_without_legacy/.score-loop/state/tribunal-progress.json" >/dev/null ||
  fail "corrupt runtime progress bytes changed during rejected initialization"
pass "corrupt runtime progress stays untouched without a legacy snapshot"

symlink_repo="$TMP/symlink-target"
mkdir -p "$symlink_repo/.score-loop/state"
symlink_payload="$TMP/symlink-payload.json"
printf '{"runtime":"valid"}\n' > "$symlink_payload"
ln -s "$symlink_payload" "$symlink_repo/.score-loop/state/tribunal-progress.json"
if ensure_tribunal_progress_file \
  "$symlink_repo/.score-loop/state/tribunal-progress.json" \
  "$symlink_repo"; then
  fail "symbolic-link runtime progress must be rejected"
fi
[ -L "$symlink_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "rejected runtime progress symlink was replaced"
[ "$(cat "$symlink_payload")" = '{"runtime":"valid"}' ] ||
  fail "rejected runtime progress symlink target changed"
pass "symbolic-link runtime progress is rejected without mutation"

nonregular_repo="$TMP/nonregular-target"
mkdir -p "$nonregular_repo/.score-loop/state/tribunal-progress.json"
if ensure_tribunal_progress_file \
  "$nonregular_repo/.score-loop/state/tribunal-progress.json" \
  "$nonregular_repo"; then
  fail "non-regular runtime progress must be rejected"
fi
[ -d "$nonregular_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "rejected non-regular runtime progress was replaced"
[ ! -e "$nonregular_repo/.score-loop/state/migrations" ] ||
  fail "rejected non-regular runtime progress created migration side effects"
pass "non-regular runtime progress fails before migration side effects"

corrupt_legacy_repo="$TMP/corrupt-legacy"
mkdir -p "$corrupt_legacy_repo/scores"
printf '{"legacy":\n' > "$corrupt_legacy_repo/scores/tribunal-progress.json"
if ensure_tribunal_progress_file \
  "$corrupt_legacy_repo/.score-loop/state/tribunal-progress.json" \
  "$corrupt_legacy_repo"; then
  fail "corrupt legacy progress must not initialize an empty runtime ledger"
fi
[ ! -e "$corrupt_legacy_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "corrupt legacy progress created a runtime ledger"
pass "corrupt legacy progress fails closed while runtime progress is missing"

real_cp="$(command -v cp)"
backup_fail_bin="$TMP/backup-fail-bin"
mkdir -p "$backup_fail_bin"
cat > "$backup_fail_bin/cp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

case "${2:-}" in
  */.score-loop/state/migrations/*)
    exit 1
    ;;
esac
exec "$REAL_CP" "$@"
SH
chmod +x "$backup_fail_bin/cp"

backup_fail_repo="$TMP/backup-failure"
mkdir -p "$backup_fail_repo/scores"
printf '{"legacy":"snapshot"}\n' > "$backup_fail_repo/scores/tribunal-progress.json"
original_path="$PATH"
export PATH="$backup_fail_bin:$PATH"
export REAL_CP="$real_cp"
if ensure_tribunal_progress_file \
  "$backup_fail_repo/.score-loop/state/tribunal-progress.json" \
  "$backup_fail_repo"; then
  fail "legacy migration must reject a failed backup copy"
fi
export PATH="$original_path"
unset REAL_CP
[ ! -e "$backup_fail_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "failed backup copy published a runtime progress ledger"
backup_fail_count="$(find "$backup_fail_repo/.score-loop/state/migrations" -type f | wc -l | tr -d ' ')"
[ "$backup_fail_count" = "0" ] ||
  fail "failed backup copy left a partial migration backup"
ensure_tribunal_progress_file \
  "$backup_fail_repo/.score-loop/state/tribunal-progress.json" \
  "$backup_fail_repo"
backup_retry_count="$(find "$backup_fail_repo/.score-loop/state/migrations" -type f | wc -l | tr -d ' ')"
[ "$backup_retry_count" = "1" ] ||
  fail "retry after backup failure did not complete a real migration"
pass "backup failure leaves migration unpublished and safely retryable"

real_jq="$(command -v jq)"
race_bin="$TMP/race-bin"
mkdir -p "$race_bin"
cat > "$race_bin/jq" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

"$REAL_JQ" "$@"
if [ ! -e "$RACE_MARKER" ]; then
  case "$RACE_ACTION" in
    file)
      printf '{"new":"must-survive"}\n' > "$RACE_TARGET"
      ;;
    symlink)
      ln -s "$RACE_VICTIM" "$RACE_TARGET"
      ;;
    directory)
      mkdir "$RACE_TARGET"
      ;;
    symlink-directory)
      mkdir -p "$RACE_VICTIM"
      ln -s "$RACE_VICTIM" "$RACE_TARGET"
      ;;
    *)
      echo "unexpected race action: $RACE_ACTION" >&2
      exit 1
      ;;
  esac
  : > "$RACE_MARKER"
fi
SH
chmod +x "$race_bin/jq"
original_path="$PATH"
export PATH="$race_bin:$PATH"
export REAL_JQ="$real_jq"

race_file_repo="$TMP/race-file"
mkdir -p "$race_file_repo/scores" "$race_file_repo/.score-loop/state"
printf '{"legacy":"snapshot"}\n' > "$race_file_repo/scores/tribunal-progress.json"
export RACE_ACTION="file"
export RACE_MARKER="$TMP/race-file.marker"
export RACE_TARGET="$race_file_repo/.score-loop/state/tribunal-progress.json"
export RACE_VICTIM=""
if ! ensure_tribunal_progress_file "$RACE_TARGET" "$race_file_repo"; then
  fail "a concurrently created valid runtime progress file should win initialization"
fi
[ "$(cat "$race_file_repo/.score-loop/state/tribunal-progress.json")" = '{"new":"must-survive"}' ] ||
  fail "migration overwrote a concurrently created runtime progress file"
pass "concurrent valid runtime progress wins missing-ledger initialization"

race_symlink_repo="$TMP/race-symlink"
mkdir -p "$race_symlink_repo/scores" "$race_symlink_repo/.score-loop/state"
printf '{"legacy":"snapshot"}\n' > "$race_symlink_repo/scores/tribunal-progress.json"
race_victim="$TMP/race-symlink-victim.json"
printf '{"victim":"must-survive"}\n' > "$race_victim"
export RACE_ACTION="symlink"
export RACE_MARKER="$TMP/race-symlink.marker"
export RACE_TARGET="$race_symlink_repo/.score-loop/state/tribunal-progress.json"
export RACE_VICTIM="$race_victim"
if ensure_tribunal_progress_file "$RACE_TARGET" "$race_symlink_repo"; then
  fail "a concurrently created runtime progress symlink must be rejected"
fi
[ -L "$race_symlink_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "concurrently created runtime progress symlink was replaced"
[ "$(cat "$race_victim")" = '{"victim":"must-survive"}' ] ||
  fail "migration followed a concurrently created symlink and changed its target"
pass "concurrent runtime progress symlink is rejected without victim mutation"

race_directory_repo="$TMP/race-directory"
mkdir -p "$race_directory_repo/scores" "$race_directory_repo/.score-loop/state"
printf '{"legacy":"snapshot"}\n' > "$race_directory_repo/scores/tribunal-progress.json"
export RACE_ACTION="directory"
export RACE_MARKER="$TMP/race-directory.marker"
export RACE_TARGET="$race_directory_repo/.score-loop/state/tribunal-progress.json"
export RACE_VICTIM=""
if ensure_tribunal_progress_file "$RACE_TARGET" "$race_directory_repo"; then
  fail "a concurrently created runtime progress directory must be rejected"
fi
[ -d "$race_directory_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "concurrently created runtime progress directory was replaced"
[ -z "$(find "$race_directory_repo/.score-loop/state/tribunal-progress.json" -mindepth 1 -print -quit)" ] ||
  fail "migration created a hard link inside a concurrent target directory"
pass "concurrent runtime progress directory is rejected without nested mutation"

race_symlink_dir_repo="$TMP/race-symlink-directory"
mkdir -p "$race_symlink_dir_repo/scores" "$race_symlink_dir_repo/.score-loop/state"
printf '{"legacy":"snapshot"}\n' > "$race_symlink_dir_repo/scores/tribunal-progress.json"
race_symlink_dir_victim="$TMP/race-symlink-directory-victim"
export RACE_ACTION="symlink-directory"
export RACE_MARKER="$TMP/race-symlink-directory.marker"
export RACE_TARGET="$race_symlink_dir_repo/.score-loop/state/tribunal-progress.json"
export RACE_VICTIM="$race_symlink_dir_victim"
if ensure_tribunal_progress_file "$RACE_TARGET" "$race_symlink_dir_repo"; then
  fail "a concurrent runtime progress symlink to a directory must be rejected"
fi
[ -L "$race_symlink_dir_repo/.score-loop/state/tribunal-progress.json" ] ||
  fail "concurrent runtime progress directory symlink was replaced"
[ -z "$(find "$race_symlink_dir_victim" -mindepth 1 -print -quit)" ] ||
  fail "migration followed a concurrent directory symlink and mutated its target"
pass "concurrent directory symlink is rejected without victim mutation"

export PATH="$original_path"
unset REAL_JQ RACE_ACTION RACE_MARKER RACE_TARGET RACE_VICTIM

missing_repo="$TMP/missing-both"
ensure_tribunal_progress_file \
  "$missing_repo/.score-loop/state/tribunal-progress.json" \
  "$missing_repo"
[ "$(cat "$missing_repo/.score-loop/state/tribunal-progress.json")" = '{}' ] ||
  fail "missing runtime and legacy progress should initialize an empty object"
pass "missing runtime and legacy progress initializes once"
