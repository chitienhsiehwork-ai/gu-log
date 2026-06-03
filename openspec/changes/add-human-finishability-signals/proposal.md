## Why

Tribunal 目前主要依賴 AI judge 分數與 pass bar 判斷文章能不能發，但 gu-log 的產品目標不是「模型覺得合格」，而是讓 ShroomDog / 讀者真的一路讀下去、想留言、想分享。ShroomDog 最低成本、最誠實的品質訊號是：**這篇我有沒有讀完**。

現況已經有閱讀狀態、Giscus comment、文章版次 badge、Tribunal rewrite loop，但這些系統沒有串起來：

- 已讀 tracker 只存 slug，不記 active read time、scroll depth、完成方法、文章版次。
- Giscus comment 綁 pathname，不知道留言當下文章是 v 幾，也不會把「這篇難看死了」歸為負向 human feedback。
- ShareButton 有分享 UI，但沒有把分享意圖視為強正向訊號。
- Tribunal 會背景重寫低分文章，但缺少 per-version human signal 作為 requeue / rewrite evidence。

如果 comment 不綁文章版次，Tribunal 重寫後舊留言會漂移：v1 的「這篇難看死了」可能被誤解成 v5 仍然難看。這會污染回饋迴路。

## What Changes

- **新增 Human Finishability Signals capability**：定義 reading engagement、gu-log 站內 comment、share intent 的事件 schema 與語意。
- **新增 Versioned Human Feedback capability**：每個 feedback/comment/share/read-finish event 必須綁定文章 identity + 版本 snapshot，避免 Tribunal rewrite 後訊號漂移。
- **新增 Tribunal Human Signal Loop capability**：定義 human negative/positive signals 如何進入 Tribunal evidence packet、requeue policy、publisher blocking / resolution。
- **保留現有系統邊界**：OpenSpec 不假設立刻替換 Giscus 或 reading tracker；先定義 contract，implementation 可分階段落地。

## Capabilities

### New Capabilities

- `human-finishability-signals` — reading engagement、finish/abandon/share/comment 的資料契約與產品語意
- `versioned-human-feedback` — gu-log comment / feedback 綁定文章版次與內容 snapshot 的契約
- `tribunal-human-signal-loop` — human signals 餵入 Tribunal rewrite / requeue / publish decision 的契約

### Modified Capabilities

- `tribunal-ops-policy` — human feedback 成為合法 stop/requeue/block publish trigger；score compliance 不能覆蓋 human reading-quality loss。

## Impact

- **Frontend / UX**
  - `src/components/ReadStatusButton.astro`
  - `src/components/ReadingProgress.astro`
  - `src/components/ShareButton.astro`
  - `src/components/Giscus.astro` 或未來 first-party feedback form
  - `src/pages/posts/[...slug].astro` / `src/pages/en/posts/[...slug].astro`
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
  - 不把所有 comment 當正向訊號；「這篇難看死了」是強負向訊號。
