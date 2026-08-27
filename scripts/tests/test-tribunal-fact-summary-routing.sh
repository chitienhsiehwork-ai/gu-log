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

runner_stage_body="$(sed -n '/^run_stage()/,/^}/p' "$ROOT_DIR/scripts/tribunal.sh")"
final_repair_body="$(
  sed -n '/^repair_final_build_failure()/,/^}/p' "$ROOT_DIR/scripts/tribunal.sh"
)"
stage_policy_call="\"\$writer_frontmatter_policy\" || writer_rc=\$?"
grep -Fq "tribunal_writer_frontmatter_policy_for_stage \"\$stage_key\"" \
  <<<"$runner_stage_body" ||
  fail "judge loop does not derive writer policy from the parent stage"
grep -Fq "$stage_policy_call" \
  <<<"$runner_stage_body" ||
  fail "judge loop does not pass its derived policy into the transaction"
grep -Fq '"preserve-all" || writer_rc=$?' <<<"$final_repair_body" ||
  fail "final-build repair does not explicitly preserve all frontmatter"
pass "judge and final-build callers pass parent-owned policy explicitly"

for contract in \
  "$ROOT_DIR/.codex/agents/tribunal-writer.toml" \
  "$ROOT_DIR/.claude/agents/tribunal-writer.md"; do
  if ! grep -Fq 'runner-authorized' "$contract" ||
     ! grep -Fq 'FactChecker' "$contract"; then
    fail "$(basename "$contract") omits the FactChecker-only exception"
  fi
  grep -Fq 'cannot' "$contract" ||
    fail "$(basename "$contract") does not deny prompt-based elevation"
done
grep -Fq 'FactChecker retry exception:' "$ROOT_DIR/scripts/tribunal.sh" ||
  fail "FactChecker rewrite prompt omits its paired summary contract"
grep -Fq 'Final-build repair has no frontmatter authority' \
  "$ROOT_DIR/scripts/tribunal.sh" ||
  fail "final-build prompt does not preserve all frontmatter"
grep -Fq 'Writer candidate 的 frontmatter 邊界' \
  "$ROOT_DIR/docs/tribunal-runbook.md" ||
  fail "Tribunal runbook omits the candidate frontmatter boundary"
grep -Fq 'unsupported … summary shape' "$ROOT_DIR/docs/tribunal-runbook.md" ||
  fail "Tribunal runbook omits unsupported-shape diagnosis"
pass "writer contracts describe the narrow exception without granting authority"

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
printf '%s\n' '---' 'summary: "old zh"' '---' 'baseline zh' > "$zh"
printf '%s\n' '---' 'summary: "old en"' '---' 'baseline en' > "$en"

baseline_token="$(tribunal_post_pair_snapshot_create "$zh")"
tribunal_post_pair_candidate_materialize "$candidate_dir" "$baseline_token"
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

candidate_token="$(
  tribunal_post_pair_candidate_capture \
    "$candidate_dir" "$baseline_token" paired-summary
)"
tribunal_post_pair_candidate_apply \
  "$zh" "$candidate_dir" "$baseline_token" paired-summary
grep -Fq 'summary: "new zh"' "$zh" || fail "shell apply lost zh-tw summary"
grep -Fq 'summary: "new en"' "$en" || fail "shell apply lost English summary"

validation_rc=1
if [ "$validation_rc" -ne 0 ]; then
  tribunal_post_pair_candidate_rollback \
    "$zh" "$baseline_token" "$candidate_token" paired-summary
fi
grep -Fq 'summary: "old zh"' "$zh" || fail "shell rollback lost zh-tw baseline"
grep -Fq 'summary: "old en"' "$en" || fail "shell rollback lost English baseline"
tribunal_post_pair_snapshot_discard "$baseline_token"
pass "capture, apply, and validation-failure rollback share the explicit summary policy"
