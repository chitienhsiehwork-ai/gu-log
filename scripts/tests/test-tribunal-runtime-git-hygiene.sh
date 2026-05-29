#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$ROOT_DIR/scripts/tribunal-helpers.sh"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

origin="$TMP/origin.git"
seed="$TMP/seed"
runtime="$TMP/runtime"
publisher="$TMP/publisher"
log="$TMP/fetch.log"

git init --bare "$origin" >/dev/null
git clone "$origin" "$seed" >/dev/null 2>&1
git -C "$seed" config user.email test@example.invalid
git -C "$seed" config user.name "Tribunal Test"
printf 'base\n' > "$seed/post.txt"
git -C "$seed" add post.txt
git -C "$seed" commit -m "base" >/dev/null
git -C "$seed" push origin HEAD:main >/dev/null 2>&1

git clone "$origin" "$runtime" >/dev/null 2>&1
git -C "$runtime" checkout -b tribunal-runtime origin/main >/dev/null 2>&1
git -C "$runtime" config user.email test@example.invalid
git -C "$runtime" config user.name "Tribunal Runtime"

printf 'runtime local\n' >> "$runtime/post.txt"
git -C "$runtime" add post.txt
git -C "$runtime" commit -m "local runtime progress" >/dev/null
before_head="$(git -C "$runtime" rev-parse HEAD)"

git clone "$origin" "$publisher" >/dev/null 2>&1
git -C "$publisher" checkout main >/dev/null 2>&1
git -C "$publisher" config user.email test@example.invalid
git -C "$publisher" config user.name "Publisher"
printf 'remote main\n' >> "$publisher/post.txt"
git -C "$publisher" add post.txt
git -C "$publisher" commit -m "remote main update" >/dev/null
git -C "$publisher" push origin HEAD:main >/dev/null 2>&1

state_file="$TMP/runtime-git.json"
summary="$(tribunal_fetch_and_report_origin_main "$runtime" "$log" "$state_file")"
after_head="$(git -C "$runtime" rev-parse HEAD)"

[ "$before_head" = "$after_head" ] || fail "fetch-only drift check mutated runtime HEAD"
[ "$(jq -r '.state' "$state_file")" = "diverged" ] || fail "expected diverged state"
[ "$(jq -r '.ahead' "$state_file")" = "1" ] || fail "expected ahead=1"
[ "$(jq -r '.behind' "$state_file")" = "1" ] || fail "expected behind=1"
[ "$(printf '%s' "$summary" | cut -d'|' -f1)" = "true" ] || fail "fetch should report success"
pass "fetch-only drift check updates observability without rebasing runtime"

if grep -q 'git pull --rebase' "$ROOT_DIR/scripts/tribunal-quota-loop.sh"; then
  fail "quota loop still contains git pull --rebase"
fi
pass "quota loop no longer hardcodes pull --rebase"
