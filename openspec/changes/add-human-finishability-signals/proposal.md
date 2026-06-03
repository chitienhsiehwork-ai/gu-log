## Human Review Summary

這份 change 要讓 gu-log 記住三件事：

1. 你有沒有真的讀完一篇文章。
2. 你留言說難看 / 好看時，是針對哪一版文章。
3. Tribunal 不能只因為 AI 分數過關，就忽略你的負面回饋。

本 change 不要求現在選資料庫、不要求立刻移除 Giscus，也不要求一次做完整 analytics。它先定義 reviewable contract：**human feedback 必須 versioned，且 unversioned raw comments 不能直接驅動 automation。**

## Review Decision Requested

這次請 ShroomDog review / approve 的決策：

1. Human feedback 必須綁文章版本。
2. Raw unversioned Giscus comments 不得驅動 Tribunal rewrite / publish block。
3. 明確負向 human feedback 可以推翻「AI score PASS 就算完成」。
4. OAuth trusted owner emails 可歸為 ShroomDog / owner-grade signals；random guest signals 可以記錄，但只作參考，未經 ShroomDog approve 不得影響 Tribunal。
5. Storage transport、first-party feedback UI、`contentVersion`、active-read thresholds 延後到 follow-up changes 決定。

這次**不要求**批准：

- trusted owner email allowlist 的實際 email 值（應放 config/secrets，不放 OpenSpec）。
- 最終 storage transport（Giscus-derived index / first-party API / Gist / repo JSONL / DB）。
- 是否要把 Giscus 換成 first-party feedback form。
- active read time / scroll depth 的精確 threshold。
- Tribunal judge routing 的完整 implementation。

## Why

Tribunal 目前主要依賴 AI judge 分數與 pass bar 判斷文章能不能發，但 gu-log 的產品目標不是「模型覺得合格」，而是讓 ShroomDog / 讀者真的一路讀下去、想留言、想分享。ShroomDog 最低成本、最誠實的品質訊號是：**這篇我有沒有讀完**。

現況已經有閱讀狀態、Giscus comment、文章版次 badge、Tribunal rewrite loop，但這些系統沒有串起來：

- 已讀 tracker 只存 slug，不記 active read time、scroll depth、完成方法、文章版次。
- Giscus comment 綁 pathname，不知道留言當下文章是 v 幾，也不會把「這篇難看死了」歸為負向 human feedback。
- ShareButton 有分享 UI，但沒有把分享意圖視為強正向訊號。
- Tribunal 會背景重寫低分文章，但缺少 per-version human signal 作為 requeue / rewrite evidence。

如果 comment 不綁文章版次，Tribunal 重寫後舊留言會漂移：v1 的負評可能被誤解成 v5 仍然失敗。這會污染回饋迴路。

## What Changes

- **新增 Human Finishability Signals capability**：定義 reading engagement、gu-log 站內 comment、share intent 的事件 schema、reader trust tier 與語意。
- **新增 Versioned Human Feedback capability**：每個 feedback/comment/share/read-finish event 必須綁定文章 identity + 版本 snapshot，避免 Tribunal rewrite 後訊號漂移。
- **新增 Tribunal Human Signal Loop capability**：定義 human negative/positive signals 如何以 deterministic packet 進入 Tribunal evidence / requeue / publish policy；具體 routing 與 storage 可分階段落地。
- **保留現有系統邊界**：OpenSpec 不假設立刻替換 Giscus、reading tracker 或 Vercel Analytics；先定義 contract。

## Capabilities

### New Capabilities

- `human-finishability-signals` — reading engagement、finish/abandon/share/comment 的資料契約與產品語意
- `versioned-human-feedback` — gu-log comment / feedback 綁定文章版次與內容 snapshot 的契約
- `tribunal-human-signal-loop` — human signals 餵入 Tribunal rewrite / requeue / publish decision 的契約

### Modified Capabilities

- `tribunal-ops-policy` — human feedback 成為合法 stop/requeue/block publish trigger；score compliance 不能覆蓋 human reading-quality loss。

### Depends on `add-tribunal-ops-policy`

`tribunal-ops-policy` is introduced by active change `add-tribunal-ops-policy`, not by an archived baseline under `openspec/specs/` yet. This change is therefore blocked from archive until `add-tribunal-ops-policy` is archived first, so the `MODIFIED Requirements` delta has an existing capability baseline to modify.

## Impact

- **Frontend / UX**
  - `src/components/ReadStatusButton.astro`
  - `src/components/ReadingProgress.astro`
  - `src/components/ShareButton.astro`
  - `src/components/Giscus.astro` 或未來 first-party feedback form
  - `src/pages/posts/[...slug].astro` / `src/pages/en/posts/[...slug].astro`
- **Analytics / telemetry boundary**
  - `src/layouts/BaseLayout.astro`（目前只注入 Vercel Web Analytics；若採 custom events，需明確定義 event payload 與 Tribunal query/export path）
- **API boundary**
  - `src/pages/api/feed.json.ts`
  - `src/pages/api/posts/[slug].json.ts`
  - 或未來 first-party human-signal ingestion/query API
- **Data / versioning**
  - `src/lib/reading-tracker.ts`
  - `src/lib/gist-sync.ts`
  - `src/utils/post-versions.ts`
  - `src/data/post-versions.json` 或未來 manifest v2
- **Tribunal / operations**
  - `scripts/tribunal.sh`
  - `scripts/tribunal-quota-loop.sh`
  - `.score-loop/state/tribunal-progress.json`
  - `.score-loop/state/tribunal-triage-events.json`（或等效 triage store）
  - `docs/shroomdog-editorial-feedback.md`（只放可泛化 lessons，不放所有 per-article raw feedback）
- **Non-goals for this change**
  - 不規定必須立刻移除 Giscus。
  - 不規定必須用 Vercel Analytics、自建 DB、GitHub Discussions、Gist 的哪一種 transport；spec 只要求資料 contract 與可查詢性。
  - 不把所有 comment 當正向訊號；明確負評是強負向訊號。
  - random guest actions MAY be tracked as reference signals, but SHALL NOT drive Tribunal until ShroomDog / owner approval promotes or resolves them.
