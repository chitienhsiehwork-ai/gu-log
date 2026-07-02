# Tasks

## 1. Data model

- [x] 1.1 定義 Reader Tracker v2 read record schema，至少包含 slug、readAt、readRevision、revisionState。
- [x] 1.2 實作 v1 slug list 到 v2 records 的 migration；legacy slug SHALL become `readRevision: null` / `revisionState: "unknown"`。
- [x] 1.3 更新匯入、匯出與 sync payload，保留 read revision。
- [x] 1.4 更新 sync merge：同 slug 不同 revision 時保留較新的 readAt / readRevision，不再只是 union slug。

## 2. Version exposure

- [x] 2.1 定義 reader-facing revision 的來源；不得直接沿用目前 commit-count value 作為 read-relevant revision。
- [x] 2.2 確認每篇文章在 tracker 和文章頁都有 current reader-facing revision。
- [x] 2.3 標記已讀時寫入當下 revision。
- [x] 2.4 缺少 revision 時使用明確 fallback，不默默假裝最新。
- [x] 2.5 加測：body content update 會改 revision；backend-only metadata update 不會改 revision。

## 3. UI and verification

- [x] 3.1 Tracker 顯示 current read、stale read、unread。
- [x] 3.2 進度統計不要把 stale read 當 fully current read。
- [x] 3.3 `openspec validate add-version-aware-reader-state --strict` 通過。
