## Context

四個只讀 subagents + follow-up review 得到的現況：

1. **Comments**：文章頁使用 `Giscus.astro`，`data-mapping="pathname"`，comments 存在 GitHub Discussions。gu-log repo 內沒有 first-party comment schema / DB / API。留言不含 post version；Giscus iframe submit 也不會自動附 gu-log metadata。
2. **Post versions**：`scripts/build-version-manifest.mjs` 以 git history touch count 產生 `src/data/post-versions.json`，頁面顯示 `vN`。manifest 只存 latest count，沒有 `vN -> commit/time/contentHash` 對照。現有 `postVersion` 是 file-touch version，不是 content-only version。
3. **Reading tracker**：`reading-tracker.ts` 只存 `{ version: 1, slugs, lastUpdated }`，可 localStorage + Gist sync。`ReadStatusButton` 與 auto scroll mark-read 目前只在 browser 有 `gu-log-jwt` 時啟用；未登入讀者只有 reading progress / Vercel pageview，不會寫入 read tracker。現有 auto mark read 用 IntersectionObserver 看到文章尾端後標記 slug，但沒有 active read time、scroll depth、完成方法、postVersion。
4. **Tribunal**：`tribunal.sh` 會在 stage fail 後呼叫 `tribunal-writer` 重寫；`tribunal-quota-loop.sh` 會背景持續挑未完成 / failed 文章重跑，但會跳過 current Tribunal version 下已 `PASS` / `EXHAUSTED` 的文章；publisher 已有 triage events 形狀，但 human finishability/comment/share 尚未進入 evidence/requeue/publish decision。
5. **Vercel Analytics**：`BaseLayout.astro` 目前注入 `@vercel/analytics`，提供站台 web analytics / pageview telemetry；repo 內沒有使用 `track()` 記錄 read/share/comment custom events，也沒有可由 Tribunal deterministic query 的 repo-local export 或 API。現有 Vercel Analytics 不等同 human-signal ledger。
6. **API routes**：目前 `src/pages/api/feed.json.ts` 與 `src/pages/api/posts/[slug].json.ts` 是 static GET endpoints，回傳 feed / article metadata / body 給外部 client；沒有 first-party `POST` event ingestion route、comment endpoint、share endpoint、或 human-signal query endpoint。
7. **GitHub OAuth identity**：gu-log 已有 GitHub OAuth login path。未來 implementation MAY use a configured allowlist of trusted owner emails to classify ShroomDog / owner-grade events. The actual email values SHALL live in config/secrets, not in OpenSpec text.

## Goals / Non-Goals

**Goals:**

- 讓 ShroomDog 是否讀完成為 gu-log 一級品質訊號。
- 用 GitHub OAuth trusted owner email allowlist 區分 ShroomDog / owner-grade signals 與 random guest reference signals。
- 把「沒讀完 / 明確留言說難看」當成負向品質 evidence，而不是要求 ShroomDog 解釋為什麼。
- 把站內 gu-log comment 綁定到留言當下的文章版本，避免 rewrite 後漂移。
- 把 share intent 視為強正向 signal，供 future source/angle/rewrite learning 使用。
- 讓 Tribunal 在背景重寫低分文章時能讀取 per-version human signals，並用 bounded policy requeue / block / resolve。

**Non-Goals:**

- 不追蹤 ShroomDog 在原文 Threads / X / HN 下的留言；這個 change 指的是 gu-log 站內 comment / feedback。
- 不把「有 comment」一律視為好；comment sentiment / feedback type 必須分類。
- 不要求第一版就做完整產品分析平台。
- 不把單次 bounce 直接判定為 boring；必須保留 `unknown` / confidence。
- 不在本 change 選定 storage transport、first-party feedback UI、或 active-read thresholds。
- 不讓 random guest signals 未經 owner approval 直接影響 Tribunal rewrite / publish decisions。

## Decisions

### D1: Human signal 以 event ledger 為主，不直接塞進文章 frontmatter

**選擇**：per-article human signals 寫入可查詢 ledger / DB / JSONL / GitHub-derived index；frontmatter 只 MAY 放精簡狀態，不放 raw comments。

**理由**：raw feedback 會很多且可能含私密/情緒文字，直接進 MDX frontmatter 會污染 content artifact，也容易造成 Tribunal rewrite commit 雜訊。

### D2: comment 必須綁 version snapshot，不只綁 pathname

**選擇**：每筆 comment record SHALL 記 `postId/lang/pathname/postVersion/createdAt`；`contentVersion/contentHash/qualified commit` 是未來 manifest v2 或 snapshot helper 可提供的 optional fields。

**理由**：Tribunal 會重寫文章。v1 的負向 feedback 不能自動套到 v5；但 v5 rewrite 應知道自己是為了解決 v1 的 human negative feedback。

### D3: 讀完不是只有 `slugs[]`

**選擇**：保留既有 read tracker v1 migration，但新增 richer engagement event：`read_finish`、`read_progress`、`read_abandon_candidate`。

**理由**：手動 bulk mark read、import、scroll 到底、真正 active reading 完成，語意不同；混在 `slugs[]` 會污染 finishability metric。

### D4: negative comment 是高價值訊號

**選擇**：明確負評分類為 `sentiment=negative`、`feedbackType=boring_or_bad_read`、`rewriteNeeded=true`，不是 comment engagement positive。

