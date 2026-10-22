#!/usr/bin/env bash
# Regression tests for tribunal-batch-runner.sh in a fixture checkout (#1164):
# - a fresh checkout (empty runtime ledger) skips posts whose frontmatter
#   already carries a complete current-version scorecard;
# - a bounded run works with no usage-monitor at all, reads quota from
#   CodexBar like the daemon, and fails closed without a reading.
# No Codex/Claude calls: tribunal.sh, codex, codexbar and sleep are fakes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-batch-select.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

fixture="$tmp_dir/gu-log"
posts="$fixture/src/content/posts"
fake_bin="$tmp_dir/bin"
calls="$tmp_dir/tribunal-calls"
mkdir -p "$fixture/scripts" "$posts" "$fake_bin"
cp "$ROOT_DIR/scripts/tribunal-batch-runner.sh" \
  "$ROOT_DIR/scripts/tribunal-helpers.sh" \
  "$ROOT_DIR/scripts/tribunal-version.mjs" \
  "$fixture/scripts/"

cat > "$fixture/scripts/tribunal.sh" <<'FAKE_TRIBUNAL'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TRIBUNAL_FAKE_CALLS"
FAKE_TRIBUNAL
# `codex exec --help` must succeed for the provider resolver; codexbar fails so
# only an injected reading can pass; sleep skips the inter-article cooldown.
printf '#!/bin/sh\nexit 0\n' > "$fake_bin/codex"
printf '#!/bin/sh\nexit 1\n' > "$fake_bin/codexbar"
printf '#!/bin/sh\nexit 0\n' > "$fake_bin/sleep"
chmod +x "$fixture/scripts/tribunal.sh" "$fake_bin/codex" "$fake_bin/codexbar" "$fake_bin/sleep"

current="$(node "$ROOT_DIR/scripts/tribunal-version.mjs" current)"
previous=$((current - 1))

# write_post <file> <translatedDate> [<scores.tribunalVersion> <judge>...]
write_post() {
  local file="$1" translated_date="$2" version="${3:-}" judge
  {
    printf '%s\n' '---' "title: $file" "translatedDate: $translated_date"
    if [ -n "$version" ]; then
      printf '%s\n' 'scores:' "  tribunalVersion: $version"
      shift 3
      for judge in "$@"; do
        printf '%s\n' "  $judge:" '    score: 8'
      done
    fi
    printf '%s\n' '---' 'body'
  } > "$posts/$file"
}

all_judges=(librarian factCheck freshEyes vibe)
write_post a-unscored.mdx 2026-01-09
write_post b-scored-current.mdx 2026-01-08 "$current" "${all_judges[@]}"
write_post c-en-sidecar-gap.mdx 2026-01-07 "$current" "${all_judges[@]}"
write_post en-c-en-sidecar-gap.mdx 2026-01-07 "$current" librarian factCheck vibe
write_post d-scored-with-en.mdx 2026-01-06 "$current" "${all_judges[@]}"
write_post en-d-scored-with-en.mdx 2026-01-06 "$current" "${all_judges[@]}"
write_post e-previous-version.mdx 2026-01-05 "$previous" "${all_judges[@]}"
write_post f-missing-judge.mdx 2026-01-04 "$current" librarian freshEyes vibe
write_post g-ledger-failed.mdx 2026-01-03 "$current" "${all_judges[@]}"
write_post h-ledger-older-pass.mdx 2026-01-02 "$current" "${all_judges[@]}"

mkdir -p "$fixture/.score-loop/state"
jq -n --argjson cur "$current" --argjson prev "$previous" '{
  "g-ledger-failed.mdx": {tribunalVersion: $cur, status: "FAILED"},
  "h-ledger-older-pass.mdx": {tribunalVersion: $prev, status: "PASS"}
}' > "$fixture/.score-loop/state/tribunal-progress.json"

git -C "$fixture" init -q

# run_batch <args...>: runs the copied batch runner; sets BATCH_RC/BATCH_OUT.
run_batch() {
  : > "$calls"
  set +e
  BATCH_OUT="$(
    env -u USAGE_MONITOR -u GP_WRITER_MODE -u GP_JUDGE_ALLOW_CLAUDE \
      -u TRIBUNAL_STRICT_ROLE_PROVIDERS -u QUOTA_FLOOR -u TRIBUNAL_MAIN_REPO \
      PATH="$fake_bin:$PATH" \
      TRIBUNAL_FORCE_PROVIDER=codex \
      TRIBUNAL_QUOTA_NOW_EPOCH=1800000000 \
      TRIBUNAL_FAKE_CALLS="$calls" \
      bash "$fixture/scripts/tribunal-batch-runner.sh" "$@" 2>&1
  )"
  BATCH_RC=$?
  set -e
}

# codex_json <5h used %> <weekly used %>
codex_json() {
  printf '[{"provider":"codex","source":"cli","usage":{"primary":{"usedPercent":%s,"windowMinutes":300,"resetsAt":1800003600},"secondary":{"usedPercent":%s,"windowMinutes":10080,"resetsAt":1800300000}}}]\n' "$1" "$2"
}

expected_selection="$(printf '%s\n' \
  a-unscored.mdx \
  c-en-sidecar-gap.mdx \
  e-previous-version.mdx \
  f-missing-judge.mdx \
  g-ledger-failed.mdx)"

run_batch --dry-run
[ "$BATCH_RC" -eq 0 ] || fail "dry run failed: rc=$BATCH_RC $BATCH_OUT"
selection="$(printf '%s\n' "$BATCH_OUT" | sed -n 's/.*\] \[batch\]   [0-9]*\. //p')"
[ "$selection" = "$expected_selection" ] ||
  fail "fresh-checkout selection is wrong; got:
$selection"
pass "posts with a complete current-version scorecard (and English sidecar) are skipped when the ledger has no current entry"
pass "a current-version ledger entry still wins over the frontmatter"

TRIBUNAL_QUOTA_CODEXBAR_JSON="$(codex_json 20 30)" run_batch --max 2
[ "$BATCH_RC" -eq 0 ] || fail "bounded run without usage-monitor failed: rc=$BATCH_RC $BATCH_OUT"
[ "$(cat "$calls")" = "$(printf '%s\n' a-unscored.mdx c-en-sidecar-gap.mdx)" ] ||
  fail "bounded run judged the wrong articles: $(cat "$calls")"
case "$BATCH_OUT" in *"minimum=70%"*"floor: 10%"*) ;; *) fail "run did not log the CodexBar reading against the default floor: $BATCH_OUT" ;; esac
pass "bounded run reads CodexBar quota with no usage-monitor and judges the newest unscored articles"

run_batch --max 2
[ "$BATCH_RC" -eq 1 ] || fail "run without a quota reading must fail closed with rc 1: rc=$BATCH_RC $BATCH_OUT"
[ ! -s "$calls" ] || fail "run without a quota reading still judged: $(cat "$calls")"
pass "no CodexBar reading: the batch judges nothing and exits 1"

TRIBUNAL_QUOTA_CODEXBAR_JSON="$(codex_json 20 30)" run_batch --max 2 --floor 75
[ "$BATCH_RC" -eq 0 ] || fail "quota at the floor is a normal stop: rc=$BATCH_RC $BATCH_OUT"
[ ! -s "$calls" ] || fail "quota at the floor still judged: $(cat "$calls")"
pass "--floor overrides QUOTA_FLOOR and stops before judging"
