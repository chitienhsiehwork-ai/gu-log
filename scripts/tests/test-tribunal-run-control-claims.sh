#!/usr/bin/env bash
# Concurrency regressions for Tribunal article-claim lifecycle.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUN_CONTROL="$ROOT_DIR/scripts/tribunal-run-control.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-claims.XXXXXX")"
PIDS=()

cleanup() {
  if [ "${#PIDS[@]}" -gt 0 ]; then
    kill "${PIDS[@]}" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "x $*" >&2
  exit 1
}

pass() {
  echo "ok $*"
}

wait_for_file() {
  local file="$1"
  local attempts=0
  while [ ! -f "$file" ] && [ "$attempts" -lt 500 ]; do
    sleep 0.01
    attempts=$((attempts + 1))
  done
  [ -f "$file" ] || fail "timed out waiting for $file"
}

write_stale_claim() {
  local slug="$1"
  local claim_dir="$RC_CLAIMS_DIR/${slug}.claim"
  mkdir -p "$claim_dir"
  printf '%s\n' \
    'pid=' \
    'worker=crashed-worker' \
    'started=2000-01-01T00:00:00+0000' \
    >"$claim_dir/meta"
}

export RC_ROOT_DIR="$TMP/runtime"
export RC_CLAIMS_DIR="$RC_ROOT_DIR/.score-loop/claims"

# shellcheck source=scripts/tribunal-run-control.sh
source "$RUN_CONTROL"

[ "$RC_CLAIMS_LOCK" = "$RC_ROOT_DIR/.score-loop/claims.lock" ] ||
  fail "claims lock default escaped the shared runtime coordination directory"
git -C "$ROOT_DIR" check-ignore -q ".score-loop/claims.lock" ||
  fail "claims lock runtime artifact is not ignored by git"
pass "claims lock uses the ignored shared runtime path"

slug="held-lock"
write_stale_claim "$slug"
exec 8>>"$RC_CLAIMS_LOCK"
flock -x 8
(
  exec 8>&-
  flock() {
    : >"$TMP/claim-flock-attempted"
    command flock "$@"
  }
  claim_rc=0
  rc_try_claim "$slug" "worker-held" || claim_rc=$?
  printf '%s\n' "$claim_rc" >"$TMP/claim-status"
  : >"$TMP/claim-done"
) &
claim_pid=$!
PIDS+=("$claim_pid")
wait_for_file "$TMP/claim-flock-attempted"
[ ! -f "$TMP/claim-done" ] ||
  fail "rc_try_claim bypassed the shared stale-recovery lock"
rc_release_claim "$slug"
rc_try_claim "$slug" "fresh-worker" ||
  fail "failed to install a fresh claim while stale recovery was waiting"
flock -u 8
wait_for_file "$TMP/claim-done"
wait "$claim_pid" || fail "rc_try_claim child exited non-zero"
[ "$(cat "$TMP/claim-status")" = "1" ] ||
  fail "waiting stale recovery deleted and replaced a fresh claim"
grep -Fxq 'worker=fresh-worker' "$RC_CLAIMS_DIR/$slug.claim/meta" ||
  fail "waiting stale recovery did not preserve fresh claim metadata"
PIDS=()
pass "stale claim recovery rechecks and preserves a fresh replacement"

rc_release_claim "$slug"
write_stale_claim "dual-contender"
flock -x 8
for worker in a b; do
  (
    exec 8>&-
    : >"$TMP/$worker-started"
    claim_rc=0
    rc_try_claim "dual-contender" "worker-$worker" || claim_rc=$?
    printf '%s\n' "$claim_rc" >"$TMP/$worker-status"
    : >"$TMP/$worker-done"
  ) &
  PIDS+=("$!")
done
wait_for_file "$TMP/a-started"
wait_for_file "$TMP/b-started"
flock -u 8
wait_for_file "$TMP/a-done"
wait_for_file "$TMP/b-done"
for pid in "${PIDS[@]}"; do
  wait "$pid" || fail "claim contender child exited non-zero"
done
PIDS=()
successes=0
for status_file in "$TMP/a-status" "$TMP/b-status"; do
  if [ "$(cat "$status_file")" = "0" ]; then
    successes=$((successes + 1))
  fi
done
[ "$successes" -eq 1 ] ||
  fail "stale recovery admitted $successes claimers instead of exactly one"
pass "stale recovery admits exactly one concurrent claimant"

rc_release_claim "dual-contender"
write_stale_claim "gc-held-lock"
flock -x 8
(
  exec 8>&-
  flock() {
    : >"$TMP/gc-flock-attempted"
    command flock "$@"
  }
  rc_gc_stale_claims
  : >"$TMP/gc-done"
) &
gc_pid=$!
PIDS+=("$gc_pid")
wait_for_file "$TMP/gc-flock-attempted"
[ ! -f "$TMP/gc-done" ] ||
  fail "stale-claim GC bypassed the shared stale-recovery lock"
rc_release_claim "gc-held-lock"
rc_try_claim "gc-held-lock" "fresh-gc-worker" ||
  fail "failed to install a fresh claim while stale-claim GC was waiting"
flock -u 8
wait_for_file "$TMP/gc-done"
wait "$gc_pid" || fail "stale-claim GC child exited non-zero"
PIDS=()
[ -d "$RC_CLAIMS_DIR/gc-held-lock.claim" ] ||
  fail "stale-claim GC deleted a fresh replacement"
grep -Fxq 'worker=fresh-gc-worker' "$RC_CLAIMS_DIR/gc-held-lock.claim/meta" ||
  fail "stale-claim GC did not preserve fresh claim metadata"
pass "stale-claim GC rechecks and preserves a fresh replacement"
