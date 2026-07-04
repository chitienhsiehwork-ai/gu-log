# Design: backfill-publish-bar-visibility-spec

## Context

這是 **backfill 既有行為**的 change：runtime 行為零改動，目的是把已實作、已上線的消費端規則升格成 formal spec，讓未來的修改有 scenario 可對帳。2026-07-04 的 SP-251 實跑驗證過整條路徑（sub-8 發佈 → 精修中 banner → 不上首頁）。

## Goals / Non-Goals

**Goals**
- `publish-bar-visibility` spec 忠實描述現況（不是理想化重設計）
- scenario 盡可能可測（Tier-1）：`getIndexPosts` / `isBelowPublishBar` / grandfather 語意都是純函式，可直接 unit test
- `CONTRIBUTING.md` 散文降級為 derived view，指回 spec

**Non-Goals**
- 不改 PASS bar 計算（`tribunal-scoring-dimensions` 的地盤）
- 不改 floor commit gate
- 不鎖 banner 文案與樣式——banner 的**有無**與 **composite 分數顯示**屬行為、由 spec 鎖定；措辭與視覺是 UI 自由度
- **不把 below-bar 解釋成 globally hidden**：RSS / search / tag / 導覽照常包含 below-bar 文章（`getPublishedPosts()` 不排除），本 capability 只管首頁 / featured 列表與文章頁 banner

## Decisions

### D1: 新 capability，不塞進 tribunal-scoring-dimensions

`tribunal-scoring-dimensions` 管「分數怎麼算、bar 怎麼判」（生產端）；本 capability 管「判完之後前端與 pipeline 怎麼反應」（消費端）。兩者變更頻率與 owner 不同（一個跟著 rubric 版本走、一個跟著 UI/UX 走），分開才不會每次改 banner 行為都得動 scoring spec。

### D2: spec 引用函式名但不鎖實作位置

Requirement 文字引用 `isBelowPublishBar()` / `getIndexPosts()` / `meetsPublishBar()` 作為語意錨點（這些是 code SSOT 的名字），但不規定它們住在哪個檔案——搬檔重構不算 spec 變更。

### D3: Tier 分類——全部 Tier-1（round 2 修訂）

原本把 banner 渲染與 pipeline advisory 歸 Tier-2，階段 6 正確性 reviewer 打回（可測即須測）：

- 純函式層（`vitest`）：首頁排除、passing 上首頁、grandfather / partial-scores 語意
- 頁面層（playwright + dev server）：below-bar 文章頁 200 + banner 存在含分數、passing / grandfathered 頁無 banner
- pipeline 層（Go unit test + stub script）：tribunal exit 1 → `passed=false, err=nil`（advisory 契約）

## Risks / Trade-offs

- **風險：spec 與散文重複造成新的 drift 面** → 緩解：CONTRIBUTING.md 段落改為指回 spec 的一句話 + 人話摘要，數字與判定語意以 spec 為準
- **風險：backfill spec 寫成理想而非現況** → 緩解：每條 requirement 都對照現有實作逐一驗證（proposal 附檔案:行號），reviewer 錨定 code ground truth
