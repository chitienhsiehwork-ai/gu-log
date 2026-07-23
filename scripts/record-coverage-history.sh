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
  HISTORY_STATE=$(jq -cer --arg date "$ENTRY_DATE" '
    if type != "array" then
      error("coverage history must be an array")
    elif all(.[]; type == "object" and (.date | type == "string" and length > 0)) then
      {
        targetCount: ([.[] | select(.date == $date)] | length),
        hasDuplicates: (group_by(.date) | any(length > 1))
      }
    else
      error("coverage history entries must have dates")
    end
  ' "$HISTORY_FILE")
  TARGET_COUNT=$(jq -r '.targetCount' <<< "$HISTORY_STATE")
  HAS_DUPLICATES=$(jq -r '.hasDuplicates' <<< "$HISTORY_STATE")

  if [ "$TARGET_COUNT" -gt 0 ] && [ "$HAS_DUPLICATES" = "false" ]; then
    echo "📝 Coverage history already has the $ENTRY_DATE daily snapshot; preserving the first measurement."
    exit 0
  fi

  jq --argjson entry "$HISTORY_ENTRY" '
    reduce .[] as $item (
      {seen: {}, history: []};
      if .seen[$item.date] // false then
        .
      else
        .seen[$item.date] = true
        | .history += [$item]
      end
    )
    | if .seen[$entry.date] // false then .history else .history + [$entry] end
  ' "$HISTORY_FILE" > "$TEMPORARY_FILE"
else
  jq -n --argjson entry "$HISTORY_ENTRY" '[$entry]' > "$TEMPORARY_FILE"
fi

mv "$TEMPORARY_FILE" "$HISTORY_FILE"
trap - EXIT
echo "📝 Recorded the $ENTRY_DATE daily coverage snapshot."
