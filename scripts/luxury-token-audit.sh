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

EXCLUDES="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.astro"

# Strict pattern: only match inline comments (//|#|<!--) to avoid counting
# mentions in markdown docs or specs (see tests/tribunal-v2/_decisions.md)
PATTERN='(//|#|<!--)\s*LUXURY_TOKEN:'

# Total count
TOTAL=$(grep -rEn "$PATTERN" . $EXCLUDES 2>/dev/null | wc -l | tr -d ' ')
echo "Total LUXURY_TOKEN markers: $TOTAL"
echo ""

# Group by file (hotspots)
echo "=== By file (hotspots) ==="
grep -rEn "$PATTERN" . $EXCLUDES 2>/dev/null | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn
echo ""

# Show all with context
echo "=== All markers with context ==="
grep -rEn "$PATTERN" . $EXCLUDES 2>/dev/null
