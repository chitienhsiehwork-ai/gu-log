#!/usr/bin/env bash
# test-frontmatter-scores-v8.sh — regression tests for Tribunal v8
# dimensions and frontmatter versioning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "✓ $*"; }

post="$TMP/sp-999-test.mdx"
cat > "$post" <<'POST'
---
ticketId: SP-999
title: Test
lang: zh-tw
translatedDate: 2026-05-17
---

Body.
POST

score_json='{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 9,
    "consistency": 8,
    "sourceBoundary": 8,
    "commentarySeparation": 9
  },
  "score": 8,
  "verdict": "PASS",
  "model": "gpt-5.5"
}'

node "$ROOT_DIR/scripts/frontmatter-scores.mjs" write "$post" factCheck "$score_json"

grep -q 'tribunalVersion: 8' "$post" || fail "frontmatter write did not set tribunalVersion: 8"
grep -q 'sourceBoundary: 8' "$post" || fail "sourceBoundary was not written"
grep -q 'commentarySeparation: 9' "$post" || fail "commentarySeparation was not written"

roundtrip="$(node "$ROOT_DIR/scripts/frontmatter-scores.mjs" get "$post" factCheck)"
node -e '
const data = JSON.parse(process.argv[1]);
if (data.dimensions.sourceBoundary !== 8) process.exit(1);
if (data.dimensions.commentarySeparation !== 9) process.exit(2);
if (data.score !== 8) process.exit(3);
' "$roundtrip" || fail "frontmatter get did not roundtrip v8 factCheck dimensions"
pass "frontmatter-scores writes and reads Tribunal v8 factCheck dimensions"

score_file="$TMP/fact-score.json"
printf '%s\n' "$score_json" > "$score_file"
source "$ROOT_DIR/scripts/score-helpers.sh"
validate_judge_score_json fact-checker "$score_file" || fail "v8 factCheck score JSON did not validate"
pass "score helper validates Tribunal v8 factCheck JSON"

missing_file="$TMP/fact-score-missing.json"
cat > "$missing_file" <<'JSON'
{
  "judge": "factCheck",
  "dimensions": {
    "accuracy": 8,
    "fidelity": 9,
    "consistency": 8
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
if validate_judge_score_json fact-checker "$missing_file"; then
  fail "v8 factCheck validation accepted JSON without boundary dimensions"
fi
pass "score helper rejects pre-v8 factCheck JSON"


fresh_score_file="$TMP/fresh-score.json"
cat > "$fresh_score_file" <<'JSON'
{
  "judge": "freshEyes",
  "dimensions": {
    "readability": 8,
    "firstImpression": 9,
    "payoffDensity": 8,
    "lengthFit": 8
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
validate_judge_score_json fresh-eyes "$fresh_score_file" || fail "v8 FreshEyes score JSON did not validate"
pass "score helper validates Tribunal v8 FreshEyes length-fit JSON"

fresh_missing_file="$TMP/fresh-score-missing.json"
cat > "$fresh_missing_file" <<'JSON'
{
  "judge": "freshEyes",
  "dimensions": {
    "readability": 8,
    "firstImpression": 9
  },
  "score": 8,
  "verdict": "PASS"
}
JSON
if validate_judge_score_json fresh-eyes "$fresh_missing_file"; then
  fail "v8 FreshEyes validation accepted JSON without length-fit dimensions"
fi
pass "score helper rejects pre-v8 FreshEyes JSON"
