#!/usr/bin/env bash
# Multi-Model Scorer — Three judges, each with a different specialty
#   Claude  → Vibe (persona / clawdNote / vibe)
#   Codex   → Fact Check (data accuracy / attribution / logic)
#   Gemini  → Cross-Ref (source fidelity / internal refs / coverage)
#
# Usage: ./multi-scorer.sh <post-filename> [output-dir]
# Prompts: scripts/prompts/{vibe-scorer,fact-checker,crossref-verifier}.md
# Exit: 0 = all pass, 1 = any failure/disagreement

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/ralph-helpers.sh

POST_FILE="$1"
POST_PATH="src/content/posts/$POST_FILE"

if [ ! -f "$POST_PATH" ]; then
  echo "ERROR: Post file not found: $POST_PATH" >&2
  exit 1
fi

TICKET_ID=$(get_ticket_id "$POST_PATH")
[ -z "$TICKET_ID" ] && TICKET_ID="unknown"

OUT_DIR="${2:-/tmp/multi-score}"
mkdir -p "$OUT_DIR"

CLAUDE_OUT="$OUT_DIR/claude-${TICKET_ID}.json"
CODEX_OUT="$OUT_DIR/codex-${TICKET_ID}.json"
GEMINI_OUT="$OUT_DIR/gemini-${TICKET_ID}.json"
FINAL_OUT="$OUT_DIR/multi-score-${TICKET_ID}.json"

echo "═══ Multi-Model Scoring: $TICKET_ID ($POST_FILE) ═══"
echo "  🔵 Claude  → Vibe (persona/clawdNote/vibe)"
echo "  🟢 Codex   → Fact Check (data/attribution/logic)"
echo "  🔴 Gemini  → Cross-Ref (sources/internal-links/coverage)"
echo ""

# Run all three in parallel
echo "⏳ Launching all scorers in parallel..."
bash scripts/ralph-scorer.sh "$POST_FILE" "$CLAUDE_OUT" &
PID_CLAUDE=$!
bash scripts/codex-scorer.sh "$POST_FILE" "$CODEX_OUT" &
PID_CODEX=$!
bash scripts/gemini-scorer.sh "$POST_FILE" "$GEMINI_OUT" &
PID_GEMINI=$!

# Wait and collect
CLAUDE_OK=0; CODEX_OK=0; GEMINI_OK=0
wait $PID_CLAUDE 2>/dev/null && CLAUDE_OK=1 || true
wait $PID_CODEX 2>/dev/null && CODEX_OK=1 || true
wait $PID_GEMINI 2>/dev/null && GEMINI_OK=1 || true

echo ""
echo "═══ Results ═══"

# Print individual results
if [ "$CLAUDE_OK" = "1" ] && [ -f "$CLAUDE_OUT" ]; then
  P=$(jq -r '.scores.persona.score // "?"' "$CLAUDE_OUT")
  C=$(jq -r '.scores.clawdNote.score // "?"' "$CLAUDE_OUT")
  V=$(jq -r '.scores.vibe.score // "?"' "$CLAUDE_OUT")
  echo "  🔵 Claude Vibe:      ${P}/${C}/${V} (persona/clawdNote/vibe)"
else
  echo "  🔵 Claude Vibe:      ❌ FAILED"
fi

if [ "$CODEX_OK" = "1" ] && [ -f "$CODEX_OUT" ]; then
  D=$(jq -r '.scores.dataAccuracy.score // "?"' "$CODEX_OUT")
  A=$(jq -r '.scores.attributionAccuracy.score // "?"' "$CODEX_OUT")
  L=$(jq -r '.scores.logicalCoherence.score // "?"' "$CODEX_OUT")
  echo "  🟢 Codex Fact-Check:  ${D}/${A}/${L} (data/attribution/logic)"
else
  echo "  🟢 Codex Fact-Check:  ❌ FAILED"
fi

if [ "$GEMINI_OK" = "1" ] && [ -f "$GEMINI_OUT" ]; then
  SF=$(jq -r '.scores.sourceFidelity.score // "?"' "$GEMINI_OUT")
  IR=$(jq -r '.scores.internalCrossRefs.score // "?"' "$GEMINI_OUT")
  SC=$(jq -r '.scores.sourceCoverage.score // "?"' "$GEMINI_OUT")
  echo "  🔴 Gemini Cross-Ref:  ${SF}/${IR}/${SC} (sources/internal-refs/coverage)"
