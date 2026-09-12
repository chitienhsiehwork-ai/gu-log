#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

tmp_dir="$(mktemp -d)"
runtime_root="$tmp_dir/runtime"
mkdir -p "$runtime_root/.codex" "$runtime_root/src/content/posts" \
  "$runtime_root/src/utils" "$runtime_root/src/lib"
cp -a "$SOURCE_ROOT/scripts" "$runtime_root/"
cp "$SOURCE_ROOT/src/utils/tribunal-scores.ts" "$runtime_root/src/utils/"
cp -a "$SOURCE_ROOT/src/lib/tribunal-v2" "$runtime_root/src/lib/"
cp -a "$SOURCE_ROOT/.codex/agents" "$runtime_root/.codex/"
cp -a "$SOURCE_ROOT/config" "$runtime_root/"
cp "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/GU-LOG_WRITER_PROMPT.md" \
  "$SOURCE_ROOT/CONTRIBUTING.md" "$runtime_root/"
ln -s "$SOURCE_ROOT/node_modules" "$runtime_root/node_modules"
git -C "$runtime_root" init -q
git -C "$runtime_root" config user.email "tribunal-fixture@example.invalid"
git -C "$runtime_root" config user.name "Tribunal Fixture"

ROOT_DIR="$runtime_root"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"
REQUEUE="$ROOT_DIR/scripts/tribunal-requeue.sh"
gp_article="gp-999997-needs-review-$$.mdx"
non_gp_article="mp-999997-needs-review-$$.mdx"
race_article="gp-999996-needs-review-race-$$.mdx"
gp_path="$ROOT_DIR/src/content/posts/$gp_article"
non_gp_path="$ROOT_DIR/src/content/posts/$non_gp_article"
race_path="$ROOT_DIR/src/content/posts/$race_article"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

write_fixture() {
  local path="$1" ticket="$2"
  cat > "$path" <<EOF
---
ticketId: "$ticket"
title: "NEEDS_REVIEW deterministic fixture"
originalDate: 2026-08-31
translatedDate: 2026-08-31
source: "Fixture"
sourceUrl: "https://example.com/source"
summary: "Reader-visible summary."
lang: zh-tw
translatedBy:
  model: "Opus 4.6"
  harness: "Tribunal Fixture"
tags: ["fixture"]
scores:
  tribunalVersion: 1
  factCheck:
    accuracy: 9
    fidelity: 9
    consistency: 9
    sourceBoundary: 9
    commentarySeparation: 9
    date: "2026-08-31"
    model: "gpt-5.5"
    score: 9
  librarian:
    glossary: 9
    crossRef: 9
    sourceAlign: 9
    attribution: 9
    date: "2026-08-31"
    model: "gpt-5.5"
    score: 9
  freshEyes:
    readability: 9
    firstImpression: 9
    payoffDensity: 9
    lengthFit: 9
    clarity: 9
    date: "2026-08-31"
    model: "gpt-5.5"
    score: 9
  vibe:
    persona: 9
    moguNote: 9
    vibe: 9
    narrative: 9
    date: "2026-08-31"
    model: "gpt-5.5"
    score: 9
---

This reader-visible fixture body is long enough for deterministic Tribunal testing. It intentionally receives a valid FactChecker failure from a local fake judge and never reaches a real model provider (◍•ᴗ•◍)
EOF
}

write_fixture "$gp_path" "GP-999997"
write_fixture "$non_gp_path" "MP-999997"
write_fixture "$race_path" "GP-999996"
git -C "$ROOT_DIR" add src/content/posts
git -C "$ROOT_DIR" commit -qm "test: add hermetic Tribunal fixtures"

fake_bin="$tmp_dir/bin"
fake_calls="$tmp_dir/judge-calls"
mkdir -p "$fake_bin" "$tmp_dir/home" "$tmp_dir/article-locks"
chmod 700 "$tmp_dir/article-locks"
: > "$fake_calls"

cat > "$fake_bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" != "exec" ]; then
  exit 1
fi

printf '%s\n' "${NR_JUDGE_MODE:?}" >> "${NR_JUDGE_CALLS:?}"
prompt="${!#}"
score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
[ -n "$score_path" ] || exit 72

case "$NR_JUDGE_MODE" in
  pass|stage-gap-pass)
    cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-pass",
  "dimensions": {
    "accuracy": 9, "fidelity": 9, "consistency": 9, "sourceBoundary": 9, "commentarySeparation": 9,
    "glossary": 9, "crossRef": 9, "sourceAlign": 9, "attribution": 9,
    "readability": 9, "firstImpression": 9, "payoffDensity": 9, "lengthFit": 9, "clarity": 9,
    "persona": 9, "moguNote": 9, "vibe": 9, "narrative": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {"fixture": "deterministic pass"}
}
JSON
    exit 0
    ;;
  malformed)
    printf '{not-json\n' > "$score_path"
    exit 0
    ;;
  quota)
    echo "quota exceeded; try again later" >&2
    exit 1
    ;;
  runner-error)
    echo "runner crashed" >&2
    exit 42
    ;;
  drift-fail)
    printf '\nReader-visible drift during judge execution.\n' >> "${NR_DRIFT_POST:?}"
    ;;
  sleep-fail)
    sleep 1
    ;;
  fail) ;;
  *) exit 73 ;;
esac

