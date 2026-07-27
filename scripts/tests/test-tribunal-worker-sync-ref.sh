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
a_git_dir="$(git -C "$TMP/gu-log-worker-a" rev-parse --absolute-git-dir)"
: >"$a_git_dir/tribunal-dependencies-ready"
printf 'two\n' >> "$repo/file.txt"
git -C "$repo" add file.txt
git -C "$repo" commit -q -m second

(cd "$repo" && TRIBUNAL_WORKER_SYNC_REF=HEAD bash scripts/tribunal-worker-bootstrap.sh sync a >"$TMP/worker-sync.out" 2>&1)

main_sha="$(git -C "$repo" rev-parse HEAD)"
worker_sha="$(git -C "$TMP/gu-log-worker-a" rev-parse HEAD)"
[ "$main_sha" = "$worker_sha" ] || fail "worker did not sync to supervisor HEAD"
pass "worker sync can follow supervisor HEAD instead of origin/main"

missing_output="$TMP/missing-worker.out"
if (
  cd "$repo"
  TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh sync definitely-missing
) >"$missing_output" 2>&1; then
  fail "sync accepted a valid but missing worker id"
fi
grep -F 'No worker worktree matches id=definitely-missing' "$missing_output" >/dev/null ||
  fail "missing worker did not emit its diagnostic"
pass "sync fails when a requested worker does not exist"

fake_fetch_bin="$TMP/fake-fetch-bin"
mkdir -p "$fake_fetch_bin"
real_git="$(command -v git)"
# These expressions belong to the generated fake git, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "${1:-}" = fetch ]; then exit 55; fi' \
  'exec "$REAL_GIT" "$@"' >"$fake_fetch_bin/git"
chmod +x "$fake_fetch_bin/git"

fetch_output="$TMP/fetch-failure.out"
if (
  cd "$repo"
  PATH="$fake_fetch_bin:$PATH" \
    REAL_GIT="$real_git" \
    TRIBUNAL_WORKER_SYNC_REF=origin/main \
    bash scripts/tribunal-worker-bootstrap.sh sync a
) >"$fetch_output" 2>&1; then
  fail "sync hid a remote-ref fetch failure"
fi
grep -F 'ERROR: git fetch origin/main failed' "$fetch_output" >/dev/null ||
  fail "remote-ref fetch failure did not emit its diagnostic"
pass "sync fails closed when its remote ref cannot be refreshed"

git -C "$repo" worktree add "$TMP/gu-log-worker-b" HEAD >/dev/null 2>&1
b_git_dir="$(git -C "$TMP/gu-log-worker-b" rev-parse --absolute-git-dir)"
: >"$b_git_dir/tribunal-dependencies-ready"
printf '{"name":"worker-sync-status-test"}\n' >"$repo/package.json"
git -C "$repo" add package.json
git -C "$repo" commit -q -m package-change

fake_pnpm_bin="$TMP/fake-pnpm-bin"
pnpm_calls="$TMP/pnpm-calls"
pnpm_failed_once="$TMP/pnpm-failed-once"
mkdir -p "$fake_pnpm_bin"
# These expressions belong to the generated fake pnpm, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'worker="$(basename "$PWD")"' \
  'printf "%s\n" "$worker" >> "$PNPM_CALLS"' \
  'if [ "$worker" = gu-log-worker-a ] && [ ! -e "$PNPM_FAILED_ONCE" ]; then' \
  '  : > "$PNPM_FAILED_ONCE"' \
  '  exit 42' \
  'fi' \
  'exit 0' >"$fake_pnpm_bin/pnpm"
chmod +x "$fake_pnpm_bin/pnpm"

pnpm_output="$TMP/pnpm-failure.out"
if (
  cd "$repo"
  PATH="$fake_pnpm_bin:$PATH" \
    PNPM_CALLS="$pnpm_calls" \
    PNPM_FAILED_ONCE="$pnpm_failed_once" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh sync
) >"$pnpm_output" 2>&1; then
  fail "sync hid a pnpm install failure"
fi
[ -e "$pnpm_failed_once" ] || fail "pnpm failure fixture was not exercised"
grep -F 'ERROR: pnpm install failed for worker-a' "$pnpm_output" >/dev/null ||
  fail "pnpm install failure did not emit its diagnostic"
grep -Fx 'gu-log-worker-b' "$pnpm_calls" >/dev/null ||
  fail "worker-b install did not continue after worker-a failed"

a_ready_marker="$a_git_dir/tribunal-dependencies-ready"
b_ready_marker="$b_git_dir/tribunal-dependencies-ready"
[ ! -e "$a_ready_marker" ] ||
  fail "worker-a stayed dependency-ready after its install failed"
