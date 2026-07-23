#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: record-coverage-history.sh <history-file> <entry-json>" >&2
  exit 1
fi

HISTORY_FILE="$1"
HISTORY_ENTRY="$2"
ENTRY_DATE=$(jq -er \
  'if type == "object" and (.date | type == "string" and length > 0) then .date else error("entry must have a date") end' \
  <<< "$HISTORY_ENTRY")
TEMPORARY_FILE="${HISTORY_FILE}.tmp"

trap 'rm -f "$TEMPORARY_FILE"' EXIT

if [ -f "$HISTORY_FILE" ]; then
  jq --argjson entry "$HISTORY_ENTRY" \
    'if type == "array" then map(select(.date != $entry.date)) + [$entry] else error("coverage history must be an array") end' \
    "$HISTORY_FILE" > "$TEMPORARY_FILE"
else
  jq -n --argjson entry "$HISTORY_ENTRY" '[$entry]' > "$TEMPORARY_FILE"
fi

mv "$TEMPORARY_FILE" "$HISTORY_FILE"
trap - EXIT
echo "📝 Recorded the $ENTRY_DATE coverage history entry."