**理由**：ShroomDog 不想花時間解釋為什麼無聊；系統應接受短負評作為明確 signal，再由 agent/Tribunal 嘗試找原因。

### D5: Reader trust tier 決定 signal 能不能影響 Tribunal

**選擇**：GitHub OAuth trusted owner emails MAY classify events as `owner_trusted` / ShroomDog-grade. Random guest events MAY be tracked for product reference, pattern spotting, and ShroomDog review, but SHALL remain `guest_reference` until ShroomDog / owner approval promotes or resolves them.

**理由**：random guest 行為很有參考價值，但它可能是路過、bot、誤點、或不同讀者口味。gu-log 的 owner-quality loop 仍以 ShroomDog 判斷為最高權重；guest data 先當旁觀席，不直接衝進 Tribunal 駕駛座。

### D6: Tribunal 使用 human signal 作 deterministic evidence，而不是讓模型自由猜

**選擇**：在 judge / writer prompt 中注入 per-version human signal packet，並在 progress / triage state 中保留 resolution。

**理由**：AI judge score 是 proxy；human finishability 是更接近產品目標的 evidence。模型不應憑空推測「讀者可能覺得無聊」，應讀到具體 event。

## Data model sketch

Current minimum fields:

```json
{
  "eventSchemaVersion": 1,
  "eventId": "hfs_...",
  "kind": "read_finish|read_progress|read_abandon_candidate|comment|share_intent",
  "post": {
    "postId": "sp-198-20260512-garrytan-ai-agent-complexity-ratchet",
    "ticketId": "SP-198",
    "lang": "zh-tw",
    "pathname": "/posts/sp-198-20260512-garrytan-ai-agent-complexity-ratchet",
    "postVersion": 4
  },
  "reader": "ShroomDog",
  "readerTrustTier": "owner_trusted",
  "identitySource": "github_oauth_trusted_email",
  "ownerApproved": true,
  "occurredAt": "2026-06-03T00:00:00Z",
  "payload": {
    "commentText": "這篇難看死了",
    "sentiment": "negative",
    "feedbackType": "boring_or_bad_read",
    "rewriteNeeded": true
  }
}
```

Future manifest v2 / snapshot helper fields, not available in the current manifest:

```json
{
  "contentVersion": 3,
  "contentHash": "sha256:...",
  "servedBuildCommit": "abc123...",
  "articleFileCommit": "def456..."
}
```

## Migration Plan

1. **OpenSpec review**：先讓 ShroomDog review 這個 spec，確認資料語意與 product loop。
2. **Event identity / version snapshot**：在 article page expose post identity + current file-touch `postVersion`；transport/contentVersion 可 deferred。
3. **Identity trust tier**：用 GitHub OAuth trusted owner email allowlist 標記 owner-grade events；guest events 只能進 reference queue，需 ShroomDog approve 才能影響 Tribunal。
4. **Reading tracker v2**：保留現有 `slugs[]`，新增 event ledger；bulk/import/manual read 不當作高信心 finishability。
5. **Share tracking**：在 `ShareButton` 記錄 share intent target/result + version snapshot。
6. **Comment indexing**：若保留 Giscus，新增 GitHub Discussions sync/indexer；timestamp inference 需 manifest v2 / git-history boundary，不可只靠現有 latest-count manifest。若改 first-party form，送出時直接附 version snapshot。
7. **Tribunal ingestion**：human signal ledger / triage events 做 evidence SSOT；progress ledger 繼續做 execution status SSOT。若 human signal 影響執行狀態，必須透過 bounded requeue marker 與現有 locking discipline 串接。
8. **Requeue / publish policy**：unresolved severe negative signal 可 block publish 或 requeue；positive share signal 可標為 preserve / study；所有 automation 必須 bounded。

## Risks / Trade-offs

- **Guest signal overreach risk**：random guest 行為可能有參考價值，但不得未經 ShroomDog approve 直接影響 Tribunal；否則 gu-log 會變成被路人 clickstream 牽著走，偏離 owner-quality loop。
- **Privacy / embarrassment risk**：短負評可能很直，raw comments 不應無限制公開進 repo；需分清 public comment 與 private signal。
- **False boring risk**：使用者跳出可能是忙，不一定無聊；abandon 需要 confidence，不可單次跳出就重寫。
- **Giscus limitation**：iframe comment submission 不會自動附 gu-log metadata；若繼續用 Giscus，需要 sync/indexer 或 UI 明確提示。
- **Version semantics drift**：目前 `vN` 是 file touch count，metadata-only scores 也會 bump。若 human feedback 針對正文，長期應分 `fileVersion` / `contentVersion`。
- **Automation loop risk**：human negative signal 不能造成無限重寫；必須 bounded，EXHAUSTED 後走 manual review。

## Open Questions

- human feedback ledger 應該用 GitHub Discussions derived index、private Gist、repo JSONL、還是 `api.shroomdog.dev` DB？
- `contentVersion` 第一版是否要和現有 `postVersion` 分離，還是先用 `postVersion` 再遷移？
- ShroomDog 的站內 comment 是要公開留在 Giscus，還是需要一個 private「我覺得難看」feedback button/form？
- 分享是否只記 share intent（點擊），還是要嘗試區分成功分享？外部 X/Facebook/LINE 通常只能可靠記 attempted。
- trusted owner email allowlist 應該放在哪個 config/secrets source，如何避免 email 值進 repo？
