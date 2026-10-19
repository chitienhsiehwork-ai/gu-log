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

pnpm_calls_before_same_sha_reset="$(wc -l <"$pnpm_calls")"
printf 'poisoned index\n' >"$TMP/gu-log-worker-a/file.txt"
git -C "$TMP/gu-log-worker-a" add file.txt
printf 'poisoned worktree\n' >>"$TMP/gu-log-worker-a/file.txt"
(
  cd "$repo"
  PATH="$fake_pnpm_bin:$PATH" \
    PNPM_CALLS="$pnpm_calls" \
    PNPM_FAILED_ONCE="$pnpm_failed_once" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh sync a
) >"$TMP/same-sha-reset.out" 2>&1
git -C "$TMP/gu-log-worker-a" diff --quiet ||
  fail "same-SHA sync preserved a tracked worktree edit"
git -C "$TMP/gu-log-worker-a" diff --cached --quiet ||
  fail "same-SHA sync preserved a tracked index edit"
cmp -s "$TMP/gu-log-worker-a/file.txt" "$repo/file.txt" ||
  fail "same-SHA sync did not restore the target blob"
[ -e "$a_ready_marker" ] ||
  fail "same-SHA reset invalidated an unchanged dependency receipt"
[ "$(wc -l <"$pnpm_calls")" -eq "$pnpm_calls_before_same_sha_reset" ] ||
  fail "same-SHA reset reran an unnecessary dependency install"
pass "same-SHA sync discards tracked poison without reinstalling dependencies"

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
printf 'keep\n' >"$prefix_path/KEEP-ME"
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

prefix_git_dir="$(git -C "$prefix_path" rev-parse --absolute-git-dir)"
prefix_ready_marker="$prefix_git_dir/tribunal-dependencies-ready"
: >"$prefix_ready_marker"
printf 'standalone staged poison\n' >"$prefix_path/file.txt"
git -C "$prefix_path" add file.txt
printf 'standalone worktree poison\n' >>"$prefix_path/file.txt"
prefix_head_before_sync="$(git -C "$prefix_path" rev-parse HEAD)"
prefix_status_before_sync="$(git -C "$prefix_path" status --porcelain=v1)"
prefix_content_before_sync="$(cat "$prefix_path/file.txt")"

prefix_sync_output="$TMP/prefix-sync-collision.out"
if (
  cd "$repo"
  PATH="$prefix_fake_bin:$PATH" \
    PREFIX_SIDE_EFFECT="$prefix_side_effect" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    bash scripts/tribunal-worker-bootstrap.sh sync prefix
) >"$prefix_sync_output" 2>&1; then
  fail "sync accepted a standalone repo through a worktree path prefix collision"
fi
grep -F 'ERROR: refusing to sync unregistered directory' "$prefix_sync_output" >/dev/null ||
  fail "sync prefix collision did not emit the unregistered-directory diagnostic"
[ "$(git -C "$prefix_path" rev-parse HEAD)" = "$prefix_head_before_sync" ] ||
  fail "sync prefix collision changed the standalone repo HEAD"
[ "$(git -C "$prefix_path" status --porcelain=v1)" = "$prefix_status_before_sync" ] ||
  fail "sync prefix collision changed tracked standalone repo state"
[ "$(cat "$prefix_path/file.txt")" = "$prefix_content_before_sync" ] ||
  fail "sync prefix collision changed tracked standalone repo content"
[ -e "$prefix_ready_marker" ] ||
  fail "sync prefix collision removed the standalone repo readiness sentinel"
[ ! -e "$prefix_side_effect" ] ||
  fail "sync prefix collision reached dependency installation"
pass "sync requires an exact registered worktree path"

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

prefix_remove_output="$TMP/prefix-remove.out"
if (
  cd "$repo"
  bash scripts/tribunal-worker-bootstrap.sh remove prefix
) >"$prefix_remove_output" 2>&1; then
  fail "remove accepted a standalone repo through a worktree path prefix collision"
fi
grep -F 'ERROR: refusing to remove unregistered directory' \
  "$prefix_remove_output" >/dev/null ||
  fail "remove prefix collision did not emit the unregistered-directory diagnostic"
[ -d "$prefix_path" ] ||
  fail "remove prefix collision deleted the standalone repo"
