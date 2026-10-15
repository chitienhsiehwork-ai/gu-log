# Design

## Context

- `src/lib/human-signals.ts` 已有事件 schema、`localStorage` store、`getPendingHumanSignalEvents` / `markHumanSignalEventSynced` 與 `buildHumanSignalTribunalPacket`，但 `transport` 只有 `local_storage`，`recordFeedbackComment` 沒有任何呼叫端。
- 文章頁已經把 reader revision（`src/data/post-reader-revisions.json`，由 `scripts/build-reader-revision-manifest.mjs` 產生的內容雜湊）傳給 `ReadStatusButton`（`data-reader-revision`），只是沒有寫進事件。
- `postVersion` 來自 `src/data/post-versions.json`（git touch 次數），Tribunal 寫分數的 commit 也會讓它 +1。
- 登入狀態是 `localStorage` 的 `gu-log-jwt`，後端 base URL 是 `PUBLIC_API_URL`（預設 `https://api.shroomdog.dev`）。後端是主機上的 `gu-log-api.service`，原始碼不在本 repo。
- Tribunal 分數在 MDX frontmatter `scores:`；PASS 判斷的 SSOT 是 `src/utils/tribunal-scores.ts`（`meetsPublishBar` / `computeOverallComposite`）。

## Goals / Non-Goals

**Goals:**
- 讓 owner 的明確意見能被記錄、正確對到內容版本、送到後端。
- 後端還沒上線時，前端完全照舊運作，且校準報告可以用匯出檔先跑。
- 產出第一份「Tribunal 準不準」的校準報告。

**Non-Goals:**
- 不在本 repo 實作後端資料庫與 API（只定契約）。
- 不實作 automation 開關打開後的行為（judge 注入、requeue、publisher block）；本 change 只定義開關且預設關閉，Tribunal 程式碼目前也沒有任何 human signal 消費端，所以關閉狀態不需要改 Tribunal。
- 不做 Giscus 留言索引、guest 訊號儀表板、自動 requeue、publisher block。
- 不修正自動 abandon 偵測的雜訊來源；v1 只是不採信它。

## Decisions

### D1. 版本比對用 reader revision，`postVersion` 只保留顯示

事件新增選填欄位 `readerRevision: string`。快照從頁面 data attribute 取得，所有 `record*` 函式透過 `ArticleVersionSnapshot` 傳入；`articleVersionKey` 也納入 reader revision。`versioned-human-feedback` 裡的 `contentVersion`／`contentHash` 由 reader revision 滿足，不另造整數版本。替代方案是改用 `contentVersion` 整數，但那需要新的版本索引；內容雜湊已經存在而且正好排除 metadata，直接用最便宜。

### D2. 一鍵回饋是獨立元件，只在登入時顯示

新增 `OwnerFeedback.astro`，放在 `ArticleActionArea` 的 action controls 下方。三個按鈕：好看（`positive`）、普通（`unknown`，介面標「普通」）、難看想重寫（`rewrite_needed`），加一個選填單行備註。用 `gu-log-jwt` 是否存在決定顯示（client-side），所以靜態 HTML 對所有人一樣，未登入時元素保持 `hidden`。不另做「刪除回饋」，改選即新增事件，消費端取最新一筆（spec 已規定）。

替代方案：用 Giscus 留言。被否決，因為留言是公開的、沒有版本綁定、需要額外的索引器。

`普通` 用 `unknown` polarity 而不是新增 enum 值，避免動到既有 `CommentPolarity` 的消費端；備註文字最長 280 字元。

### D3. 送出通道：`fetch` + `keepalive`，批次、失敗靜默

