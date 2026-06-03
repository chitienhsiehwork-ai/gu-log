## 1. OpenSpec / design review

- [ ] 1.1 ShroomDog review proposal / design，確認「gu-log 站內 comment，不是原文 comment」的範圍
- [ ] 1.2 決定 storage transport：Giscus-derived index / first-party API / Gist / repo JSONL / external DB
- [ ] 1.3 決定 version semantics：先用現有 `postVersion`，或同步引入 `contentVersion`

## 2. Article identity and version snapshot

- [ ] 2.1 在文章頁建立 single source helper，輸出 `postId/ticketId/lang/pathname/postVersion`
- [ ] 2.2 設計 manifest v2 或 snapshot lookup，支援 `contentHash` / `commit`（若本階段採用）
- [ ] 2.3 確保 zh-tw / en 文章 identity 與 version 分開但可關聯

## 3. Reading engagement events

- [ ] 3.1 將 `reading-tracker.ts` 從 v1 `slugs[]` migration 到 v2 event-aware store
- [ ] 3.2 實作 active read time、max scroll depth、finish method、confidence
- [ ] 3.3 將 manual / bulk / import read 與 auto scroll finish 分開標記
- [ ] 3.4 保留 Gist sync backward compatibility

## 4. Share and comment signals

- [ ] 4.1 在 `ShareButton` 記錄 share intent target/result + version snapshot
- [ ] 4.2 若使用 Giscus，建立 comment sync/indexer，將 GitHub Discussion comments 補上 article version snapshot
- [ ] 4.3 若使用 first-party feedback form，送出時直接附 version snapshot
- [ ] 4.4 建立 comment sentiment / feedback type classifier 規則，確保「這篇難看死了」歸為 negative/rewriteNeeded

## 5. Tribunal integration

- [ ] 5.1 建立 per-article human signal packet 產生器
- [ ] 5.2 將 unresolved human negative signals 注入 FreshEyes / Vibe / FactChecker / Librarian 對應 judge evidence
- [ ] 5.3 在 progress ledger 或 triage events 表示 `human_negative_feedback` / `low_finishability` / `positive_share`
- [ ] 5.4 定義 PASS article 遇到 severe unresolved negative signal 的 bounded requeue policy
- [ ] 5.5 Publisher 應 block unresolved severe human negative signal，直到 resolution

## 6. Verification

- [ ] 6.1 Unit test：v1 reading tracker migration 不丟失已讀 slugs
- [ ] 6.2 Unit test：read finish event 必含 article identity + version
- [ ] 6.3 Unit test：negative comment record 必含 version snapshot
- [ ] 6.4 Unit test：share intent record 必含 target/result/version
- [ ] 6.5 Integration test：Tribunal packet 讀到 unresolved negative feedback 並標示 requeue/block publish
- [ ] 6.6 Manual smoke：文章頁讀到底、留言、分享後可查到 versioned event
