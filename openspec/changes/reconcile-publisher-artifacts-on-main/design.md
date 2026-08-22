## Context

Tribunal runtime ledger 可能包含大量歷史 PASS artifact。Publisher 依檔名排序取前 `MAX_BATCH` 筆，將 runtime 內容複製到 fresh `origin/main` worktree，再跑 validation、stage、build 與 PR 流程。若所選內容早已存在於 main，staged diff 會是空的；現行流程只刪除暫存 worktree／branch，沒有推進 ledger，下一輪仍選到同一批。候選再經 `head` 截斷時，長 queue 也會讓 producer 遇到 SIGPIPE，在正常 no-diff 情境留下 Broken pipe。

## Goals / Non-Goals

**Goals:**

- 讓整批已在 fresh `origin/main` 的有效 PASS artifact 收斂成既有 terminal `published` 狀態。
- 留下足以稽核「不是經 PR merge，而是原本就在 main」的精確 provenance。
- 對多 entry 以單次原子 ledger 寫入維持一致性。
- 讓候選列舉在 producer 內部遵守 `MAX_BATCH`，不以提前關閉 pipe 截斷。

**Non-Goals:**

- 不新增 publish state、synthetic batch 或 synthetic PR／merge metadata。
- 不改 validation、GitHub conflict scan、build、push、PR recovery 或 merge guard。
- 不回填所有歷史 entry；正常下一輪會按批次漸進 reconciliation。
- 不變更正在執行的 Tribunal service checkout 或 service lifecycle。

## Decisions

1. **沿用 `published`，另記 publication method。** No-diff 候選已滿足「artifact 位於 main」的 terminal 語意，因此寫入 `publishState: "published"`、`publicationMethod: "already_on_main"`、fresh `origin/main` 的精確 `mainCommit` 與 `updatedAt`。相較新增 `already_on_main` state，這能讓既有 selector 與 status consumer 不必擴充 state machine。

2. **只在既有 validation 後、整個 staged batch 為空時 reconciliation。** 這保留「invalid 但碰巧相同」仍進 `validation_blocked` 的現行安全邊界；zh-tw 或 en 任一 sidecar 有差異時，仍走正常 batch／PR lifecycle。

3. **不建立 synthetic batch。** No-diff 路徑清除 entry 可能殘留的 `batchId`、PR 與 merge metadata，不在 `.batches` 新增紀錄。`publicationMethod` 與 `mainCommit` 已能誠實說明結果，虛構 PR lifecycle 反而會污染 audit trail。

4. **一次 `jq reduce` 加 temp-file／`mv` 更新整批 entry。** 相較逐 entry 反覆讀寫，單次 transaction 不會留下半批 published、半批 ready 的中間狀態，也維持既有 runtime ledger 的原子寫檔模式。

5. **collector 接收 limit 並自行停止。** Producer 每 emit 一筆就計數，到 `MAX_BATCH` 後正常 `break`；caller 不再接 `head`。這保留排序與 batch size，並避免 `pipefail` 下的 SIGPIPE 噪音，不需要收集完整 queue 到記憶體。

## Risks / Trade-offs

- **Fresh ref 取得失敗卻誤判為已在 main** → 沿用既有 fetch-before-worktree gate；fetch 失敗時 ledger 保持不變。
- **Cleanup 後 ledger 寫入失敗** → 下輪仍會重試同批；沒有 remote branch／PR 副作用，失敗可恢復。
- **混合 changed／unchanged candidate 被錯走 shortcut** → shortcut 只在整個 staged index 無 diff 時生效，任一 sidecar 有差異就維持正常 publisher lifecycle。
- **舊 consumer 不認得 provenance 欄位** → 欄位是向後相容的附加 metadata；既有 `publishState` 語意不變。