cat > "$score_path" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 2,
    "fidelity": 2,
    "consistency": 2,
    "sourceBoundary": 2,
    "commentarySeparation": 2
  },
  "score": 2,
  "verdict": "FAIL",
  "reasons": {"accuracy": "deterministic fixture failure"}
}
JSON
exit 0
FAKE_CODEX
chmod +x "$fake_bin/codex"

cat > "$fake_bin/pnpm" <<'FAKE_PNPM'
#!/usr/bin/env bash
if [ "${1:-}" = "run" ] && [ "${2:-}" = "build" ]; then
  if [ "${NR_FINAL_PASS_DRIFT:-0}" = "1" ]; then
    printf '\nReader-visible drift at final build boundary.\n' >> "${NR_DRIFT_POST:?}"
  fi
  exit 0
fi
exec /usr/bin/env pnpm "$@"
FAKE_PNPM
chmod +x "$fake_bin/pnpm"

current_version="$(node "$ROOT_DIR/scripts/tribunal-version.mjs" current)"
reader_helper="$ROOT_DIR/scripts/reader-revision-of-stdin.mjs"
progress_lock="$tmp_dir/progress.lock"
: > "$progress_lock"

RUN_RC=0
run_tribunal() {
  local progress="$1" mode="$2" output="$3"
  shift 3
  if PATH="$fake_bin:$PATH" \
    HOME="$tmp_dir/home" \
    PROGRESS_FILE="$progress" \
    TRIBUNAL_SCORE_ONLY_PROGRESS_FILE="$progress" \
    RC_PROGRESS_LOCK="$progress_lock" \
    TRIBUNAL_ARTICLE_LOCK_DIR="$tmp_dir/article-locks" \
    TRIBUNAL_FORCE_PROVIDER=codex \
    TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
    TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
    TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
    TRIBUNAL_READER_REVISION_HELPER="${READER_HELPER_OVERRIDE:-$reader_helper}" \
    NR_JUDGE_MODE="$mode" \
    NR_JUDGE_CALLS="$fake_calls" \
    NR_DRIFT_POST="${NR_DRIFT_POST_OVERRIDE:-$gp_path}" \
    GP_WRITER_MODE=none \
    bash "$TRIBUNAL" "$@" > "$output" 2>&1; then
    RUN_RC=0
  else
    RUN_RC=$?
  fi
}

call_count() {
  wc -l < "$fake_calls" | tr -d ' '
}

progress="$tmp_dir/progress.json"
printf '{}\n' > "$progress"
run_tribunal "$progress" fail "$tmp_dir/first.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "first authoritative GP FAIL should return rc=3, got $RUN_RC"
[ "$(call_count)" -eq 1 ] || fail "first GP FAIL should call exactly one judge"
jq -e --arg a "$gp_article" --argjson version "$current_version" '
  .[$a].status == "NEEDS_REVIEW"
  and .[$a].failedStage == "factChecker"
  and .[$a].terminalReason == "gp_source_preservation_no_rewrite"
  and .[$a].tribunalVersion == $version
  and .[$a].topLevelAttempts == 0
  and (.[$a].readerRevision | test("^[0-9a-f]{16}$"))
  and .[$a].stages.factChecker.status == "fail"
  and .[$a].stages.factChecker.score.dimensions.accuracy == 2
' "$progress" >/dev/null || fail "first GP FAIL did not persist authoritative evidence"
pass "valid GP source-preservation FAIL becomes NEEDS_REVIEW without consuming attempts"

ledger_before="$(sha256sum "$progress" | awk '{print $1}')"
run_tribunal "$progress" fail "$tmp_dir/same-revision.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "same-revision manual run should return rc=3"
[ "$(call_count)" -eq 1 ] || fail "same-revision manual run called the judge again"
[ "$(sha256sum "$progress" | awk '{print $1}')" = "$ledger_before" ] ||
  fail "same-revision skip mutated terminal evidence"
pass "same-version, same-revision manual run skips without ledger drift"

revision_before="$(node "$reader_helper" < "$gp_path")"
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const content = fs.readFileSync(path, "utf8");
  fs.writeFileSync(path, content.replace("tribunalVersion: 1", "tribunalVersion: 2"));
' "$gp_path"
revision_after="$(node "$reader_helper" < "$gp_path")"
[ "$revision_after" = "$revision_before" ] || fail "backend score metadata changed reader revision"
run_tribunal "$progress" fail "$tmp_dir/metadata-only.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "metadata-only change should remain rc=3"
[ "$(call_count)" -eq 1 ] || fail "metadata-only change reopened NEEDS_REVIEW"
pass "backend score metadata does not reopen NEEDS_REVIEW"

printf '\nA real reader-visible correction changes the canonical body.\n' >> "$gp_path"
run_tribunal "$progress" fail "$tmp_dir/reader-change.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "reader-visible correction should receive a new authoritative verdict"
[ "$(call_count)" -eq 2 ] || fail "reader-visible correction did not invoke exactly one new judge"
new_revision="$(node "$reader_helper" < "$gp_path")"
[ "$(jq -r --arg a "$gp_article" '.[$a].readerRevision' "$progress")" = "$new_revision" ] ||
  fail "new NEEDS_REVIEW terminal did not bind the corrected reader revision"
pass "reader-visible changes reopen evaluation and bind the new revision"

PROGRESS_FILE="$progress" RC_PROGRESS_LOCK="$progress_lock" \
  bash "$REQUEUE" "$gp_article" > "$tmp_dir/requeue.out" 2>&1 ||
  fail "explicit requeue command failed"