新增 `src/lib/human-signal-sync.ts`：
- 觸發時機：文章頁載入時、每次記錄新事件後（debounce），以及 `pagehide`。
- 重用 `src/lib/gist-sync.ts` 的 `getGuLogSessionToken`、逾時 helper 與 `src/lib/public-api-url.ts` 的 URL 正規化，不另寫一份。
- `POST ${PUBLIC_API_URL}/human-signals`，`Authorization: Bearer <gu-log-jwt>`，body `{ "events": HumanSignalEvent[] }`，每批最多 50 筆。用 `fetch(..., { keepalive: true })`，因為 `sendBeacon` 不能帶 Authorization header。
- 回應 `{ "accepted": string[], "rejected": { "eventId": string, "reason": string }[] }`；`accepted` 標 `synced`，其餘維持 `local_only`。404／網路錯誤／逾時（5 秒）一律靜默，下次再試。`rejected` 的事件標 `sync_failed`，不再重送；`getPendingHumanSignalEvents` 因此改成只回傳 `local_only`。
- 已登入但不是 owner 的讀者：本機照樣顯示「已記錄」（事件確實記在本機），後端回 `rejected: not_owner` 後標 `sync_failed`。v1 只有 owner 會登入，不另做 owner 判斷 UI。
- `transport` 型別新增 `'gu_log_api'`，已同步事件標成這個值。

### D4. 後端契約（給後端主機上的實作用）

- `POST /human-signals`：驗 JWT；以伺服器端 owner email allowlist 判 `owner_trusted`，非 owner 一律回 `rejected: not_owner` 且不儲存；忽略客戶端的 `readerTrustTier`；以 `eventId` 做唯一鍵（重送回 accepted）；每批上限 50 筆、單筆 4 KB、每使用者每分鐘 60 次。
- `GET /human-signals/export`：需要 owner JWT 或伺服器端 operator token，回傳與匯出檔相同的格式。
- 儲存：VM 上 SQLite 單一資料表（`event_id` PK、`post_id`、`reader_revision`、`kind`、`occurred_at`、`payload` JSON），之後真的需要再換。

### D5. 匯出檔格式即報告輸入格式

`{ "exportSchemaVersion": 1, "exportedAt": string, "events": HumanSignalEvent[] }`。Reading Tracker 頁的匯出按鈕與後端 export 端點產出同一格式，報告只讀這一種。

### D6. 校準報告是 tsx 腳本，重用分數 SSOT

`scripts/reader-signal-calibration.ts`（`pnpm reader:calibrate -- --events <file> [--min-sample 10] [--json]`）：
- 讀事件檔、`src/data/post-reader-revisions.json`、文章 frontmatter `scores`。
- 用 `src/utils/tribunal-scores.ts` 的 `classifyTribunalResult` 分類（PASS／未 PASS／未評分），composite 用 `computeOverallComposite`，不自己重算門檻；未評分的文章另列。
- 每篇取同一讀者、同一 reader revision 的最新明確回饋；事件沒有 `reader` 時視為同一位本機讀者（匯出檔只來自一個瀏覽器，後端匯出則一律有 `reader`）。
- 輸出：明確回饋 × PASS／未 PASS 對照表、分歧清單（PASS 但 owner 負評／未 PASS 但 owner 正評）、隱性訊號統計（另列）、舊版本與版本不明的計數；樣本低於 `--min-sample` 時顯示樣本不足、不給結論。
- 純函式核心（`src/lib/reader-signal-calibration.ts`）放邏輯，腳本只負責 I/O，方便測試。

## Risks / Trade-offs

- [owner 很少按回饋，樣本長期不足] → 報告明說樣本不足；按鈕放在文章底部的分享旁，路徑最短。
- [後端還沒上線，事件只在一台瀏覽器] → 匯出按鈕讓校準先跑；事件留在本機，後端上線後自動補送。
- [JWT 在 localStorage，可被同站腳本讀走] → 與既有 reader-sync 同等風險；後端只收 owner 事件、限流、去重，最壞情況是 owner 帳號被灌假回饋，報告可看出異常。
- [`keepalive` 請求在部分瀏覽器有 64 KB 上限] → 每批 50 筆、單筆 4 KB 以內，`pagehide` 時只送一批。
- [普通 = `unknown` 讓「普通」和「沒分類」混在一起] → 回饋事件的 `source: first_party` 可區分；報告把 first-party `unknown` 標成「普通」。

## Migration Plan

- 前端可以先上線：後端沒有端點時事件維持本機，行為與現在相同。
- 後端在後端主機上依 D4 實作並部署後，前端不用改版即開始同步。
- Rollback：revert 前端 PR 即可；本機事件格式只是多一個選填欄位，舊程式讀得懂。

## Open Questions

- owner allowlist 放在後端哪個 config／secret，等接上後端主機看現有 gu-log-api 結構再定（不影響本 repo 的契約）。
