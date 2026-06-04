# Design: Version-aware Reader State

## Current shape

現在 tracker 像一本很粗的簽到簿，只記「來過」。文章後來有沒有被重寫，它不知道。

## Proposed shape

閱讀紀錄升級成一張小卡片：這篇文章、什麼時候讀、當時是哪一版。Tracker render 時拿這張卡跟目前文章版本比對，決定它是 current read 還是 stale read。

## Revision source

現有文章版本 manifest 的 delivery path 可以 reuse，但它目前的 value 是 commit-touch count，不能直接當 read-relevant revision。這個 change 要引入 reader-facing revision：一個由讀者可見內容決定的 deterministic value，建議用 content hash，並排除純後台 metadata。

## Minimal v2 record

最小資料模型應能表達「讀過、何時讀、讀哪一版」：

```ts
{
  version: 2,
  records: {
    [slug: string]: {
      slug: string,
      readAt: string,
      readRevision: string | null,
      revisionState: "current" | "stale" | "unknown"
    }
  },
  lastUpdated: string
}
```

## Migration

舊資料只有 slug。migration 不可以刪掉它們；應把它們轉成 legacy read records。預設策略：v1 slug 轉成 `readRevision: null` 與 `revisionState: "unknown"`，UI 顯示為「已讀，但版本未知」，而不是默默假裝 current。

## UI semantics

Stale read 不是 unread。它比較像「以前看過，但這篇現在有新版」。進度統計應該能把它從 fully current read 裡分出來。
