# Proposal: 讓 Reader Tracker 記得讀的是哪一版

## Why

Reader Tracker 目前只記「這篇讀過」，不記「讀的是哪一版」。文章只要被改寫但 slug 沒變，舊閱讀狀態就會假裝還是最新，這對讀者不誠實。

## What Changes

- 將閱讀紀錄從單純 slug list 升級成 per-post read record。
- 每次標記已讀時，保存當下的文章版本或 read-relevant revision。
- Reader Tracker 顯示 current read、stale read、unread 的差別。
- 定義舊閱讀紀錄 migration，不讓既有已讀資料消失。
- 將文章版本 manifest 正式納入 Reader Tracker 可依賴的產品契約。

## Capabilities

### New Capabilities

- `reader-read-state`：定義閱讀紀錄的版本化資料模型、migration、顯示與統計語義。
- `post-version-manifest`：定義站台如何提供每篇文章目前可供比較的 reader-facing revision。

### Modified Capabilities

- 無。

## Impact

會影響 Reader Tracker、本機閱讀紀錄、同步 payload、匯入匯出、文章頁標記已讀，以及進度統計。這個 change 不決定 tribunal 哪些改寫會更新版本；只先讓 tracker 有能力分辨版本。

## Approval Meaning

批准這個 change 等於同意：Reader Tracker 的已讀紀錄升級為帶有 article identity、read timestamp、read revision 的 v2 record，並依 reader-facing revision 區分 current read / stale read / unread。

不等於同意：OAuth 同步授權流程，或 tribunal 哪些事件會 bump reader-facing revision。