jq -e --arg a "$gp_article" '
  .[$a].status == "PENDING"
  and .[$a].failedStage == "pending"
  and .[$a].requeueCount == 1
  and .[$a].requeueReason == "operator_requeue"
  and .[$a].stages.factChecker.status == "fail"
' "$progress" >/dev/null || fail "requeue did not preserve evidence and audit fields"
run_tribunal "$progress" fail "$tmp_dir/requeued-run.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "requeued same revision should terminate as NEEDS_REVIEW again"
[ "$(call_count)" -eq 3 ] || fail "requeue did not grant exactly one new judge call"
pass "operator requeue preserves evidence and grants one same-revision judgment"

old_version=$((current_version - 1))
tmp_progress="$tmp_dir/version-reset.tmp"
jq --arg a "$gp_article" --argjson old "$old_version" '.[$a].tribunalVersion = $old' \
  "$progress" > "$tmp_progress"
mv "$tmp_progress" "$progress"
run_tribunal "$progress" fail "$tmp_dir/version-reset.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 3 ] || fail "old Tribunal version should be reevaluated"
[ "$(call_count)" -eq 4 ] || fail "Tribunal version reset did not invoke one new judge"
[ "$(jq -r --arg a "$gp_article" '.[$a].tribunalVersion' "$progress")" = "$current_version" ] ||
  fail "version reset did not persist the current Tribunal version"
pass "Tribunal contract version bump reopens NEEDS_REVIEW"

drift_progress="$tmp_dir/drift-progress.json"
printf '{}\n' > "$drift_progress"
NR_DRIFT_POST_OVERRIDE="$gp_path" run_tribunal \
  "$drift_progress" drift-fail "$tmp_dir/drift.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 70 ] || fail "in-flight reader drift should return rc=70, got $RUN_RC"