[ -e "$prefix_path/KEEP-ME" ] ||
  fail "remove prefix collision deleted the standalone repo sentinel"
git -C "$prefix_path" rev-parse --is-inside-work-tree >/dev/null ||
  fail "remove prefix collision damaged the standalone repo"
pass "remove requires an exact registered worktree path"

remove_fallback_bin="$TMP/remove-fallback-bin"
mkdir -p "$remove_fallback_bin"
# These expressions belong to the generated fake git, not this test shell.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "${1:-}" = worktree ] && [ "${2:-}" = remove ]; then exit 55; fi' \
  'exec "$REAL_GIT" "$@"' >"$remove_fallback_bin/git"
chmod +x "$remove_fallback_bin/git"

(
  cd "$repo"
  PATH="$remove_fallback_bin:$PATH" \
    REAL_GIT="$real_git" \
    bash scripts/tribunal-worker-bootstrap.sh remove prefix2
) >"$TMP/registered-remove-fallback.out" 2>&1
[ ! -e "$prefix2_path" ] ||
  fail "registered remove fallback did not delete its worker worktree"
if git -C "$repo" worktree list --porcelain |
  grep -Fx "worktree $prefix2_path" >/dev/null; then
  fail "registered remove fallback did not prune its worktree metadata"
fi
pass "registered worktree removal keeps its filesystem fallback"

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

# The bootstrap helper's failure must propagate through the quota-loop
# supervisor. A sync helper that fails closed is insufficient if the caller
# still launches tribunal.sh from the stale worker worktree.
make_supervisor_fixture() {
  local name="$1"
  local fixture_parent="$TMP/supervisor-$name/runtime"
  local fixture_root="$fixture_parent/gu-log"
  local worker_id

  mkdir -p \
    "$fixture_root/scripts" \
    "$fixture_root/src/content/posts" \
    "$fixture_root/.score-loop/state"
  cp \
    "$ROOT_DIR/scripts/tribunal-helpers.sh" \
    "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
    "$ROOT_DIR/scripts/tribunal-quota-loop.sh" \
    "$ROOT_DIR/scripts/tribunal-run-control.sh" \
    "$ROOT_DIR/scripts/tribunal-version.mjs" \
    "$fixture_root/scripts/"

  cat > "$fixture_root/scripts/tribunal-worker-bootstrap.sh" <<'BOOTSTRAP'
#!/usr/bin/env bash
if [ "${1:-}" != "sync" ]; then
  exit 64
fi
if [ "$#" -eq 1 ]; then
  exit "${STARTUP_SYNC_RC:-0}"
fi
case "$2" in
  a) exit "${PRE_DISPATCH_SYNC_A_RC:-0}" ;;
  b) exit "${PRE_DISPATCH_SYNC_B_RC:-0}" ;;
  *) exit 65 ;;
esac
BOOTSTRAP
  chmod +x "$fixture_root/scripts/tribunal-worker-bootstrap.sh"

  cat > "$fixture_root/scripts/tribunal-publisher-autopilot.sh" <<'PUBLISHER'
#!/usr/bin/env bash
exit 0
PUBLISHER
  chmod +x "$fixture_root/scripts/tribunal-publisher-autopilot.sh"

  cat > "$fixture_root/scripts/usage-monitor.sh" <<'USAGE'
#!/usr/bin/env bash
cat <<'JSON'
[{
  "provider": "openai",
  "status": "ok",
  "session_remaining_pct": 100,
  "session_reset_min": 300,
  "weekly_remaining_pct": 100,
  "weekly_reset_hr": 168
}]
JSON
USAGE
  chmod +x "$fixture_root/scripts/usage-monitor.sh"

  cat > "$fixture_root/src/content/posts/gp-sync-fixture.mdx" <<'ARTICLE'
---
title: "sync fixture"
translatedDate: 2026-07-28
---

fixture
ARTICLE
  if [ "$name" = "pre-dispatch-failure" ]; then
    cat > "$fixture_root/src/content/posts/gp-sync-fixture-two.mdx" <<'ARTICLE_TWO'
---
title: "sync fixture two"
translatedDate: 2026-07-27
---

