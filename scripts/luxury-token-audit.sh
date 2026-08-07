#!/usr/bin/env bash
# scripts/luxury-token-audit.sh
#
# 撞到 quota 牆時用這個 audit 所有 LUXURY_TOKEN 標記，
# 找出可以降級的地方。
#
# Usage: bash scripts/luxury-token-audit.sh
# Save: bash scripts/luxury-token-audit.sh > luxury-audit-$(date +%Y%m%d).txt

set -e

echo "=== LUXURY_TOKEN Audit Report ==="
echo "Generated: $(date)"
echo ""

EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.astro)

# Strict pattern: only match inline comments (//|#|<!--) to avoid counting
# mentions in markdown docs or specs (see tests/tribunal-v2/_decisions.md)
PATTERN='(//|#|<!--)\s*LUXURY_TOKEN:'

# Scan once so every report section is derived from the same evidence, and
# distinguish grep's healthy "no matches" status from operational failures.
MATCHES=""
if MATCHES="$(grep -rEn "$PATTERN" "${EXCLUDES[@]}" . 2>/dev/null)"; then
  :
else
  grep_rc=$?
  if [ "$grep_rc" -ne 1 ]; then
    exit "$grep_rc"
  fi
fi

if [ -n "$MATCHES" ]; then
  TOTAL=$(printf '%s\n' "$MATCHES" | wc -l | tr -d ' ')
else
  TOTAL=0
fi
echo "Total LUXURY_TOKEN markers: $TOTAL"
echo ""

# Group by file (hotspots)
echo "=== By file (hotspots) ==="
if [ -n "$MATCHES" ]; then
  printf '%s\n' "$MATCHES" | awk -F: '{print $1}' | sort | uniq -c | sort -rn
fi
echo ""

# Show all with context
echo "=== All markers with context ==="
if [ -n "$MATCHES" ]; then
  printf '%s\n' "$MATCHES"
fi
