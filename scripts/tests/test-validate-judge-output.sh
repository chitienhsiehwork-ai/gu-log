#!/usr/bin/env bash
# Unit tests for validate-judge-output.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$SCRIPT_DIR/../validate-judge-output.sh"

PASS=0
FAIL=0
TMPFILE="$(mktemp)"

cleanup() { rm -f "$TMPFILE"; }
trap cleanup EXIT

assert_ok() {
  local desc="$1" judge="$2" json="$3"
  echo "$json" > "$TMPFILE"
  result="$(bash "$VALIDATOR" "$judge" "$TMPFILE" 2>&1)"
  if [ "$result" = "OK" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc — expected OK, got: $result"
  fi
}

assert_error() {
  local desc="$1" judge="$2" json="$3" expected_substr="${4:-ERROR}"
  echo "$json" > "$TMPFILE"
  result="$(bash "$VALIDATOR" "$judge" "$TMPFILE" 2>&1 || true)"
  if [[ "$result" == *"$expected_substr"* ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc — expected '$expected_substr' in output, got: $result"
  fi
}

# ─── Gemini: valid cases ───
assert_ok "gemini: perfect score" gemini \
  '{"score": 7, "reasoning": "Good post", "unlinked_terms": ["Agent", "MCP"]}'

assert_ok "gemini: score 0" gemini \
  '{"score": 0, "reasoning": "Terrible", "unlinked_terms": []}'

assert_ok "gemini: score 10" gemini \
  '{"score": 10, "reasoning": "Perfect", "unlinked_terms": []}'

assert_ok "gemini: no unlinked_terms (null)" gemini \
  '{"score": 5, "reasoning": "Okay"}'

# ─── Gemini: invalid cases ───
assert_error "gemini: missing score" gemini \
  '{"reasoning": "No score field"}' "Missing 'score'"

assert_error "gemini: score out of range (11)" gemini \
  '{"score": 11, "reasoning": "Too high"}' "must be 0-10"

assert_error "gemini: score out of range (-1)" gemini \
  '{"score": -1, "reasoning": "Negative"}' "must be integer 0-10"

assert_error "gemini: score is string" gemini \
  '{"score": "seven", "reasoning": "String score"}' "must be integer"

assert_error "gemini: missing reasoning" gemini \
  '{"score": 5}' "Missing 'reasoning'"

assert_error "gemini: not json at all" gemini \
  'this is just text' "Not valid JSON"

assert_error "gemini: unlinked_terms is string" gemini \
  '{"score": 5, "reasoning": "ok", "unlinked_terms": "Agent"}' "must be array"

# ─── Codex: valid ───
assert_ok "codex: basic valid" codex \
  '{"score": 8, "reasoning": "Mostly accurate"}'

assert_ok "codex: with optional flaggedClaims" codex \
  '{"score": 3, "reasoning": "Bad", "flaggedClaims": ["claim1"]}'

# ─── Codex: invalid ───
assert_error "codex: score 15" codex \
  '{"score": 15, "reasoning": "Way too high"}' "must be 0-10"

# ─── Opus: valid ───
assert_ok "opus: all sub-scores present" opus \
  '{"score": 9, "reasoning": "Great vibe", "details": {"persona": 9, "clawdNote": 9, "vibe": 9}}'

# ─── Opus: invalid ───
assert_error "opus: missing persona" opus \
  '{"score": 7, "reasoning": "ok", "details": {"clawdNote": 8, "vibe": 7}}' "Missing 'details.persona'"

assert_error "opus: missing clawdNote" opus \
  '{"score": 7, "reasoning": "ok", "details": {"persona": 8, "vibe": 7}}' "Missing 'details.clawdNote'"

assert_error "opus: missing vibe" opus \
  '{"score": 7, "reasoning": "ok", "details": {"persona": 8, "clawdNote": 7}}' "Missing 'details.vibe'"

assert_error "opus: sub-score out of range" opus \
  '{"score": 7, "reasoning": "ok", "details": {"persona": 11, "clawdNote": 8, "vibe": 7}}' "must be integer 0-10"

# ─── Edge cases ───
# Empty file test (write zero bytes)
: > "$TMPFILE"
result="$(bash "$VALIDATOR" gemini "$TMPFILE" 2>&1 || true)"
if [[ "$result" == *"Not valid JSON"* ]] || [[ "$result" == *"empty"* ]]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  echo "FAIL: empty file — expected error about empty/invalid, got: $result"
fi

# Missing file test
result="$(bash "$VALIDATOR" gemini "/tmp/nonexistent-$$.json" 2>&1 || true)"
if [[ "$result" == *"ERROR"* ]]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  echo "FAIL: missing file — expected ERROR, got: $result"
fi

# ─── Results ───
echo ""
echo "═══════════════════════════════"
echo "  PASS: $PASS  |  FAIL: $FAIL"
echo "═══════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