fixture two
ARTICLE_TWO
  fi
  printf '{}\n' > "$fixture_root/.score-loop/state/tribunal-progress.json"

  for worker_id in a b; do
    mkdir -p \
      "$fixture_parent/gu-log-worker-$worker_id/scripts" \
      "$fixture_parent/gu-log-worker-$worker_id/src/content/posts"
    cat > "$fixture_parent/gu-log-worker-$worker_id/scripts/tribunal.sh" <<'RUNNER'
#!/usr/bin/env bash
printf '%s:%s\n' "$TRIBUNAL_WORKER_ID" "$*" >> "$RUNNER_CALLS"
sleep "${RUNNER_DELAY_SEC:-0}"
printf '%s\n' "$TRIBUNAL_WORKER_ID" >> "$RUNNER_COMPLETIONS"
exit "${RUNNER_RC:-77}"
RUNNER
    chmod +x "$fixture_parent/gu-log-worker-$worker_id/scripts/tribunal.sh"
  done

  mkdir -p "$fixture_root/fake-bin"
  cat > "$fixture_root/fake-bin/tee" <<'FAKE_TEE'
#!/usr/bin/env bash
"$REAL_TEE" "$@"
rc=$?
[ "${FAKE_TEE_FAILURE:-0}" = "1" ] && exit 1
exit "$rc"
FAKE_TEE
  chmod +x "$fixture_root/fake-bin/tee"

  git -C "$fixture_root" init -q
  git -C "$fixture_root" config user.name fixture
  git -C "$fixture_root" config user.email fixture@example.invalid
  git -C "$fixture_root" add .
  git -C "$fixture_root" commit -qm fixture

  printf '%s\n' "$fixture_root"
}

run_supervisor_case() {
  local name="$1" startup_rc="$2" sync_a_rc="$3" sync_b_rc="$4"
  local runner_rc="$5" runner_delay="$6" fake_tee_failure="$7"
  local fixture_root output rc
  fixture_root="$(make_supervisor_fixture "$name")"
  output="$TMP/supervisor-$name.out"
  : > "$TMP/supervisor-$name.runner-calls"
  : > "$TMP/supervisor-$name.runner-completions"

  set +e
  timeout 15 env \
    RUNNER_CALLS="$TMP/supervisor-$name.runner-calls" \
    RUNNER_COMPLETIONS="$TMP/supervisor-$name.runner-completions" \
    RUNNER_RC="$runner_rc" \
    RUNNER_DELAY_SEC="$runner_delay" \
    STARTUP_SYNC_RC="$startup_rc" \
    PRE_DISPATCH_SYNC_A_RC="$sync_a_rc" \
    PRE_DISPATCH_SYNC_B_RC="$sync_b_rc" \
    FAKE_TEE_FAILURE="$fake_tee_failure" \
    REAL_TEE="$(command -v tee)" \
    TRIBUNAL_WORKER_SYNC_REF=HEAD \
    USAGE_MONITOR="$fixture_root/scripts/usage-monitor.sh" \
    AUTOSCALE_MOCK_MEMORY_CURRENT=1 \
    AUTOSCALE_MOCK_MEMORY_MAX=10000000000 \
    AUTOSCALE_MOCK_OOM=0 \
    MIN_COOLDOWN=1 \
    RC_SLICE_SEC=1 \
    PATH="$fixture_root/fake-bin:$PATH" \
    bash "$fixture_root/scripts/tribunal-quota-loop.sh" --workers 2 \
      > "$output" 2>&1
  rc=$?
  set -e
  printf '%s\n' "$rc"
}

startup_rc="$(run_supervisor_case startup-failure 42 0 0 77 0 0)"
[ "$startup_rc" -eq 78 ] || {
  sed -n '1,160p' "$TMP/supervisor-startup-failure.out" >&2
  fail "startup sync rc=42 should fail the supervisor closed with rc=78, got $startup_rc"
}
[ ! -s "$TMP/supervisor-startup-failure.runner-calls" ] ||
  fail "startup sync failure reached the article runner"
startup_state="$TMP/supervisor-startup-failure/runtime/gu-log/.score-loop/state/runtime.json"
grep -Fq 'worker_sync_failed phase=startup' "$startup_state" ||
  fail "startup sync failure was not persisted as observable drain state"