jq -e --arg a "$gp_article" '
  .[$a].status == "PENDING"
  and (.[$a].stages == {})
  and (.[$a].terminalReason // "") == ""
  and (.[$a].topLevelAttempts // 0) == 0
' "$drift_progress" >/dev/null || fail "in-flight drift did not atomically reset stale stage evidence"
pass "in-flight reader drift atomically resets stale stage evidence before terminal state"

hash_progress="$tmp_dir/hash-progress.json"
hash_revision="$(node "$reader_helper" < "$gp_path")"
jq -n --arg a "$gp_article" --arg r "$hash_revision" --argjson v "$current_version" '{
  ($a): {
    article: $a,
    status: "NEEDS_REVIEW",
    failedStage: "factChecker",
    terminalReason: "gp_source_preservation_no_rewrite",
    readerRevision: $r,
    tribunalVersion: $v,
    topLevelAttempts: 0,
    stages: {factChecker: {status: "fail", score: {score: 2}}}
  }
}' > "$hash_progress"
hash_before="$(sha256sum "$hash_progress" | awk '{print $1}')"
calls_before_hash="$(call_count)"
READER_HELPER_OVERRIDE="$tmp_dir/missing-reader-helper.mjs" run_tribunal \
  "$hash_progress" fail "$tmp_dir/hash-failure.out" \
  --only-stage factChecker --no-commit "$gp_article"
[ "$RUN_RC" -eq 70 ] || fail "reader hash failure should return rc=70"
[ "$(call_count)" = "$calls_before_hash" ] || fail "reader hash failure called a judge"
[ "$(sha256sum "$hash_progress" | awk '{print $1}')" = "$hash_before" ] ||
  fail "reader hash failure overwrote existing terminal evidence"
pass "reader hash failure is operational, judge-free, and evidence-preserving"

score_only_progress="$tmp_dir/score-only-progress.json"
printf '{}\n' > "$score_only_progress"
run_tribunal "$score_only_progress" fail "$tmp_dir/score-only.out" \
  --score-only --only-stage factChecker "$gp_article"
[ "$RUN_RC" -eq 1 ] || fail "score-only GP FAIL should remain rc=1, got $RUN_RC"
jq -e --arg a "$gp_article" '
  .[$a].status == "FAILED"
  and (.[$a].terminalReason // "") != "gp_source_preservation_no_rewrite"
' "$score_only_progress" >/dev/null || fail "score-only GP acquired authoritative terminal reason"
pass "score-only GP remains a non-authoritative rc=1 diagnostic"

for mode in malformed runner-error quota; do
  operational_progress="$tmp_dir/$mode-progress.json"
  printf '{}\n' > "$operational_progress"
  run_tribunal "$operational_progress" "$mode" "$tmp_dir/$mode.out" \
    --only-stage factChecker --no-commit "$gp_article"
  case "$mode:$RUN_RC" in
    malformed:70|runner-error:70|quota:75) ;;
    *) fail "$mode returned unexpected rc=$RUN_RC" ;;
  esac
  jq -e --arg a "$gp_article" '
    (.[$a].status // "") != "NEEDS_REVIEW"
    and (.[$a].terminalReason // "") != "gp_source_preservation_no_rewrite"
    and (.[$a].topLevelAttempts // 0) == 0
  ' "$operational_progress" >/dev/null || fail "$mode was misclassified as authoritative NEEDS_REVIEW"
done
pass "malformed output, runner error, and quota remain operational outcomes"

for invocation in judge-only bounded-rewrite; do
  non_gp_progress="$tmp_dir/non-gp-$invocation-progress.json"
  printf '{}\n' > "$non_gp_progress"
  if [ "$invocation" = "judge-only" ]; then
    run_tribunal "$non_gp_progress" fail "$tmp_dir/non-gp-$invocation.out" \
      --only-stage factChecker --no-commit "$non_gp_article"
  else
    run_tribunal "$non_gp_progress" fail "$tmp_dir/non-gp-$invocation.out" \
      --only-stage factChecker --allow-rewrite --no-commit "$non_gp_article"
  fi
  [ "$RUN_RC" -eq 1 ] || fail "non-GP $invocation should preserve rc=1, got $RUN_RC"
  jq -e --arg a "$non_gp_article" '
    .[$a].status == "FAILED"
    and (.[$a].terminalReason // "") != "gp_source_preservation_no_rewrite"
  ' "$non_gp_progress" >/dev/null || fail "non-GP $invocation acquired GP terminal reason"
done
pass "non-GP judge-only and bounded rewrite paths retain existing failure semantics"

race_progress="$tmp_dir/race-progress.json"
race_lock_dir="$tmp_dir/race-locks"
printf '{}\n' > "$race_progress"
mkdir -p "$race_lock_dir"
chmod 700 "$race_lock_dir"
calls_before_race="$(call_count)"
run_race_worker() {
  local output="$1" rc_file="$2"
  set +e
  PATH="$fake_bin:$PATH" \
  HOME="$tmp_dir/home" \
  PROGRESS_FILE="$race_progress" \
  RC_PROGRESS_LOCK="$progress_lock" \
  TRIBUNAL_ARTICLE_LOCK_DIR="$race_lock_dir" \
  TRIBUNAL_FORCE_PROVIDER=codex \
  TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
  TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
  NR_JUDGE_MODE=sleep-fail \
  NR_JUDGE_CALLS="$fake_calls" \
  NR_DRIFT_POST="$race_path" \
  GP_WRITER_MODE=none \
  bash "$TRIBUNAL" --only-stage factChecker --no-commit "$race_article" \
    > "$output" 2>&1
  printf '%s\n' "$?" > "$rc_file"
}
run_race_worker "$tmp_dir/race-1.out" "$tmp_dir/race-1.rc" &
race_pid_1=$!
sleep 0.2
run_race_worker "$tmp_dir/race-2.out" "$tmp_dir/race-2.rc" &
race_pid_2=$!
wait "$race_pid_1"
wait "$race_pid_2"
race_rcs="$(sort -n "$tmp_dir/race-1.rc" "$tmp_dir/race-2.rc" | tr '\n' ' ')"
[ "$race_rcs" = "3 75 " ] || fail "concurrent runners should return rc=3 and rc=75, got '$race_rcs'"
[ "$(( $(call_count) - calls_before_race ))" -eq 1 ] || fail "concurrent runners called more than one judge"
jq -e --arg a "$race_article" '.[$a].status == "NEEDS_REVIEW" and .[$a].topLevelAttempts == 0' \
  "$race_progress" >/dev/null || fail "concurrent runner terminal state is incomplete"
pass "article lock and progress CAS keep concurrent workers single-judge safe"

# Make a real reader-visible body mutation precisely at the next stage entry.
# The helper delegates normal hashing to the production helper so this verifies
# the runner's epoch boundary rather than a fake hash format.
stage_gap_article="gp-999995-stage-gap-$$.mdx"
stage_gap_path="$ROOT_DIR/src/content/posts/$stage_gap_article"
write_fixture "$stage_gap_path" "GP-999995"
stage_gap_reader="$tmp_dir/stage-gap-reader.mjs"
cat > "$stage_gap_reader" <<'NODE'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const counterPath = process.env.NR_REVISION_COUNTER;
const call = Number(readFileSync(counterPath, 'utf8') || '0') + 1;
writeFileSync(counterPath, `${call}\n`);
let input = readFileSync(0, 'utf8');
if (call === Number(process.env.NR_REVISION_MUTATE_ON_CALL)) {
  appendFileSync(process.env.NR_REVISION_MUTATE_PATH, '\nA deterministic stage-boundary reader edit.\n');
  input = readFileSync(process.env.NR_REVISION_MUTATE_PATH, 'utf8');
}
const { computeReaderRevisionFromContent } = await import(
  pathToFileURL(process.env.NR_READER_REVISION_IMPLEMENTATION).href,
);
process.stdout.write(computeReaderRevisionFromContent(input));
NODE
stage_gap_progress="$tmp_dir/stage-gap-progress.json"
stage_gap_counter="$tmp_dir/stage-gap-reader-count"
printf '{}\n' > "$stage_gap_progress"
printf '0\n' > "$stage_gap_counter"
export NR_REVISION_COUNTER="$stage_gap_counter"
export NR_REVISION_MUTATE_ON_CALL=5
export NR_REVISION_MUTATE_PATH="$stage_gap_path"
export NR_READER_REVISION_IMPLEMENTATION="$ROOT_DIR/scripts/build-reader-revision-manifest.mjs"
READER_HELPER_OVERRIDE="$stage_gap_reader" run_tribunal \
  "$stage_gap_progress" pass "$tmp_dir/stage-gap.out" \
  --no-commit "$stage_gap_article"
[ "$RUN_RC" -eq 70 ] || fail "stage-boundary drift should return rc=70, got $RUN_RC"
[ "$(call_count)" -ge 2 ] || fail "stage-boundary fixture did not execute the first judge"
jq -e --arg a "$stage_gap_article" '
  .[$a].status == "PENDING"
  and .[$a].stages == {}
  and (.[$a].topLevelAttempts // 0) == 0
' "$stage_gap_progress" >/dev/null || fail "stage-boundary drift retained a prior PASS stage"
pass "stage-boundary drift resets prior PASS evidence before the next judge"
unset NR_REVISION_COUNTER NR_REVISION_MUTATE_ON_CALL NR_REVISION_MUTATE_PATH NR_READER_REVISION_IMPLEMENTATION

# A revision can also change after all resumable stages are skipped but before
# the final build starts. That pre-gate drift must preserve the atomic PENDING
# reset rather than falling through to mark_article_failed(finalBuild).
pre_gate_drift_article="gp-999992-pre-gate-drift-$$.mdx"
pre_gate_drift_path="$ROOT_DIR/src/content/posts/$pre_gate_drift_article"
write_fixture "$pre_gate_drift_path" "GP-999992"
pre_gate_drift_progress="$tmp_dir/pre-gate-drift-progress.json"
pre_gate_drift_revision="$(node "$reader_helper" < "$pre_gate_drift_path")"
jq -n --arg a "$pre_gate_drift_article" --arg r "$pre_gate_drift_revision" --argjson v "$current_version" '{
  ($a): {
    article: $a, status: "PENDING", tribunalVersion: $v, topLevelAttempts: 0,
    stages: {
      factChecker: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      librarian: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      freshEyes: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      vibe: {status: "pass", readerRevision: $r, tribunalVersion: $v}
    }
  }
}' > "$pre_gate_drift_progress"
pre_gate_drift_counter="$tmp_dir/pre-gate-drift-reader-count"
printf '0\n' > "$pre_gate_drift_counter"
export NR_REVISION_COUNTER="$pre_gate_drift_counter"
# Score-only resume skips all four already-PASS stages without touching the
# reader helper; call 1 is runner snapshot and call 2 is final-gate entry.
export NR_REVISION_MUTATE_ON_CALL=2
export NR_REVISION_MUTATE_PATH="$pre_gate_drift_path"
export NR_READER_REVISION_IMPLEMENTATION="$ROOT_DIR/scripts/build-reader-revision-manifest.mjs"
NR_DRIFT_POST_OVERRIDE="$pre_gate_drift_path" READER_HELPER_OVERRIDE="$stage_gap_reader" run_tribunal \
  "$pre_gate_drift_progress" pass "$tmp_dir/pre-gate-drift.out" \
  --score-only "$pre_gate_drift_article"
[ "$RUN_RC" -eq 70 ] || fail "pre-final-build revision drift should return rc=70, got $RUN_RC"
jq -e --arg a "$pre_gate_drift_article" '
  .[$a].status == "PENDING"
  and .[$a].stages == {}
  and (.[$a].finishedAt // "") == ""
  and (.[$a].failedStage // "") == ""
  and (.[$a].topLevelAttempts // 0) == 0
' "$pre_gate_drift_progress" >/dev/null ||
  fail "pre-final-build drift was rewritten as FAILED or retained stale stages"
pass "pre-final-build revision drift remains a recoverable PENDING reset"
unset NR_REVISION_COUNTER NR_REVISION_MUTATE_ON_CALL NR_REVISION_MUTATE_PATH NR_READER_REVISION_IMPLEMENTATION

# All four judges may pass while a final build is running. A reader-visible
# edit there must still win over terminal PASS and force a complete retry.
pass_drift_article="gp-999994-pass-boundary-$$.mdx"
pass_drift_path="$ROOT_DIR/src/content/posts/$pass_drift_article"
write_fixture "$pass_drift_path" "GP-999994"
pass_drift_progress="$tmp_dir/pass-drift-progress.json"
pass_drift_revision="$(node "$reader_helper" < "$pass_drift_path")"
jq -n --arg a "$pass_drift_article" --arg r "$pass_drift_revision" --argjson v "$current_version" '{
  ($a): {
    article: $a, status: "PENDING", tribunalVersion: $v, topLevelAttempts: 0,
    stages: {
      factChecker: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      librarian: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      freshEyes: {status: "pass", readerRevision: $r, tribunalVersion: $v},
      vibe: {status: "pass", readerRevision: $r, tribunalVersion: $v}
    }
  }
}' > "$pass_drift_progress"
export NR_FINAL_PASS_DRIFT=1
NR_DRIFT_POST_OVERRIDE="$pass_drift_path" run_tribunal \
  "$pass_drift_progress" pass "$tmp_dir/pass-drift.out" \
  --score-only "$pass_drift_article"
unset NR_FINAL_PASS_DRIFT
[ "$RUN_RC" -eq 70 ] || fail "final PASS boundary drift should return rc=70, got $RUN_RC"
jq -e --arg a "$pass_drift_article" '
  .[$a].status == "PENDING"
  and .[$a].stages == {}
  and (.[$a].finishedAt // "") == ""
  and (.[$a].topLevelAttempts // 0) == 0
' "$pass_drift_progress" >/dev/null || fail "final PASS boundary drift left stale PASS evidence"
pass "final PASS revision compare resets all stale stages instead of publishing"

# Hold the progress lock before launching requeue, mutate the canonical body,
# then release it. Correct code reads the revision only after lock acquisition,
# rejects the stale requeue, and the next runner clears its old PASS evidence.
requeue_race_article="gp-999993-requeue-race-$$.mdx"
requeue_race_path="$ROOT_DIR/src/content/posts/$requeue_race_article"
write_fixture "$requeue_race_path" "GP-999993"
requeue_race_progress="$tmp_dir/requeue-race-progress.json"
requeue_race_revision="$(node "$reader_helper" < "$requeue_race_path")"
jq -n --arg a "$requeue_race_article" --arg r "$requeue_race_revision" --argjson v "$current_version" '{
  ($a): {
    article: $a, status: "NEEDS_REVIEW", failedStage: "factChecker",
    terminalReason: "gp_source_preservation_no_rewrite", readerRevision: $r,
    tribunalVersion: $v, topLevelAttempts: 0,
    stages: {
      factChecker: {status: "fail", readerRevision: $r, tribunalVersion: $v, score: {score: 2}},
      librarian: {status: "pass", readerRevision: $r, tribunalVersion: $v, score: {score: 9}}
    }
  }
}' > "$requeue_race_progress"
exec 197>>"$progress_lock"
flock -x 197
set +e
PROGRESS_FILE="$requeue_race_progress" RC_PROGRESS_LOCK="$progress_lock" \
  bash "$REQUEUE" "$requeue_race_article" > "$tmp_dir/requeue-race.out" 2>&1 &
requeue_race_pid=$!
sleep 0.2
printf '\nA deterministic hash-to-lock race edit.\n' >> "$requeue_race_path"
flock -u 197
wait "$requeue_race_pid"
requeue_race_rc=$?
set -e
[ "$requeue_race_rc" -eq 65 ] || fail "hash-to-lock requeue race should reject stale revision, got $requeue_race_rc"
jq -e --arg a "$requeue_race_article" '.[$a].status == "NEEDS_REVIEW" and .[$a].stages.librarian.status == "pass"' \
  "$requeue_race_progress" >/dev/null || fail "stale requeue changed ledger before rejecting its revision"
run_tribunal "$requeue_race_progress" fail "$tmp_dir/requeue-race-runner.out" \
  --only-stage factChecker --no-commit "$requeue_race_article"
[ "$RUN_RC" -eq 3 ] || fail "post-race normal dispatch should reevaluate with rc=3, got $RUN_RC"
jq -e --arg a "$requeue_race_article" '
  .[$a].status == "NEEDS_REVIEW"
  and (.[$a].stages.librarian // null) == null
  and .[$a].stages.factChecker.status == "fail"
' "$requeue_race_progress" >/dev/null || fail "post-race runner retained stale PASS stages"
pass "hash-to-lock requeue race cannot preserve stale PASS stages"

# A non-GP bounded writer rewrite at a later stage must invalidate earlier
# reader-visible PASS evidence. The deterministic writer changes the body only
# once, then the runner must rejudge FactChecker before it can finish the
# article; otherwise a mixed-revision PASS would be publishable.
rewrite_article="mp-999990-later-writer-$$.mdx"
rewrite_path="$ROOT_DIR/src/content/posts/$rewrite_article"
write_fixture "$rewrite_path" "MP-999990"
rewrite_bin="$tmp_dir/rewrite-bin"
rewrite_calls="$tmp_dir/rewrite-judge-calls"
rewrite_writer_calls="$tmp_dir/rewrite-writer-calls"
mkdir -p "$rewrite_bin"
: > "$rewrite_calls"
: > "$rewrite_writer_calls"
cat > "$rewrite_bin/codex" <<'FAKE_REWRITE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" != "exec" ]; then
  exit 1
fi

prompt="${!#}"
if printf '%s\n' "$prompt" | grep -Fq '## Writable zh-tw candidate'; then
  candidate_zh="$(printf '%s\n' "$prompt" | sed -n '/^## Writable zh-tw candidate$/{n;p;}' | tail -1)"
  [ -f "$candidate_zh" ] || exit 72
  count="$(wc -l < "${RW_WRITER_CALLS:?}" | tr -d ' ')"
  printf 'writer\n' >> "$RW_WRITER_CALLS"
  if [ "$count" -eq 0 ]; then
    printf '\nA deterministic authorized writer correction.\n' >> "$candidate_zh"
  fi
  mkdir -p "${RW_DEBUG_DIR:?}"
  cp "$candidate_zh" "$RW_DEBUG_DIR/$(basename "$candidate_zh")"
  exit 0
fi

score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
[ -n "$score_path" ] || exit 72
call="$(wc -l < "${RW_JUDGE_CALLS:?}" | tr -d ' ')"
call=$((call + 1))
printf '%s\n' "$call" >> "$RW_JUDGE_CALLS"
if [ "$call" -eq 2 ]; then
  cat > "$score_path" <<'JSON'
{
  "judge": "librarian",
  "dimensions": {
    "glossary": 2, "crossRef": 2, "sourceAlign": 2, "attribution": 2
  },
  "score": 2,
  "verdict": "FAIL",
  "reasons": {"fixture": "deterministic later-stage rewrite"}
}
JSON
else
  if printf '%s\n' "$prompt" | grep -Fq '### 晶晶體 checker'; then
    cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-vibe-pass",
  "dimensions": {
    "persona": 9, "moguNote": 9, "vibe": 9, "narrative": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
  elif printf '%s\n' "$prompt" | grep -Fq '## Deterministic evidence packet'; then
    cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-librarian-pass",
  "dimensions": {
    "glossary": 9, "crossRef": 9, "sourceAlign": 9, "attribution": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
  elif [ "$call" -eq 1 ] || [ "$call" -eq 4 ]; then
      cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-fact-checker-pass",
  "dimensions": {
    "accuracy": 9, "fidelity": 9, "consistency": 9, "sourceBoundary": 9,
    "commentarySeparation": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
  else
      cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-fresh-eyes-pass",
  "dimensions": {
    "readability": 9, "firstImpression": 9, "payoffDensity": 9,
    "lengthFit": 9, "clarity": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
  fi
fi
exit 0
FAKE_REWRITE_CODEX
cat > "$rewrite_bin/pnpm" <<'FAKE_REWRITE_PNPM'
#!/usr/bin/env bash
if [ "${1:-}" = "run" ] && [ "${2:-}" = "build" ]; then
  exit 0
fi
exec /usr/bin/env pnpm "$@"
FAKE_REWRITE_PNPM
chmod +x "$rewrite_bin/codex" "$rewrite_bin/pnpm"

rewrite_progress="$tmp_dir/rewrite-progress.json"
rewrite_candidate_debug="$tmp_dir/rewrite-candidate-debug"
printf '{}\n' > "$rewrite_progress"
rewrite_run_rc=0
PATH="$rewrite_bin:$PATH" \
HOME="$tmp_dir/home" \
PROGRESS_FILE="$rewrite_progress" \
RC_PROGRESS_LOCK="$progress_lock" \
TRIBUNAL_ARTICLE_LOCK_DIR="$tmp_dir/article-locks" \
TRIBUNAL_FORCE_PROVIDER=codex \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
GP_WRITER_MODE=codex \
GP_CODEX_MODEL=gpt-test \
RW_JUDGE_CALLS="$rewrite_calls" \
RW_WRITER_CALLS="$rewrite_writer_calls" \
RW_DEBUG_DIR="$rewrite_candidate_debug" \
bash "$TRIBUNAL" --allow-rewrite --no-commit "$rewrite_article" \
  > "$tmp_dir/later-writer.out" 2>&1 || rewrite_run_rc=$?
[ "$rewrite_run_rc" -eq 0 ] || {
  sed -n '1,220p' "$tmp_dir/later-writer.out" >&2 || true
  fail "later-stage writer regression should finish with rc=0, got $rewrite_run_rc"
}
[ "$(wc -l < "$rewrite_writer_calls" | tr -d ' ')" -eq 1 ] ||
  fail "later-stage fixture should invoke exactly one bounded writer"
[ "$(wc -l < "$rewrite_calls" | tr -d ' ')" -eq 6 ] ||
  fail "later-stage rewrite should run six judges including a restarted FactChecker (got $(wc -l < "$rewrite_calls" | tr -d ' ')); output: $(tail -80 "$tmp_dir/later-writer.out" | tr '\n' ' '); candidate: $(node "$SOURCE_ROOT/scripts/validate-posts.mjs" "$rewrite_candidate_debug"/*.mdx 2>&1 | tr '\n' ' '); runtime-log: $(for f in "$runtime_root"/.score-loop/logs/*; do [ -f "$f" ] || continue; tail -40 "$f"; done 2>/dev/null | tr '\n' ' ')"
new_rewrite_revision="$(node "$reader_helper" < "$rewrite_path")"
jq -e --arg a "$rewrite_article" --arg r "$new_rewrite_revision" --argjson v "$current_version" '
  .[$a].status == "PASS"
  and .[$a].tribunalVersion == $v
  and ([.[$a].stages[] | .status] | all(. == "pass"))
  and ([.[$a].stages[] | .readerRevision] | all(. == $r))
' "$rewrite_progress" >/dev/null ||
  fail "later-stage rewrite left mixed-revision PASS evidence"
pass "authorized later-stage writer rewrite rejudges earlier stages on the new reader epoch"

# A writer transaction may also be a validated no-op. It must not fabricate a
# reader epoch and trigger a second full Tribunal wave after the current stage
# eventually passes.
noop_article="mp-999988-noop-writer-$$.mdx"
noop_path="$ROOT_DIR/src/content/posts/$noop_article"
write_fixture "$noop_path" "MP-999988"
noop_bin="$tmp_dir/noop-bin"
noop_calls="$tmp_dir/noop-judge-calls"
noop_writer_calls="$tmp_dir/noop-writer-calls"
mkdir -p "$noop_bin"
: > "$noop_calls"
: > "$noop_writer_calls"
cat > "$noop_bin/codex" <<'FAKE_NOOP_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  echo "fake codex exec help"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.128.0"
  exit 0
fi
if [ "${1:-}" != "exec" ]; then
  exit 1
fi

prompt="${!#}"
if printf '%s\n' "$prompt" | grep -Fq '## Writable zh-tw candidate'; then
  printf 'writer\n' >> "${NOOP_WRITER_CALLS:?}"
  # Deliberately leave the candidate byte-for-byte unchanged.
  exit 0
fi

score_path="$(printf '%s\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
[ -n "$score_path" ] || exit 72
call="$(wc -l < "${NOOP_JUDGE_CALLS:?}" | tr -d ' ')"
call=$((call + 1))
printf '%s\n' "$call" >> "$NOOP_JUDGE_CALLS"
if [ "$call" -eq 2 ]; then
  cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-librarian-noop-fail",
  "dimensions": {
    "glossary": 2, "crossRef": 2, "sourceAlign": 2, "attribution": 2
  },
  "score": 2,
  "verdict": "FAIL",
  "reasons": {"fixture": "deterministic no-op writer"}
}
JSON
else
  cat > "$score_path" <<'JSON'
{
  "judge": "deterministic-noop-pass",
  "dimensions": {
    "accuracy": 9, "fidelity": 9, "consistency": 9, "sourceBoundary": 9,
    "commentarySeparation": 9, "glossary": 9, "crossRef": 9,
    "sourceAlign": 9, "attribution": 9, "readability": 9,
    "firstImpression": 9, "payoffDensity": 9, "lengthFit": 9,
    "clarity": 9, "persona": 9, "moguNote": 9, "vibe": 9,
    "narrative": 9
  },
  "score": 9,
  "verdict": "PASS",
  "reasons": {}
}
JSON
fi
exit 0
FAKE_NOOP_CODEX
chmod +x "$noop_bin/codex"
cp "$rewrite_bin/pnpm" "$noop_bin/pnpm"
chmod +x "$noop_bin/pnpm"
noop_progress="$tmp_dir/noop-progress.json"
printf '{}\n' > "$noop_progress"
noop_run_rc=0
PATH="$noop_bin:$PATH" \
HOME="$tmp_dir/home" \
PROGRESS_FILE="$noop_progress" \
RC_PROGRESS_LOCK="$progress_lock" \
TRIBUNAL_ARTICLE_LOCK_DIR="$tmp_dir/article-locks" \
TRIBUNAL_FORCE_PROVIDER=codex \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_IDLE_POLL_SEC=1 \
GP_WRITER_MODE=codex \
GP_CODEX_MODEL=gpt-test \
NOOP_JUDGE_CALLS="$noop_calls" \
NOOP_WRITER_CALLS="$noop_writer_calls" \
bash "$TRIBUNAL" --allow-rewrite --no-commit "$noop_article" \
  > "$tmp_dir/noop-writer.out" 2>&1 || noop_run_rc=$?
[ "$noop_run_rc" -eq 0 ] || {
  sed -n '1,220p' "$tmp_dir/noop-writer.out" >&2 || true
  fail "no-op writer regression should finish with rc=0, got $noop_run_rc"
}
[ "$(wc -l < "$noop_writer_calls" | tr -d ' ')" -eq 1 ] ||
  fail "no-op writer fixture should invoke exactly one bounded writer"
[ "$(wc -l < "$noop_calls" | tr -d ' ')" -eq 5 ] ||
  fail "no-op writer should not trigger a second Tribunal wave (got $(wc -l < "$noop_calls" | tr -d ' '))"
noop_revision="$(node "$reader_helper" < "$noop_path")"
jq -e --arg a "$noop_article" --arg r "$noop_revision" --argjson v "$current_version" '
  .[$a].status == "PASS"
  and .[$a].tribunalVersion == $v
  and ([.[$a].stages[] | .status] | all(. == "pass"))
  and ([.[$a].stages[] | .readerRevision] | all(. == $r))
' "$noop_progress" >/dev/null ||
  fail "no-op writer changed epoch or left an incomplete terminal PASS"
pass "validated no-op writer does not manufacture a reader epoch or restart the Tribunal"

# Operational stage checkpoints are resumable evidence too. A quota/error
# interruption for a later stage must not look like a revision drift merely
# because its checkpoint has no score; the prior FactChecker PASS should be
# reused on the same article bytes.
operational_article="gp-999989-operational-resume-$$.mdx"
operational_path="$ROOT_DIR/src/content/posts/$operational_article"
write_fixture "$operational_path" "GP-999989"
operational_progress="$tmp_dir/operational-resume-progress.json"
operational_revision="$(node "$reader_helper" < "$operational_path")"
jq -n \
  --arg a "$operational_article" \
  --arg r "$operational_revision" \
  --argjson v "$current_version" \
  '{
    ($a): {
      article: $a,
      status: "RUNNER_ERROR",
      failedStage: "freshEyes",
      tribunalVersion: $v,
      topLevelAttempts: 0,
      stages: {
        factChecker: {
          status: "pass",
          readerRevision: $r,
          tribunalVersion: $v,
          score: {
            score: 9,
            dimensions: {
              accuracy: 9,
              fidelity: 9,
              consistency: 9,
              sourceBoundary: 9,
              commentarySeparation: 9
            }
          }
        },
        librarian: {
          status: "quota_suspended",
          readerRevision: $r,
          tribunalVersion: $v,
          score: null
        },
        freshEyes: {
          status: "runner_error",
          readerRevision: $r,
          tribunalVersion: $v,
          score: null
        },
        vibe: {
          status: "runner_error",
          readerRevision: $r,
          tribunalVersion: $v,
          score: null
        }
      }
    }
  }' > "$operational_progress"
operational_calls_before="$(call_count)"
run_tribunal "$operational_progress" pass "$tmp_dir/operational-resume.out" \
  --no-commit "$operational_article"
[ "$RUN_RC" -eq 0 ] || fail "same-input quota/error resume should finish with rc=0, got $RUN_RC"
[ "$(( $(call_count) - operational_calls_before ))" -eq 3 ] ||
  fail "same-input quota/error resume should reuse FactChecker PASS and call only later stages"
jq -e --arg a "$operational_article" --arg r "$operational_revision" --argjson v "$current_version" '
  .[$a].status == "PASS"
  and .[$a].topLevelAttempts == 0
  and .[$a].tribunalVersion == $v
  and .[$a].stages.factChecker.status == "pass"
  and .[$a].stages.factChecker.readerRevision == $r
  and ([.[$a].stages[] | .readerRevision] | all(. == $r))
' "$operational_progress" >/dev/null ||
  fail "same-input quota/error resume discarded prior FactChecker PASS evidence"
pass "quota/error stage checkpoints preserve same-input PASS evidence on resume"
