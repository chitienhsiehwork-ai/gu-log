#!/bin/bash
# Renumber CP ticketIds sequentially by filename pairing
# zh file is source of truth for ordering, en file gets same ID

set -eo pipefail
cd "$(dirname "$0")/.."

echo "=== CP Renumber Script (v2 — filename-pair based) ==="

# Step 1: Get all zh CP files sorted by their current ticketId number
ZH_FILES=()
while IFS= read -r line; do
  ZH_FILES+=("$line")
done < <(
  for f in src/content/posts/clawd-picks-*.mdx; do
    [[ "$f" == *en-* ]] && continue
    tid=$(grep "^ticketId:" "$f" | sed "s/ticketId: *[\"']//;s/[\"']//")
    [[ "$tid" == CP-* ]] || continue
    num=$(echo "$tid" | sed 's/CP-//')
    echo "$num $f"
  done | sort -n | awk '{print $2}'
)

TOTAL=${#ZH_FILES[@]}
echo "Total zh CP files: $TOTAL"
echo ""

# Step 2: Assign new sequential IDs
echo "=== Assignments ==="
NEW=1
for f in "${ZH_FILES[@]}"; do
  base=$(basename "$f")
  en_file="src/content/posts/en-$base"
  
  old_zh=$(grep "^ticketId:" "$f" | sed "s/ticketId: *[\"']//;s/[\"']//")
  new_id="CP-$NEW"
  
  if [ "$old_zh" != "$new_id" ]; then
    echo "  $old_zh → $new_id ($base)"
    
    # Update zh file
    sed -i "s/^ticketId: *\"$old_zh\"/ticketId: \"$new_id\"/; s/^ticketId: *'$old_zh'/ticketId: '$new_id'/" "$f"
  fi
  
  # Always sync en file to match zh (regardless of what it had before)
  if [ -f "$en_file" ]; then
    old_en=$(grep "^ticketId:" "$en_file" | sed "s/ticketId: *[\"']//;s/[\"']//")
    if [ "$old_en" != "$new_id" ]; then
      sed -i "s/^ticketId: *\"$old_en\"/ticketId: \"$new_id\"/; s/^ticketId: *'$old_en'/ticketId: '$new_id'/" "$en_file"
    fi
  fi
  
  NEW=$((NEW + 1))
done

# Step 3: Update counter
echo ""
echo "Updating CP counter to next=$((TOTAL + 1))..."
python3 -c "
import json
with open('scripts/article-counter.json') as f:
    data = json.load(f)
data['CP']['next'] = $((TOTAL + 1))
with open('scripts/article-counter.json', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

# Step 4: Verify — zero gaps in zh
echo ""
echo "=== Verification ==="
GAPS=0
for i in $(seq 1 $TOTAL); do
  if ! grep -q "^ticketId: *\"CP-$i\"" src/content/posts/clawd-picks-*.mdx 2>/dev/null && \
     ! grep -q "^ticketId: *'CP-$i'" src/content/posts/clawd-picks-*.mdx 2>/dev/null; then
    echo "  ❌ CP-$i: MISSING in zh"
    GAPS=$((GAPS + 1))
  fi
done
[ $GAPS -eq 0 ] && echo "  ✅ zh: CP-1 through CP-$TOTAL, zero gaps!"

# Verify — zh/en pairs match
MISMATCHES=0
for f in src/content/posts/clawd-picks-*.mdx; do
  [[ "$f" == *en-* ]] && continue
  base=$(basename "$f")
  en="src/content/posts/en-$base"
  [ ! -f "$en" ] && continue
  zh_id=$(grep "^ticketId:" "$f" | sed "s/ticketId: *[\"']//;s/[\"']//")
  en_id=$(grep "^ticketId:" "$en" | sed "s/ticketId: *[\"']//;s/[\"']//")
  if [ "$zh_id" != "$en_id" ]; then
    echo "  ❌ PAIR MISMATCH: $base zh=$zh_id en=$en_id"
    MISMATCHES=$((MISMATCHES + 1))
  fi
done
[ $MISMATCHES -eq 0 ] && echo "  ✅ en: All pairs match zh!"

if [ $GAPS -gt 0 ] || [ $MISMATCHES -gt 0 ]; then
  exit 1
fi

echo ""
echo "Done! Run 'pnpm run build' then commit."