grep -Fq 'bootstrap_rc=42' "$startup_state" ||
  fail "startup sync failure state lost the bootstrap rc"
pass "startup sync failure exits rc=78 before every runner"

pre_dispatch_rc="$(run_supervisor_case pre-dispatch-failure 0 0 42 0 0.2 0)"
[ "$pre_dispatch_rc" -eq 78 ] || {
  sed -n '1,200p' "$TMP/supervisor-pre-dispatch-failure.out" >&2
  fail "pre-dispatch sync rc=42 should fail the supervisor closed with rc=78, got $pre_dispatch_rc"
}
[ "$(wc -l < "$TMP/supervisor-pre-dispatch-failure.runner-calls")" -eq 1 ] ||
  fail "pre-dispatch sync failure should drain exactly one already-running worker"
grep -Fxq 'a:gp-sync-fixture.mdx' \
  "$TMP/supervisor-pre-dispatch-failure.runner-calls" ||
  fail "pre-dispatch sync failure launched an unexpected worker/article"
[ "$(wc -l < "$TMP/supervisor-pre-dispatch-failure.runner-completions")" -eq 1 ] ||
  fail "supervisor exited before the in-flight worker completed"
grep -Fxq 'a' "$TMP/supervisor-pre-dispatch-failure.runner-completions" ||
  fail "worker-a completion was not observed"
pre_dispatch_root="$TMP/supervisor-pre-dispatch-failure/runtime/gu-log"
if find "$pre_dispatch_root/.score-loop/claims" \
  -mindepth 1 -print -quit | grep -q .; then
  fail "pre-dispatch sync failure left a stale article claim"
fi
grep -Fq 'worker_sync_failed phase=pre_dispatch' \
  "$pre_dispatch_root/.score-loop/state/runtime.json" ||
  fail "pre-dispatch sync failure was not persisted as observable drain state"
grep -Fq 'bootstrap_rc=42' \
  "$pre_dispatch_root/.score-loop/state/runtime.json" ||
  fail "pre-dispatch sync failure state lost the bootstrap rc"
dispatch_count="$(
  jq -s '[.[] | select(.event == "dispatch")] | length' \
    "$pre_dispatch_root/.score-loop/state/quota-history.jsonl"
)"
[ "$dispatch_count" -eq 1 ] ||
  fail "pre-dispatch sync failure should retain exactly one real dispatch event, got $dispatch_count"
grep -Fq '[worker-a] gp-sync-fixture — PASSED' \
  "$TMP/supervisor-pre-dispatch-failure.out" ||
  fail "supervisor did not collect worker-a before its fatal exit"
grep -Fq 'claim_released=true' "$TMP/supervisor-pre-dispatch-failure.out" ||
  fail "fatal supervisor log omitted released-claim detail"
if grep -Fq 'with claim retained' "$TMP/supervisor-pre-dispatch-failure.out"; then
  fail "released pre-dispatch claim was logged as retained"
fi
pass "pre-dispatch sync failure drains one in-flight worker and records only its real dispatch"

success_rc="$(run_supervisor_case sync-success 0 0 0 77 0 1)"
[ "$success_rc" -eq 0 ] || {
  sed -n '1,200p' "$TMP/supervisor-sync-success.out" >&2
  fail "successful startup + pre-dispatch sync should preserve the clean runner path, got $success_rc"
}
[ "$(wc -l < "$TMP/supervisor-sync-success.runner-calls")" -eq 1 ] ||
  fail "successful sync path should reach exactly one article runner"
[ "$(wc -l < "$TMP/supervisor-sync-success.runner-completions")" -eq 1 ] ||
  fail "successful sync path should collect its runner despite a nonzero tlog status"
success_root="$TMP/supervisor-sync-success/runtime/gu-log"
if find "$success_root/.score-loop/claims" \
  -mindepth 1 -print -quit | grep -q .; then
  fail "successful worker completion left a stale article claim"
fi
jq -e 'select(.event == "dispatch")' \
  "$success_root/.score-loop/state/quota-history.jsonl" >/dev/null ||
  fail "successful sync path lost dispatch telemetry"
pass "successful worker synchronization preserves one dispatch and clean claim release"
