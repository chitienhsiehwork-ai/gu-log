## Why

Tribunal 的 FactChecker 在無網路 sandbox 裡只收到文章路徑，即使 parent 已取得完整來源，judge 仍可能把「來源拿不到」誤判成文章 fidelity FAIL。#1099 已用完整 X Article 與多則 self-thread 重現；來源取得應是 harness 的可驗證前置條件，不應由每個 judge 碰運氣。

## What Changes

- GP／MP 的 FactChecker 啟動前，由 harness 透過 repo-owned source adapters 擷取完整 focal source，附上來源身分、擷取 provenance、完整性驗證、bytes 與 SHA-256。
- 來源存成私有、唯讀的獨立資料檔；trusted prompt 只引用 harness 選定路徑，明確把來源當不受信任的證據。judge 不自行擷取來源，也不執行來源內指令。
- 缺來源、來源不完整、超限、來源身分不符或 artifact 被修改時，在 judge call 前以可觀測的 operational error 結束，不偽造分數、不增加 content attempts。
- 一次 runner invocation 的重試與因合法改稿而重評沿用同一來源 packet；可用同一組文章與 packet 做 deterministic replay，不新增跨文章 cache 或自動重抽機制。
- 補齊 source adapters 在自動擷取路徑所需的 public-network、redirect、大小與來源身分邊界；保留既有抽取與來源型別驗證，不另建 crawler。
- SD／Lv 仍接受完整 FactChecker 評分，只是不因缺少 GP／MP focal source 被誤擋；GP／MP 的不同 editorial contract 不變。

## Capabilities

### New Capabilities

- `tribunal-focal-source-evidence`: 定義 GP／MP FactChecker 的完整來源 preflight、可信 metadata／不可信資料邊界、artifact integrity、可重播性與操作性失敗契約。

### Modified Capabilities

無。既有 unconditional fact verification、GP source-preservation 與 MP retained-claim grounding 持續適用；本變更不新增跳過評分或改稿權限。

## Impact

- legacy canonical runner `scripts/tribunal.sh`、FactChecker agent contracts、source packet helper，以及必要的 judge workdir 檔案傳遞。
- canonical `tools/gp-pipeline` source adapters／fetch report 與其既有 extractor，僅補安全擷取與可驗證 provenance 所需的介面。
- deterministic X、generic article、來源取得失敗、惡意來源文字、路徑／hash 及網路邊界測試；不得依賴 live 來源、模型或 production article。
- 與 #1098 分開 PR：先合併 reader-revision-bound NEEDS_REVIEW，再整合來源 evidence。保留 service operator stop 與自身 quota gate，不以合併此 PR 作為恢復 daemon 的授權。
