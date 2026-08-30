## Why

`tribunal-quota-controller` 的穩定版規格仍規定 2026-05-12 前的逐篇／執行中工作額度閘門，但正式環境程式、整合測試與操作手冊已明確改採「依視窗經過時間計算允許消耗線」的節奏控制。這份規範偏移會讓後續 agent 依過時 SHALL 恢復一套既可能重複扣量、又無法保證額度保留底線的機制，因此現在要用修正 change 收斂合約。

## What Changes

- 把短週期與每週視窗的規範節奏改成「實際用量對已經過時間允許消耗線」，並定義欠額等待、約束視窗與硬保留底線行為。
- 明訂執行中工作數與 `ARTICLE_COST_PCT` 不參與派送閘門；單篇成本的指數移動平均只保留為遙測。
- 依正式環境行為校正無效額度資料、正式來源優先序、額外用量安全閥與可觀測性；不再把只讀歷史來源的 `--legacy-quota` 宣稱成可用的正式 rollback。
- 讓額度控制器的阻擋型迴歸測試直接執行正式控制器，移除只在測試中重演舊公式的假覆蓋。
- 同步操作手冊中仍暗示預扣閘門的除錯殘影；不操作或重啟遠端 Tribunal 執行環境。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `tribunal-quota-controller`：用現行消耗線節奏、僅供遙測的單篇成本與正式環境錨定情境，取代過時的逐篇／執行中工作預扣合約。

## Impact

- 規範差異：`openspec/specs/tribunal-quota-controller/spec.md`。
- Apply 階段預計影響 `scripts/tribunal-quota-loop.sh` 的邊界錯誤、額度控制器迴歸測試，以及 `docs/tribunal-runbook.md` 的衍生除錯說明。
- 不新增 dependency、不變更網站執行環境或新增額度來源；正式來源無效時改為優先安全降級，不得落到歷史相容來源。
- 本 change 必須停在人類提案檢查點；只有人類核准「以現行消耗線政策作為正式風險合約」後才能 apply。
