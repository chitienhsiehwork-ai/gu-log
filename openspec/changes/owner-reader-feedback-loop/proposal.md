# Proposal

## Why

Tribunal 現在是 4 個 LLM judge 給 AI 寫的文章打分數，等於 AI 自己改自己的考卷。`add-human-finishability-signals`（2026-06-04 封存）已經在瀏覽器記錄 ShroomDog 的閱讀行為，但資料只留在 `localStorage`，而且版本綁的是 `postVersion`（Tribunal 寫分數也會讓它 +1），最明確的「這篇難看」訊號也沒有任何按鈕會送出。結果是 ShroomDog 的真實反應從來沒有機會當外部裁判。

## What Changes

- 文章底部新增 **owner 一鍵回饋**（好看／普通／難看想重寫，加一句選填備註），只在已登入時顯示，記成 `feedback_comment`（`source: first_party`）並附版本快照。
- 所有 human-signal 事件額外帶 **reader revision**（`post-reader-revisions.json` 的內容雜湊），讓「讀者看到的內容」成為版本比對依據；Tribunal 寫分數不會再讓舊回饋看起來過期。
- 新增 **送出通道**：已登入時把待送事件批次 POST 到 gu-log 後端的 `/human-signals`；後端不存在或失敗時事件留在本機、狀態維持 pending，不影響閱讀。信任等級一律由後端依 JWT 判定，前端算的值不具權威。
- Reading Tracker 頁新增 **匯出閱讀紀錄**（JSON 檔），讓後端資料庫上線前也能跑校準。
- 新增 **校準報告腳本**：比對 Tribunal 分數與 owner 的明確回饋／讀完／中途離開，列出「AI 說 PASS、owner 說難看」這類分歧。這是 human signal 的第一個也是 v1 唯一的消費者。
- **v1 不讓隱性訊號（中途離開、捲動深度）進入 judge context，也不自動 requeue／重寫／擋發布**；只有 owner 明確負評可以產生給 ShroomDog 看的 review 標記。修改 `tribunal-human-signal-loop` 既有「FreshEyes 收到 abandon 證據」的規定。

## Capabilities

### New Capabilities
- `owner-reader-feedback`: owner 明確回饋的收集、版本綁定、送出通道與後端契約。
- `reader-signal-calibration`: 用 owner 訊號檢驗 Tribunal 分數準不準的報告與其解讀邊界。

### Modified Capabilities
- `human-finishability-signals`: 事件必須帶 reader revision；送出通道定為 gu-log 後端資料庫。
- `tribunal-human-signal-loop`: 隱性訊號在校準證明有用之前不得進入 judge context。

## Impact

- 前端：`src/lib/human-signals.ts`、`src/components/ArticleActionArea.astro`、新回饋元件、`ReadStatusButton.astro`、`ShareButton.astro`、`src/pages/reading-tracker.astro`。
- 新腳本：`scripts/reader-signal-calibration.mjs` 與測試。
- 外部：`api.shroomdog.dev`（後端主機上的 gu-log-api，原始碼不在本 repo）需要新增 `/human-signals` 與資料庫；本 change 只定契約，後端實作另行在 VM 上完成。後端未上線前，前端行為與現在相同（只存本機）。
