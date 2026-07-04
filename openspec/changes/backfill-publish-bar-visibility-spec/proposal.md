# Proposal: backfill-publish-bar-visibility-spec

## Why

「兩層品質門檻」的**消費端**規則（sub-8 文章照常發佈但不上首頁、掛「精修中」badge、未評分舊文 grandfathered 留在首頁）目前只活在 `CONTRIBUTING.md` 散文，openspec 沒有 formal spec。生產端（pass bar 計算、floor commit gate）已有 `tribunal-scoring-dimensions` spec 覆蓋，但消費端的 `getIndexPosts()` / `isBelowPublishBar()` / `Sub8RefiningBanner` 三個實作一旦被改壞，沒有任何 spec scenario 會抓到。2026-07-04 實際發生過 agent 誤讀這條規則（把 tribunal FAIL 當成「擋發佈」），證明散文 SSOT 對這種行為契約不夠力。

## What Changes

- 新增 capability spec `publish-bar-visibility`，把既有行為升格為 formal requirements：
  - sub-8（有真分數但未達 PASS bar）的文章照常 build、有自己的 URL，**不**被擋下
  - sub-8 文章被排除在首頁 / featured 列表之外（`getIndexPosts()`）
  - sub-8 文章頁面渲染「精修中」banner（`Sub8RefiningBanner`，雙語）
  - 未評分（grandfathered）舊文不算 below bar，留在首頁、不掛 banner
  - tribunal FAIL 對 pipeline 是 advisory：不得因分數未達 PASS bar 而阻擋 deploy
- `CONTRIBUTING.md`〈🎯 兩層品質門檻〉改為 derived view，指回 spec（散文保留人話解釋，事實以 spec 為準）
- **純 backfill**：不改任何 runtime 行為，程式碼已全部符合

## Capabilities

### New Capabilities
- `publish-bar-visibility`: 兩層品質門檻的消費端行為——sub-8 文章的可見性（首頁排除、精修中 banner、grandfather 例外、deploy 不受阻）

### Modified Capabilities

（無——`tribunal-scoring-dimensions` 管 pass bar 怎麼算，本 change 不動它；本 change 管「算出來之後怎麼用」）

## Impact

- `openspec/specs/publish-bar-visibility/spec.md`（新增，archive 時 sync）
- `CONTRIBUTING.md`〈🎯 兩層品質門檻〉補一行指回 spec
- 實作面零改動：`src/utils/post-status.ts`、`src/utils/tribunal-scores.ts`、`src/components/Sub8RefiningBanner.astro`、`tools/sp-pipeline/internal/pipeline/ralph.go` 全部維持現狀
- 可能新增 unit tests 把 scenario 綁成 Tier-1（apply 階段由 builder 評估：`getIndexPosts` / `isBelowPublishBar` 若已有測試則補齊缺口即可）
