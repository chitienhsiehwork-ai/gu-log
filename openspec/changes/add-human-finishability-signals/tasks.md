## Phase 1 — Required for this OpenSpec approval

- [ ] 1.1 ShroomDog review proposal / design，確認「gu-log 站內 comment，不是原文 comment」的範圍
- [ ] 1.2 Approve minimum version snapshot fields: `postId`, `lang`, `pathname`, `postVersion`, `occurredAt`
- [ ] 1.3 Approve rule: raw unversioned Giscus comments SHALL NOT drive Tribunal rewrite / publish block
- [ ] 1.4 Approve rule: explicit negative human feedback MAY override AI PASS status, but only through bounded review/requeue policy
- [ ] 1.5 Decide or explicitly defer storage transport: Giscus-derived index / first-party API / Gist / repo JSONL / external DB
- [ ] 1.6 Decide or explicitly defer version semantics: current `postVersion` only vs future `contentVersion`
- [ ] 1.7 Approve identity policy: trusted GitHub OAuth owner emails are ShroomDog / owner-grade; random guest signals are reference-only until owner-approved

## Phase 2 — Identity, article identity, and version snapshot follow-up

- [ ] 2.1 建立 trusted owner email allowlist config/secrets source；不要把 actual emails commit 進 repo
- [ ] 2.2 在 event schema 中加入 `readerTrustTier`, `identitySource`, `ownerApproved`, and provenance fields
- [ ] 2.3 在文章頁建立 single source helper，輸出 `postId/ticketId/lang/pathname/postVersion`
- [ ] 2.4 若需要 timestamp inference，設計 manifest v2 或 git-history index，支援 version boundary / qualified commit / optional content hash
- [ ] 2.5 確保 zh-tw / en 文章 identity 與 version 分開但可關聯

## Phase 3 — Reading engagement follow-up

- [ ] 3.1 將 `reading-tracker.ts` 從 v1 `slugs[]` migration 到 v2 event-aware store
- [ ] 3.2 實作 active read time、max scroll depth、finish method、confidence
- [ ] 3.3 將 manual / bulk / import read 與 auto scroll finish 分開標記
- [ ] 3.4 保留 Gist sync backward compatibility

## Phase 4 — Share and comment signal follow-up

- [ ] 4.1 在 `ShareButton` 記錄 share intent target/result + version snapshot
- [ ] 4.2 若使用 Giscus，建立 comment sync/indexer，將 GitHub Discussion comments 補上 article version snapshot
- [ ] 4.3 若使用 first-party feedback form，送出時直接附 version snapshot
- [ ] 4.4 建立 comment sentiment / feedback type classifier 規則，確保明確負評歸為 negative/rewriteNeeded

## Phase 5 — Tribunal integration follow-up

- [ ] 5.1 建立 per-article human signal packet 產生器
- [ ] 5.2 將 unresolved human negative signals 注入 FreshEyes / Vibe / FactChecker / Librarian 對應 judge evidence
- [ ] 5.3 明確指定 human signal ledger / triage events / progress ledger 的 SSOT 分工與 locking discipline
- [ ] 5.4 定義 guest_reference review dashboard / summary：guest signals 可供 ShroomDog 參考，但未 approve 不進 Tribunal
- [ ] 5.5 定義 PASS article 遇到 severe unresolved negative signal 的 bounded requeue policy，包含 quota loop 可消費的 requeue marker
- [ ] 5.6 Publisher 應 block current-version unresolved severe human negative signal，直到 resolution

## Phase 6 — Verification follow-up

- [ ] 6.1 Unit test：v1 reading tracker migration 不丟失已讀 slugs
- [ ] 6.2 Unit test：read finish event 必含 article identity + version
- [ ] 6.3 Unit test：negative comment record 必含 version snapshot
- [ ] 6.4 Unit test：share intent record 必含 target/result/version
- [ ] 6.5 Integration test：Tribunal packet 讀到 unresolved negative feedback 並標示 requeue/block publish
- [ ] 6.6 Manual smoke：文章頁讀到底、留言、分享後可查到 versioned event
