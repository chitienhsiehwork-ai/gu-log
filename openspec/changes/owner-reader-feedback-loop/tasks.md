# Tasks

## 1. 事件帶 reader revision

- [ ] 1.1 `ArticleVersionSnapshot` 與事件型別新增選填 `readerRevision`，`normalizeSnapshot` 保留它；驗證：unit test 確認 `recordReadFinish`／`recordShareIntent`／`recordFeedbackComment` 產生的事件帶 `readerRevision`
- [ ] 1.2 `ReadStatusButton.astro`、`ShareButton.astro` 的快照帶入 reader revision（`ShareButton` 需要新增 prop 並由 `ArticleActionArea` 傳入）；驗證：`pnpm build` 後文章頁 HTML 的 share／read 元素都有 `data-reader-revision`
- [ ] 1.3 `buildHumanSignalTribunalPacket` 的輸出訊號帶 `readerRevision`；驗證：既有 packet 測試更新後通過

## 2. 一鍵回饋

- [ ] 2.1 新增 `OwnerFeedback.astro`（好看／普通／難看想重寫 + 選填備註，最長 280 字），未登入時 `hidden`，送出後顯示已記錄；放進 `ArticleActionArea`；驗證：Playwright 測試未登入看不到、設定 `gu-log-jwt` 後看得到且點擊會寫入 `feedback_comment`（`source: first_party`、正確 polarity、帶 reader revision）
- [ ] 2.2 zh-tw／en 文案；驗證：en 文章頁顯示英文標籤
- [ ] 2.3 跑 `uiux-auditor`（雙主題、WCAG 對比）並修掉 must-fix；驗證：audit 無 must-fix

## 3. 送出通道

- [ ] 3.1 `SignalTransport` 新增 `gu_log_api`；新增 `src/lib/human-signal-sync.ts`（批次 50、5 秒逾時、`keepalive`、accepted→synced、rejected→sync_failed、404／錯誤靜默）；驗證：unit test 以 mock fetch 覆蓋 accepted、rejected、404、逾時、未登入不送
- [ ] 3.2 文章頁載入、記錄事件後（debounce）、`pagehide` 觸發同步；驗證：Playwright 測試攔截 `/human-signals` 請求，確認登入時送出、未登入不送、回 404 時頁面無錯誤

## 4. 匯出

- [ ] 4.1 Reading Tracker 頁新增「匯出閱讀紀錄」按鈕，下載 D5 格式 JSON；驗證：Playwright 測試下載檔案並以 schema 檢查

## 5. 校準報告

- [ ] 5.1 `src/lib/reader-signal-calibration.ts` 純函式：版本分類（目前／舊／不明）、每篇最新明確回饋、PASS 判斷重用 `src/utils/tribunal-scores.ts`、分歧清單、樣本門檻；驗證：unit test 覆蓋 spec 的每個 scenario
- [ ] 5.2 `scripts/reader-signal-calibration.ts` 與 `pnpm reader:calibrate` script（文字與 `--json` 輸出，唯讀）；驗證：用測試 fixture 匯出檔跑出預期報告，且 `git status` 無任何檔案變動
- [ ] 5.3 在 `docs/` 對應文件加一段怎麼匯出與跑報告；驗證：文件指向腳本與 spec，不複述門檻數值

## Workflow follow-up

- 後端 `/human-signals` 與 `/human-signals/export` 依 design D4 在 後端主機的 gu-log-api 實作（等 owner 開放存取，在 `~/ai-workspaces/` 下作業），不在本 change 的追蹤範圍。
- 校準報告樣本足夠且顯示隱性訊號有用時，另開 change 把訊號注入 judge context。
