# Tasks: backfill-publish-bar-visibility-spec

## 1. Spec 對帳（backfill 正確性）

- [x] 1.1 逐條核對 spec delta 的 requirement 與現有實作行為一致：`src/utils/tribunal-scores.ts`（`isBelowPublishBar` / `meetsPublishBar` / `hasTribunalScore` / `computeOverallComposite`）、`src/utils/post-status.ts`（`getIndexPosts`）、`src/components/Sub8RefiningBanner.astro` 與兩個 `[...slug].astro` 的條件渲染、`tools/sp-pipeline/internal/pipeline/ralph.go` 的 advisory 行為
- [x] 1.2 發現 spec 與現況不符 → 停手回報 controller（backfill 不准「順便修行為」）

## 2. Tier-1 測試

- [x] 2.1 盤點既有測試：`rg -l "isBelowPublishBar|getIndexPosts" tests/ src/` 找出已覆蓋的 scenario
- [x] 2.2 為未覆蓋的 Tier-1 scenario 補 unit tests（首頁排除 / passing 上首頁 / grandfather 語意），跟隨 repo 既有測試框架與檔案位置慣例
- [x] 2.3 交 scenario→tier 對照清單（Tier-1 附測試路徑，Tier-2 附現有證據：SP-251 prod 實跑、Astro 條件渲染位置）

## 3. 散文收斂

- [x] 3.1 `CONTRIBUTING.md`〈🎯 兩層品質門檻〉補 derived-view 宣告 + 指回 `openspec/specs/publish-bar-visibility/spec.md`（archive 後生效的路徑）；人話摘要與表格保留（判定語意以 spec 為權威，未刪散文細節）
- [x] 3.2 檢查其他散文（playbooks、docs/）有沒有複述這條規則需要一併指回 spec：`rg -n "不上首頁|精修中|publish bar|PUBLISH_BAR" --glob '*.md'`

## 4. 驗證

- [x] 4.1 測試綠：跑 repo 既有 unit test 指令確認新增測試通過
- [x] 4.2 `bunx @fission-ai/openspec@latest validate --change backfill-publish-bar-visibility-spec`（若 CLI 提供 validate）確認 delta 格式合法

## 5. Round 2 — 正確性 review 打回的 Tier-1 缺口

- [ ] 5.1 playwright 頁面層測試（動態挑文章，不寫死 slug）：below-bar 文章頁 200 + 精修中 banner 含 composite 分數、passing 文章頁無 banner、grandfathered 文章頁無 banner
- [ ] 5.2 ralph advisory Go unit test（stub script）：exit 1 → `passed=false, err=nil`；exit 0 → `passed=true`
