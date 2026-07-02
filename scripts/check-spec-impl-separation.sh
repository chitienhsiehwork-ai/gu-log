#!/usr/bin/env bash
# check-spec-impl-separation.sh — openspec-sdlc 階段 6「唯讀牆」的近似 CI 強制。
#
# 規則（見 .agents/openspec-sdlc.md〈階段 6：收斂與 escalation〉）：
#   openspec change 的 spec delta = 合約，builder 在 apply 時對它唯讀。要改 scenario
#   走 escalation（升 coach → controller 改 delta），不准 builder 在實作 commit 裡偷改。
#
# CI 無法歸因「這個 commit 是不是 builder 做的」（PR 內同一 git identity），所以用
# 「動作形狀」近似「誰做的」：**單一 commit 同時動 change delta spec + 實作檔** =
# builder 把改合約夾帶進實作的形狀 = 違規。
#
# 刻意不誤殺的合法情況：
#   - propose commit：只動 openspec/（spec/proposal/tasks/design），不碰實作 → 放行
#   - archive commit：動 openspec/specs/（main specs）+ openspec/changes/ → 都在 openspec/，非「實作檔」→ 放行
#   - doc sync：動 .agents/、docs/ → 非「實作檔」→ 放行
#
# 現為 warn-only（ci.yml 不 fail）——證明不誤殺一段時間後再升 blocking（改最後 exit）。
set -euo pipefail

BASE="${1:-origin/main}"
range="${BASE}...HEAD"

# 實作檔 = 真 code 的根目錄；openspec/ .agents/ docs/ .claude/ .github/ 都不算合約下的「實作」
IMPL_RE='^(src|scripts|tools)/'
# change delta spec（合約本體），排除已 archive 的
DELTA_RE='^openspec/changes/[^/]+/specs/.*\.md$'
ARCHIVE_RE='^openspec/changes/archive/'

violations=0
for sha in $(git rev-list "$range" 2>/dev/null); do
  files="$(git show --name-only --format= "$sha" | sed '/^$/d')"
  delta="$(printf '%s\n' "$files" | grep -E "$DELTA_RE" | grep -Ev "$ARCHIVE_RE" || true)"
  impl="$(printf '%s\n' "$files" | grep -E "$IMPL_RE" || true)"
  if [[ -n "$delta" && -n "$impl" ]]; then
    echo "⚠️  commit ${sha:0:8} 同時動 spec delta（合約）+ 實作檔："
    printf '%s\n' "$delta" | sed 's/^/     spec: /'
    printf '%s\n' "$impl"  | sed 's/^/     impl: /'
    violations=$((violations + 1))
  fi
done

if [[ "$violations" -gt 0 ]]; then
  echo ""
  echo "⚠️  近似唯讀牆：發現 $violations 個 commit 把「改合約」夾帶進實作。"
  echo "   spec scenario = 合約，apply 時對 builder 唯讀。要改 scenario 走 escalation"
  echo "   （升 coach → controller 改 delta），見 .agents/openspec-sdlc.md。"
  echo "   若這是 controller 的正當 sync/archive，把 spec 改跟實作拆成不同 commit 即可。"
else
  echo "✓ 近似唯讀牆：無 commit 混動 spec delta + 實作檔"
fi

# warn-only：一律 exit 0。升 blocking 時把上面 violations>0 的分支改 exit 1。
exit 0
