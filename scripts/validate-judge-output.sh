#!/usr/bin/env bash
# validate-judge-output.sh — Validate judge score JSON against schema
# Usage: ./validate-judge-output.sh <judge> <json-file>
# Exit 0 = valid, Exit 1 = invalid (prints error to stdout)
set -euo pipefail

JUDGE="${1:-}"
JSON_FILE="${2:-}"

if [ -z "$JUDGE" ] || [ -z "$JSON_FILE" ]; then
  echo "Usage: validate-judge-output.sh <gemini|codex|opus> <json-file>"
  exit 1
fi

if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: File not found: $JSON_FILE"
  exit 1
fi

# Must be valid JSON
if ! jq empty "$JSON_FILE" 2>/dev/null; then
  echo "ERROR: Not valid JSON. File contents:"
  head -20 "$JSON_FILE"
  exit 1
fi

# Common fields
score="$(jq -r '.score // empty' "$JSON_FILE")"
reasoning="$(jq -r '.reasoning // empty' "$JSON_FILE")"

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

if [ -z "$reasoning" ]; then
  echo "ERROR: Missing 'reasoning' field."
  exit 1
fi

# Judge-specific validation
case "$JUDGE" in
  gemini)
    # unlinked_terms should be array (can be empty)
    ut_type="$(jq -r '.unlinked_terms | type' "$JSON_FILE" 2>/dev/null)"
    if [ "$ut_type" != "array" ] && [ "$ut_type" != "null" ]; then
      echo "ERROR: 'unlinked_terms' must be array, got: $ut_type"
      exit 1
    fi
    ;;
  codex)
    # flaggedClaims is optional but nice-to-have
    ;;
  opus)
    # Opus needs details sub-scores
    for field in persona clawdNote vibe; do
      val="$(jq -r ".details.${field} // empty" "$JSON_FILE")"
      if [ -z "$val" ]; then
        echo "ERROR: Missing 'details.${field}' for opus judge"
        exit 1
      fi
      if ! [[ "$val" =~ ^[0-9]+$ ]] || [ "$val" -lt 0 ] || [ "$val" -gt 10 ]; then
        echo "ERROR: 'details.${field}' must be integer 0-10, got: $val"
        exit 1
      fi
    done
    ;;
esac

echo "OK"
exit 0
