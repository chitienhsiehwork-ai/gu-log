#!/usr/bin/env bash
# validate-judge-output.sh — Validate tribunal judge score JSON against uniform schema
# Usage: ./validate-judge-output.sh <judge> <json-file>
# Judges: librarian | factCheck | freshEyes | vibe
# Exit 0 = valid, Exit 1 = invalid (prints error to stdout)
set -euo pipefail

JUDGE="${1:-}"
JSON_FILE="${2:-}"

if [ -z "$JUDGE" ] || [ -z "$JSON_FILE" ]; then
  echo "Usage: validate-judge-output.sh <librarian|factCheck|freshEyes|vibe> <json-file>"
  exit 1
fi

if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: File not found: $JSON_FILE"
  exit 1
fi

if [ ! -s "$JSON_FILE" ]; then
  echo "ERROR: Not valid JSON. File is empty."
  exit 1
fi

if ! jq empty "$JSON_FILE" 2>/dev/null; then
  echo "ERROR: Not valid JSON. File contents:"
  head -20 "$JSON_FILE"
  exit 1
fi

# Uniform fields: judge, dimensions (object), score (0-10), verdict (PASS/FAIL), reasons (object)
score="$(jq -r '.score // empty' "$JSON_FILE")"
verdict="$(jq -r '.verdict // empty' "$JSON_FILE")"

if [ -z "$score" ]; then
  echo "ERROR: Missing 'score' field. Got: $(jq -c '.' "$JSON_FILE")"
  exit 1
fi

if ! [[ "$score" =~ ^[0-9]+$ ]]; then
  echo "ERROR: 'score' must be integer 0-10, got: $score"
  exit 1
fi

if [ "$score" -lt 0 ] || [ "$score" -gt 10 ]; then
  echo "ERROR: 'score' must be 0-10, got: $score"
  exit 1
fi

if [ -z "$verdict" ]; then
  echo "ERROR: Missing 'verdict' field (expected PASS or FAIL)."
  exit 1
fi

# Helper: validate a single dimension in .dimensions object
validate_dim() {
  local field="$1"
  local val
  val="$(jq -r ".dimensions.${field} // empty" "$JSON_FILE")"
  if [ -z "$val" ]; then
    echo "ERROR: Missing dimensions.${field}"
    exit 1
  fi
  if ! [[ "$val" =~ ^[0-9]+$ ]] || [ "$val" -lt 0 ] || [ "$val" -gt 10 ]; then
    echo "ERROR: dimensions.${field} must be integer 0-10, got: $val"
    exit 1
  fi
}

# Judge-specific dimension validation
case "$JUDGE" in
  librarian)
    validate_dim glossary
    validate_dim crossRef
    validate_dim sourceAlign
    validate_dim attribution
    ;;
  factCheck|fact-checker)
    validate_dim accuracy
    validate_dim fidelity
    validate_dim consistency
    ;;
  freshEyes|fresh-eyes)
    validate_dim readability
    validate_dim firstImpression
    ;;
  vibe|vibe-opus-scorer)
    validate_dim persona
    validate_dim clawdNote
    validate_dim vibe
    validate_dim clarity
    validate_dim narrative
    ;;
  *)
    echo "ERROR: Unknown judge '$JUDGE'. Expected: librarian, factCheck, freshEyes, vibe"
    exit 1
    ;;
esac

echo "OK"
exit 0
