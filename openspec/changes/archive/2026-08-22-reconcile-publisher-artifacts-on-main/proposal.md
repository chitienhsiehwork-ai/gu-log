## Why

Tribunal publisher 目前會把內容已經與最新 `origin/main` 完全相同的 PASS artifact 一再視為 `ready_for_batch`。這些 no-diff 候選會永久占滿批次前段、觸發 `head`／`pipefail` 的 Broken pipe 噪音，並餓死後方真正需要發布的 artifact。

## What Changes

- 在既有驗證與 fresh `origin/main` materialization 後，將 no-diff 候選一次、原子地收斂為 `published`。
- 以 `publicationMethod: "already_on_main"` 與精確 `mainCommit` 留下誠實 provenance；不虛構 batch、branch、PR 或 merge metadata。
- 讓候選收集器自行在 `MAX_BATCH` 停止，不再以 `head` 截斷 producer。
- 增加回歸測試，證明 no-diff 候選只處理一次、後續批次不再被占用，且 ledger 更新具一致性。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `tribunal-publisher-autopilot`: publisher SHALL 將已在 fresh `origin/main` 的有效 PASS artifact 終結為可稽核的 published 狀態，且不得讓它們持續占用後續批次。

## Impact

- `scripts/tribunal-publisher.sh`：候選收集上限與 no-diff reconciliation。
- `scripts/tests/test-tribunal-publisher.sh`：publisher ledger、no-diff 與 starvation 回歸測試。
- ignored runtime ledger `tribunal-publisher.json`：既有 entry 增加 `publicationMethod`、`mainCommit` 與 `updatedAt` provenance；不新增 publish state。
