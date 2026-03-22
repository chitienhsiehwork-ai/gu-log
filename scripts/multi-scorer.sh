#!/usr/bin/env bash
# Multi-Model Scorer — Runs Claude + Codex + Gemini scorers in parallel
# Usage: ./multi-scorer.sh <post-filename> [output-dir]
# Exit: 0 = all agree, 1 = disagreement or error
#
# Output: <output-dir>/multi-score-<ticketId>.json with all three scores + consensus

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
echo ""

# Run all three in parallel
echo "🔵 Launching Claude scorer..."
bash scripts/ralph-scorer.sh "$POST_FILE" "$CLAUDE_OUT" &
PID_CLAUDE=$!

echo "🟢 Launching Codex scorer..."
bash scripts/codex-scorer.sh "$POST_FILE" "$CODEX_OUT" &
PID_CODEX=$!

echo "🔴 Launching Gemini scorer..."
bash scripts/gemini-scorer.sh "$POST_FILE" "$GEMINI_OUT" &
PID_GEMINI=$!

echo ""
echo "⏳ Waiting for all scorers..."

# Wait and collect results
CLAUDE_OK=0; CODEX_OK=0; GEMINI_OK=0
wait $PID_CLAUDE 2>/dev/null && CLAUDE_OK=1 || true
wait $PID_CODEX 2>/dev/null && CODEX_OK=1 || true
wait $PID_GEMINI 2>/dev/null && GEMINI_OK=1 || true

echo ""
echo "═══ Results ═══"

# Collect scores
get_score() {
  local file="$1" dim="$2"
  jq -r ".scores.${dim}.score // -1" "$file" 2>/dev/null || echo "-1"
}

# Print individual results
SCORERS=0
for label_file in "Claude:$CLAUDE_OUT:$CLAUDE_OK" "Codex:$CODEX_OUT:$CODEX_OK" "Gemini:$GEMINI_OUT:$GEMINI_OK"; do
  IFS=: read -r label file ok <<< "$label_file"
  if [ "$ok" = "1" ] && [ -f "$file" ]; then
    p=$(get_score "$file" "persona")
    c=$(get_score "$file" "clawdNote")
    v=$(get_score "$file" "vibe")
    echo "  $label: ${p}/${c}/${v}"
    SCORERS=$((SCORERS + 1))
  else
    echo "  $label: ❌ FAILED"
  fi
done

echo ""

# Build consensus JSON
node -e "
const fs = require('fs');
const args = process.argv.slice(1);
const [claudeF, codexF, geminiF, outF, ticketId, postFile] = args;

const load = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
};

const claude = load(claudeF);
const codex = load(codexF);
const gemini = load(geminiF);

const scorers = [
  claude && { name: 'claude', ...claude.scores },
  codex && { name: 'codex', ...codex.scores },
  gemini && { name: 'gemini', ...gemini.scores },
].filter(Boolean);

// Calculate averages
const avg = (dim) => {
  const vals = scorers.map(s => s[dim]?.score).filter(v => typeof v === 'number' && v >= 0);
  return vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length * 10) / 10 : null;
};

// Calculate max spread (disagreement)
const spread = (dim) => {
  const vals = scorers.map(s => s[dim]?.score).filter(v => typeof v === 'number' && v >= 0);
  return vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0;
};

const consensus = {
  ticketId,
  file: postFile,
  timestamp: new Date().toISOString(),
  scorerCount: scorers.length,
  individual: {
    claude: claude?.scores || null,
    codex: codex?.scores || null,
    gemini: gemini?.scores || null,
  },
  consensus: {
    persona: { avg: avg('persona'), spread: spread('persona') },
    clawdNote: { avg: avg('clawdNote'), spread: spread('clawdNote') },
    vibe: { avg: avg('vibe'), spread: spread('vibe') },
  },
  verdict: null,
  flags: [],
};

// Verdict logic
const dims = ['persona', 'clawdNote', 'vibe'];
const allAvgAbove9 = dims.every(d => consensus.consensus[d].avg >= 9);
const anyHighSpread = dims.some(d => consensus.consensus[d].spread >= 3);

if (anyHighSpread) {
  consensus.verdict = 'REVIEW';
  consensus.flags.push('High disagreement (spread >= 3) — needs human review');
} else if (allAvgAbove9) {
  consensus.verdict = 'PASS';
} else {
  consensus.verdict = 'FAIL';
}

// Flag specific disagreements
dims.forEach(d => {
  if (consensus.consensus[d].spread >= 2) {
    consensus.flags.push(d + ' spread=' + consensus.consensus[d].spread + ' — scorers disagree');
  }
});

fs.writeFileSync(outF, JSON.stringify(consensus, null, 2));
console.log('Consensus: ' + consensus.verdict);
console.log('Averages: ' + dims.map(d => consensus.consensus[d].avg).join('/'));
if (consensus.flags.length) {
  console.log('Flags:');
  consensus.flags.forEach(f => console.log('  ⚠️  ' + f));
}
" "$CLAUDE_OUT" "$CODEX_OUT" "$GEMINI_OUT" "$FINAL_OUT" "$TICKET_ID" "$POST_FILE"

echo ""
echo "Output: $FINAL_OUT"