[ -e "$b_ready_marker" ] ||
  fail "worker-b did not record its successful install"

main_sha="$(git -C "$repo" rev-parse HEAD)"
for worker in a b; do
  worker_sha="$(git -C "$TMP/gu-log-worker-$worker" rev-parse HEAD)"
  [ "$main_sha" = "$worker_sha" ] ||
    fail "worker-$worker reset did not complete during best-effort sync"
done
pass "sync reports one install failure but continues updating other workers"

(
  cd "$repo"
  PATH="$fake_pnpm_bin:$PATH" \
    PNPM_CALLS="$pnpm_calls" \
    PNPM_FAILED_ONCE="$pnpm_failed_once" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh sync a
) >"$TMP/pnpm-retry.out" 2>&1
[ "$(grep -c '^gu-log-worker-a$' "$pnpm_calls")" -eq 2 ] ||
  fail "same-SHA sync did not retry worker-a's failed install"
[ -e "$a_ready_marker" ] ||
  fail "worker-a did not record its successful retry"
pass "same-SHA sync retries and records a recovered dependency install"

create_pnpm_bin="$TMP/create-pnpm-bin"
create_calls="$TMP/create-pnpm-calls"
create_failed_once="$TMP/create-pnpm-failed-once"
mkdir -p "$create_pnpm_bin"
# These expressions belong to the generated fake pnpm, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "called\n" >> "$CREATE_PNPM_CALLS"' \
  'if [ ! -e "$CREATE_PNPM_FAILED_ONCE" ]; then' \
  '  : > "$CREATE_PNPM_FAILED_ONCE"' \
  '  exit 42' \
  'fi' \
  'exit 0' >"$create_pnpm_bin/pnpm"
chmod +x "$create_pnpm_bin/pnpm"

create_output="$TMP/create-failure.out"
if (
  cd "$repo"
  PATH="$create_pnpm_bin:$PATH" \
    CREATE_PNPM_CALLS="$create_calls" \
    CREATE_PNPM_FAILED_ONCE="$create_failed_once" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh create c
) >"$create_output" 2>&1; then
  fail "create hid its initial pnpm install failure"
fi
grep -F 'ERROR: pnpm install failed for worker-c' "$create_output" >/dev/null ||
  fail "create install failure did not emit its diagnostic"
[ -d "$TMP/gu-log-worker-c" ] ||
  fail "create failure fixture did not leave the worktree to repair"
c_git_dir="$(git -C "$TMP/gu-log-worker-c" rev-parse --absolute-git-dir)"
c_ready_marker="$c_git_dir/tribunal-dependencies-ready"
[ ! -e "$c_ready_marker" ] ||
  fail "failed create incorrectly recorded dependency readiness"

(
  cd "$repo"
  PATH="$create_pnpm_bin:$PATH" \
    CREATE_PNPM_CALLS="$create_calls" \
    CREATE_PNPM_FAILED_ONCE="$create_failed_once" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh create c
) >"$TMP/create-repair.out" 2>&1
[ "$(wc -l <"$create_calls")" -eq 2 ] ||
  fail "re-running create did not repair its failed install"
[ -e "$c_ready_marker" ] ||
  fail "create repair did not record dependency readiness"
pass "re-running create repairs an interrupted initial worker install"

prefix_path="$TMP/gu-log-worker-prefix"
prefix2_path="$TMP/gu-log-worker-prefix2"
git clone -q "$repo" "$prefix_path"
git -C "$repo" worktree add "$prefix2_path" HEAD >/dev/null 2>&1
prefix_fake_bin="$TMP/prefix-fake-bin"
prefix_side_effect="$TMP/prefix-pnpm-called"
mkdir -p "$prefix_fake_bin"
# This expression belongs to the generated fake pnpm, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  ': > "$PREFIX_SIDE_EFFECT"' \
  'exit 0' >"$prefix_fake_bin/pnpm"
chmod +x "$prefix_fake_bin/pnpm"

prefix_output="$TMP/prefix-collision.out"
if (
  cd "$repo"
  PATH="$prefix_fake_bin:$PATH" \
    PREFIX_SIDE_EFFECT="$prefix_side_effect" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh create prefix
) >"$prefix_output" 2>&1; then
  fail "create accepted a standalone repo through a worktree path prefix collision"
fi
grep -F 'ERROR: directory exists but git does not recognize it as a worktree' \
  "$prefix_output" >/dev/null ||
  fail "prefix collision did not emit the unregistered-directory diagnostic"
[ ! -e "$prefix_side_effect" ] ||
  fail "prefix collision reached dependency installation"
pass "create requires an exact registered worktree path"

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
