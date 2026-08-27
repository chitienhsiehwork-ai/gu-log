#!/usr/bin/env bash
# Executable contract for stage-scoped summary policy propagation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

# shellcheck source=scripts/score-helpers.sh
source "$ROOT_DIR/scripts/score-helpers.sh"

[ "$(tribunal_writer_frontmatter_policy_for_stage factChecker)" = "paired-summary" ] ||
  fail "FactChecker did not receive paired-summary policy"
for stage in librarian freshEyes vibe finalBuild unknown ''; do
  [ "$(tribunal_writer_frontmatter_policy_for_stage "$stage")" = "preserve-all" ] ||
    fail "$stage unexpectedly received summary authority"
done
pass "only FactChecker routes to paired-summary policy"

if [ "$(uname -s)" != "Linux" ]; then
  echo "SKIP: Tribunal candidate CAS requires deployed Linux renameat2(RENAME_EXCHANGE)."
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/tribunal-summary-routing.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
post_dir="$TMP/posts"
candidate_dir="$TMP/candidate"
mkdir -p "$post_dir" "$candidate_dir"
chmod 700 "$candidate_dir"
zh="$post_dir/pair.mdx"
en="$post_dir/en-pair.mdx"

write_baseline_pair() {
  printf '%s\n' '---' 'summary: "old zh"' '---' 'baseline zh' > "$zh"
  printf '%s\n' '---' 'summary: "old en"' '---' 'baseline en' > "$en"
}

rewrite_candidate_summaries() {
  python3 - "$candidate_dir/pair.mdx" "$candidate_dir/en-pair.mdx" <<'PY'
import pathlib
import sys

for path_text, old, new in (
    (sys.argv[1], b'"old zh"', b'"new zh"'),
    (sys.argv[2], b'"old en"', b'"new en"'),
):
    path = pathlib.Path(path_text)
    path.write_bytes(path.read_bytes().replace(old, new, 1))
PY
}

# Every non-FactChecker stage, including finalBuild, must exercise the actual
# preserve-all capture boundary rather than merely advertise a policy string.
for stage in librarian freshEyes vibe finalBuild; do
  rm -f "$candidate_dir"/*
  write_baseline_pair
  baseline_token="$(tribunal_post_pair_snapshot_create "$zh")"
  tribunal_post_pair_candidate_materialize "$candidate_dir" "$baseline_token"
  rewrite_candidate_summaries
  policy="$(tribunal_writer_frontmatter_policy_for_stage "$stage")"
  if tribunal_post_pair_candidate_capture \
    "$candidate_dir" "$baseline_token" "$policy" \
    >"$TMP/$stage.token" 2>"$TMP/$stage.err"; then
    fail "$stage admitted a summary mutation"
  fi
  grep -Fqx 'summary: "old zh"' "$zh" ||
    fail "$stage changed canonical zh-tw bytes after rejection"
  grep -Fqx 'summary: "old en"' "$en" ||
    fail "$stage changed canonical English bytes after rejection"
  tribunal_post_pair_snapshot_discard "$baseline_token"
done
pass "non-FactChecker stages and finalBuild reject summary mutations"

rm -f "$candidate_dir"/*
write_baseline_pair
baseline_token="$(tribunal_post_pair_snapshot_create "$zh")"
tribunal_post_pair_candidate_materialize "$candidate_dir" "$baseline_token"
rewrite_candidate_summaries

candidate_token="$(
  tribunal_post_pair_candidate_capture \
    "$candidate_dir" "$baseline_token" \
    "$(tribunal_writer_frontmatter_policy_for_stage factChecker)"
)"
tribunal_post_pair_candidate_apply \
  "$zh" "$candidate_dir" "$baseline_token" \
  "$(tribunal_writer_frontmatter_policy_for_stage factChecker)"
grep -Fq 'summary: "new zh"' "$zh" || fail "shell apply lost zh-tw summary"
grep -Fq 'summary: "new en"' "$en" || fail "shell apply lost English summary"
tribunal_post_pair_snapshot_discard "$baseline_token"
tribunal_post_pair_snapshot_discard "$candidate_token"
pass "FactChecker capture and apply accept the paired summary mutation"