else
  echo "  🔴 Gemini Cross-Ref:  ❌ FAILED"
fi

echo ""

# Build consensus JSON
node -e "
const fs = require('fs');
const [claudeF, codexF, geminiF, outF, ticketId, postFile] = process.argv.slice(1);

const load = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const claude = load(claudeF);
const codex = load(codexF);
const gemini = load(geminiF);

const result = {
  ticketId,
  file: postFile,
  timestamp: new Date().toISOString(),
  judges: {
    vibe: claude ? {
      scorer: 'claude',
      prompt: 'scripts/prompts/vibe-scorer.md',
      scores: claude.scores,
      composite: claude.composite || Math.floor(
        ((claude.scores?.persona?.score||0) + (claude.scores?.clawdNote?.score||0) + (claude.scores?.vibe?.score||0)) / 3
      ),
      verdict: claude.verdict || claude.meetBar ? 'PASS' : 'FAIL',
    } : { scorer: 'claude', error: 'scorer failed' },

    factCheck: codex ? {
      scorer: 'codex',
      prompt: 'scripts/prompts/fact-checker.md',
      scores: codex.scores,
      composite: codex.composite || Math.floor(
        ((codex.scores?.dataAccuracy?.score||0) + (codex.scores?.attributionAccuracy?.score||0) + (codex.scores?.logicalCoherence?.score||0)) / 3
      ),
      verdict: codex.verdict || 'unknown',
      flaggedClaims: [
        ...(codex.scores?.dataAccuracy?.flaggedClaims || []),
        ...(codex.scores?.attributionAccuracy?.flaggedClaims || []),
      ],
    } : { scorer: 'codex', error: 'scorer failed' },

    crossRef: gemini ? {
      scorer: 'gemini',
      prompt: 'scripts/prompts/crossref-verifier.md',
      scores: gemini.scores,
      composite: gemini.composite || Math.floor(
        ((gemini.scores?.sourceFidelity?.score||0) + (gemini.scores?.internalCrossRefs?.score||0) + (gemini.scores?.sourceCoverage?.score||0)) / 3
      ),
      verdict: gemini.verdict || 'unknown',
    } : { scorer: 'gemini', error: 'scorer failed' },
  },
  overall: null,
  flags: [],
};

// Overall verdict
const verdicts = [
  result.judges.vibe.verdict,
  result.judges.factCheck.verdict,
  result.judges.crossRef.verdict,
];
const anyFailed = verdicts.some(v => v === 'FAIL');
const anyError = verdicts.some(v => !v || v === 'unknown');
const allPassed = verdicts.every(v => v === 'PASS');

if (anyFailed) result.overall = 'FAIL';
else if (anyError) result.overall = 'PARTIAL';
else if (allPassed) result.overall = 'PASS';
else result.overall = 'REVIEW';

// Flagged claims from fact-checker
if (result.judges.factCheck.flaggedClaims?.length > 0) {
  result.flags.push('Fact-checker flagged ' + result.judges.factCheck.flaggedClaims.length + ' claims');
}

// Low scores
['vibe', 'factCheck', 'crossRef'].forEach(j => {
  const comp = result.judges[j]?.composite;
  if (typeof comp === 'number' && comp < 8) {
    result.flags.push(j + ' composite score ' + comp + '/10 — below threshold');
  }
});

fs.writeFileSync(outF, JSON.stringify(result, null, 2));

// Print summary
console.log('Overall: ' + result.overall);
console.log('Composites: Vibe=' + (result.judges.vibe.composite ?? '?') +
  ' FactCheck=' + (result.judges.factCheck.composite ?? '?') +
  ' CrossRef=' + (result.judges.crossRef.composite ?? '?'));
if (result.flags.length) {
  console.log('Flags:');
  result.flags.forEach(f => console.log('  ⚠️  ' + f));
}
" "$CLAUDE_OUT" "$CODEX_OUT" "$GEMINI_OUT" "$FINAL_OUT" "$TICKET_ID" "$POST_FILE"

echo ""
echo "Output: $FINAL_OUT"
echo "Prompts: scripts/prompts/{vibe-scorer,fact-checker,crossref-verifier}.md"
