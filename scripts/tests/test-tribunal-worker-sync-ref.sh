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

(cd "$repo" && TRIBUNAL_WORKER_SYNC_REF=HEAD bash scripts/tribunal-worker-bootstrap.sh sync a >"$TMP/worker-sync.out" 2>&1)

main_sha="$(git -C "$repo" rev-parse HEAD)"
worker_sha="$(git -C "$TMP/gu-log-worker-a" rev-parse HEAD)"
[ "$main_sha" = "$worker_sha" ] || fail "worker did not sync to supervisor HEAD"
pass "worker sync can follow supervisor HEAD instead of origin/main"

invalid_fake_bin="$TMP/invalid-fake-bin"
invalid_side_effect_marker="$TMP/invalid-side-effect"
mkdir -p "$invalid_fake_bin"
# This expression belongs to the generated fake tools, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  ': > "$INVALID_SIDE_EFFECT_MARKER"' \
  'exit 99' >"$TMP/invalid-side-effect-stub"
chmod +x "$TMP/invalid-side-effect-stub"
for tool in git pnpm rm; do
  cp "$TMP/invalid-side-effect-stub" "$invalid_fake_bin/$tool"
done

assert_rejects_invalid_id() {
  local label="$1"
  shift
  local output="$TMP/invalid-$label.out"
  rm -f "$invalid_side_effect_marker"
  if (
    cd "$repo"
    PATH="$invalid_fake_bin:$PATH" \
      INVALID_SIDE_EFFECT_MARKER="$invalid_side_effect_marker" \
      LC_ALL="${TEST_WORKER_LOCALE:-${LC_ALL:-C}}" \
      TRIBUNAL_WORKER_SYNC_REF=HEAD \
      bash scripts/tribunal-worker-bootstrap.sh "$@"
  ) >"$output" 2>&1; then
    fail "$label accepted an invalid worker id"
  fi
  [ ! -e "$invalid_side_effect_marker" ] ||
    fail "$label reached a side-effect command before rejecting the id"
  grep -F 'ERROR: invalid worker id' "$output" >/dev/null ||
    fail "$label did not emit the invalid worker id diagnostic"
  pass "$label rejects an invalid worker id"
}

# The valid worker-a fixture makes this path normalize back to the main repo.
# `create` must reject it before its idempotent "already exists" branch, and
# `sync` must reject it before any fetch/reset work.
assert_rejects_invalid_id sync-traversal sync 'a/../gu-log'
assert_rejects_invalid_id create-traversal create 'a/../gu-log'

# This target intentionally does not exist, so the pre-fix `remove` path is a
# harmless success rather than exercising its destructive fallback.
assert_rejects_invalid_id remove-traversal remove 'a/../definitely-missing'

assert_rejects_invalid_id sync-parent sync '../x'
assert_rejects_invalid_id sync-slash sync 'a/b'
assert_rejects_invalid_id sync-space sync 'worker a'
assert_rejects_invalid_id sync-newline sync $'worker\na'

# Bash bracket ranges follow the active locale's collation rules. Find any
# installed locale that broadens [A-Za-z] beyond ASCII, then prove the worker
# validator remains ASCII-only under that locale.
unicode_locale=""
while IFS= read -r candidate; do
  if LC_ALL="$candidate" bash -c '[[ "é" =~ ^[A-Za-z]$ ]]' 2>/dev/null; then
    unicode_locale="$candidate"
    break
  fi
done < <(locale -a)

if [ -n "$unicode_locale" ]; then
  TEST_WORKER_LOCALE="$unicode_locale" assert_rejects_invalid_id sync-unicode sync 'é'
else
  validator_source="$repo/scripts/tribunal-worker-bootstrap.sh"
  if ! sed -n '/^validate_worker_id() {$/,/^}$/p' "$validator_source" |
    grep -Fx '  local LC_ALL=C' >/dev/null; then
    fail "worker id validator does not pin ASCII collation"
  fi
  pass "worker id validator pins ASCII collation when no broadening locale is installed"
fi

# Running the bootstrap copy inside worker-self must never let `remove self`
# target the checkout that is executing the command. Stub destructive tools
# so the pre-fix behavior is observable without deleting even this fixture.
self_repo="$TMP/gu-log-worker-self"
fake_bin="$TMP/fake-bin"
rm_marker="$TMP/remove-fallback-called"
mkdir -p "$self_repo/scripts" "$fake_bin"
cp "$BOOTSTRAP" "$self_repo/scripts/tribunal-worker-bootstrap.sh"
chmod +x "$self_repo/scripts/tribunal-worker-bootstrap.sh"
# These expressions belong to the generated fake tools, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "${1:-}" = worktree ] && [ "${2:-}" = remove ]; then exit 1; fi' \
  'exit 0' >"$fake_bin/git"
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  ': > "$FAKE_RM_MARKER"' \
  'exit 0' >"$fake_bin/rm"
chmod +x "$fake_bin/git" "$fake_bin/rm"

self_output="$TMP/remove-self.out"
if (
  cd "$self_repo"
  PATH="$fake_bin:$PATH" \
    FAKE_RM_MARKER="$rm_marker" \
    bash scripts/tribunal-worker-bootstrap.sh remove self
) >"$self_output" 2>&1; then
  fail "remove-self accepted the active repo as a worker target"
fi
grep -F 'ERROR: worker path equals active repo' "$self_output" >/dev/null ||
  fail "remove-self did not emit the active-repo diagnostic"
[ ! -e "$rm_marker" ] || fail "remove-self reached the destructive fallback"
[ -d "$self_repo" ] || fail "remove-self deleted its active repo fixture"
pass "remove-self rejects the active repo before destructive commands"

# A filesystem alias can identify the active checkout even when its path string
# differs (for example, a symlink on Linux or case-only spelling on macOS).
alias_repo="$TMP/gu-log-worker-alias"
ln -s "$self_repo" "$alias_repo"
rm -f "$rm_marker"
alias_output="$TMP/remove-self-alias.out"
if (
  cd "$self_repo"
  PATH="$fake_bin:$PATH" \
    FAKE_RM_MARKER="$rm_marker" \
    bash scripts/tribunal-worker-bootstrap.sh remove alias
) >"$alias_output" 2>&1; then
  fail "remove-self-alias accepted an alias of the active repo"
fi
grep -F 'ERROR: worker path equals active repo' "$alias_output" >/dev/null ||
  fail "remove-self-alias did not emit the active-repo diagnostic"
[ ! -e "$rm_marker" ] || fail "remove-self-alias reached the destructive fallback"
[ -L "$alias_repo" ] || fail "remove-self-alias deleted the active-repo alias"
[ -d "$self_repo" ] || fail "remove-self-alias deleted its active repo fixture"
pass "remove-self rejects a filesystem alias before destructive commands"
