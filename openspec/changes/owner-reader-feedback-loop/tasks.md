# Tasks

## 1. 事件帶 reader revision

- [x] 1.1 `ArticleVersionSnapshot` 與事件型別新增選填 `readerRevision`，`normalizeSnapshot` 保留它，`articleVersionKey` 納入它；驗證：unit test 確認 `recordReadFinish`／`recordReadAbandonCandidate`／`recordShareIntent`／`recordFeedbackComment` 產生的事件帶 `readerRevision`
- [ ] 1.2 `ReadStatusButton.astro`、`ShareButton.astro` 的快照帶入 reader revision（`ShareButton` 需要新增 prop 並由 `ArticleActionArea` 傳入）；驗證：Playwright 測試在一篇 zh-tw 與一篇 en 文章頁斷言 `[data-read-button]` 與 share 元素的 `data-reader-revision` 等於 `src/data/post-reader-revisions.json` 的值
- [x] 1.3 `buildHumanSignalTribunalPacket` 的輸出訊號帶 `readerRevision`；驗證：既有 packet 測試更新後通過

## 2. 一鍵回饋

- [ ] 2.1 新增 `OwnerFeedback.astro`（好看／普通／難看想重寫 + 選填備註，最長 280 字），未登入時 `hidden`，送出後顯示已記錄；放進 `ArticleActionArea`；驗證：Playwright 測試未登入看不到、設定 `gu-log-jwt` 後看得到且點擊會寫入 `feedback_comment`（`source: first_party`、正確 polarity、帶 reader revision）
- [ ] 2.2 zh-tw／en 文案；驗證：2.1 的 Playwright 測試加一個 en 文章頁案例，斷言按鈕為英文標籤
- [ ] 2.3 跑 `uiux-auditor`（雙主題、WCAG 對比）並修掉 must-fix；驗證：audit 無 must-fix
- [ ] 2.4 回饋備註最長 280 字元（`maxlength` 與 `recordFeedbackComment` 端截斷）；驗證：unit test 送 300 字備註，事件只存 280 字

## 3. 送出通道

- [ ] 3.1 `SignalTransport` 新增 `gu_log_api`；`getPendingHumanSignalEvents` 改成只回傳 `local_only`；新增 `src/lib/human-signal-sync.ts`（重用 gist-sync 的 token／逾時 helper 與 public-api-url；批次 50、5 秒逾時、`keepalive`、accepted→synced、rejected→sync_failed 不重送、未列出→維持待送、404／錯誤靜默）；驗證：unit test 以 mock fetch 覆蓋 accepted、rejected、未列出、404、逾時、未登入不送
- [ ] 3.2 文章頁載入、記錄事件後（debounce）、`pagehide` 觸發同步；驗證：Playwright 測試攔截 `/human-signals` 請求，確認登入時送出、未登入不送、回 404 時頁面無錯誤

## 4. 匯出

- [ ] 4.1 Reading Tracker 頁新增「匯出閱讀紀錄」按鈕，下載 D5 格式 JSON；驗證：Playwright 測試下載檔案並以 schema 檢查

## 5. 校準報告

- [ ] 5.1 `src/lib/reader-signal-calibration.ts` 純函式：版本分類（目前／舊／不明）、每篇最新明確回饋（無 `reader` 視為同一本機讀者）、用 `classifyTribunalResult` 分 PASS／未 PASS／未評分、分歧清單、樣本門檻；驗證：unit test 覆蓋 `reader-signal-calibration` spec 的每個 scenario
- [ ] 5.2 `scripts/reader-signal-calibration.ts` 與 `pnpm reader:calibrate` script（文字與 `--json` 輸出，唯讀）；驗證：用測試 fixture 匯出檔跑出預期報告，且 `git status` 無任何檔案變動
- [ ] 5.3 在 `docs/tribunal-runbook.md` 加一段怎麼匯出與跑校準報告、automation 開關預設關閉；驗證：段落指向腳本與 spec，不複述門檻數值

## Workflow follow-up

- 後端 `/human-signals` 與 `/human-signals/export` 依 design D4 在後端主機的 gu-log-api 實作（等 owner 開放存取，在 `~/ai-workspaces/` 下作業），不在本 change 的追蹤範圍。
- 校準報告樣本足夠且顯示隱性訊號有用時，另開 change 把訊號注入 judge context。
