# Proposal

## Why

gu-log 的 GP 系列是沒有取得原作者同意的整篇翻譯；整篇翻譯屬於改作，需要作者同意。另有少數 MP 直接取材自付費新聞媒體。ShroomDog 已決定下架這些文章，但網站目前沒有真正的「下架」：`status: retired／deprecated` 只是貼標籤，全文照樣出現在文章頁、`/api/posts/*.json`（整份 MDX 原文）、`.md` 匯出、sitemap 與公開 repo 的 HEAD。要在推廣前一次關掉這些出口，同時保留網址，讓外部舊連結看到清楚的交代（墓碑頁），而不是 404。

授權來源：ShroomDog 於 2026-09-26 在 chat 做出下架決定，並於 2026-09-27 在 chat 授權「下架清單不用給我看，直接 e2e 做完」。因此下架清單由工具依規則產生、controller 對帳，不設逐篇確認的 owner gate。提案審查後，controller 依兩位審查員的意見拍板了修訂版方向（本版內容）。

## What Changes

- 新增文章狀態 `status: taken-down`（下架）。下架時保留原本的 frontmatter 欄位，只改成 `taken-down`、加上 `takenDownAt`，沒有 `sourceTitle` 才補上；摘要換成中性的一句（例如「這篇翻譯已下架。」）；正文清空。`deprecated`／`retired` 維持「仍公開全文的標籤」。
- 墓碑頁：下架文章的原網址改顯示定稿墓碑設計（石碑、Mogu、「Mogu 內心小劇場：」、「去讀原文 →」卡片），回 HTTP 200，帶 `<meta name="robots" content="noindex">`，並從 sitemap 移除。不做 410，也不改 middleware。GP 與 MP 各有一版文案，英文 sidecar 另有英文版。
- 三種輸出的 slug 集合不變式維持原樣：下架文章在 HTML、JSON、`.md` 都保留 slug，但內容只剩墓碑。JSON 只給墓碑 metadata、正文是空字串；`.md` 回一段簡短的墓碑 Markdown 與原文連結。首頁、系列頁、tag 頁、相關文章、RSS、JSON feed、三份搜尋索引、sitemap 全部排除下架文章。
- GP 暫停收新文：新的 GP 文章一律被驗證擋下；GP 系列頁與首頁的 GP 區塊改成改版空狀態「GP 正在改版：以後這裡會是 ShroomDog 精選的導讀」，不出現任何墓碑連結。之後的導讀新格式 change 會解除。
- 舊品牌 GP 列表的分頁網址改成轉到 GP 系列頁本身（MP 維持保留頁碼），讓所有舊列表網址追到的仍是 200。
- CI 棘輪：base 已經是 `taken-down` 的文章，head 必須仍是 `taken-down` 而且正文為空；新文章不得使用已下架文章的來源；`sources/` 不得新增第三方擷取。這條專門擋 VM 上還沒更新的 Tribunal 或 publisher 把全文寫回來。
- Tribunal 依 status 排除下架文章（不評分、不改寫），不是用「跳過 Fact Checker」的方式處理。Dedup 把下架文章視為「來源已封鎖」而不是「不存在」，並修正既有重複掃描只跳過 `deprecated` 的問題。
- 執行一批下架：清單由 `scripts/take-down-posts.mjs` 依 `takedown-list.json` 的規則從當下語料產生。規則是全部 GP（GP-1 自寫示範文除外）加上 `sourceUrl` 命中付費新聞網域的 MP；依 main（847d1f67）實算為 GP 繁中 270、英文 269，MP 4 篇（繁中 4、英文 4），共 547 個檔案。判斷不確定的 39 篇 MP 不下架，留給之後的 MP 防翻譯檢查。
- 清掉公開 repo HEAD 上的副本：下架文章正文、`sources/` 的第三方原文擷取（保留 `sources/chatgpt/`）、gp-pipeline 測試資料、`tribunal/fixtures` 裡的 GP 譯文段落、`public/prompts/` 與 `scripts/` 裡的第三方 prompt 全文、只被下架文章使用的圖檔；E2E、lighthouse 與 visual test 改用仍公開的文章。git 歷史先接受，見 issue #1111。
- **BREAKING**：`/api/posts/{slug}.json` 對下架文章只回墓碑 metadata、`body` 為空；GP 暫停收新文。

## Capabilities

### New Capabilities

- `post-takedown`：已發布文章的下架契約，涵蓋 `taken-down` 狀態與 frontmatter、墓碑頁內容與 `noindex`、三種輸出的墓碑內容、從列表與機器輸出移除、CI 棘輪、Tribunal 與自動化的處理、下架批次的規則與授權紀錄，以及 repo HEAD 不留譯文與未授權的第三方原文全文。

### Modified Capabilities

- `editorial-charter`：新增「GP 整篇翻譯要先取得來源作者同意」與 GP 暫停收新文；GP-1 自寫示範文不是翻譯，不受影響。
- `post-markdown-representation`：下架文章的 `.md` 是墓碑 Markdown（一律成功產生）；status marker 加入 `taken-down`。
- `publish-bar-visibility`：沒有分數的下架文章不適用 grandfather 規則。
- `brand-taxonomy`：舊品牌 GP 列表分頁轉到 GP 系列頁；GP 系列頁在暫停期間顯示改版空狀態。
- `extended-post-frontmatter`：跨欄位不變量加入 `taken-down` 與 `takenDownAt`、`sourceTitle` 的關係。
- `article-editorial-presentation`：technical provenance 維持可用的要求不適用墓碑頁。
- `gp-source-preservation`：GP-273 的真實稿件 regression pair 改成自寫合成稿。
- `tribunal-verification-scope`：Tribunal 依 status 排除下架文章，明寫這不是驗證例外。
- `dedup-eval-harness`：允許因授權下架把 fixture 的內容快照換成保留判斷關係的合成文字。
- `dedup-policy`：primary 文章因授權下架而變成 `taken-down`，屬於 dedup 以外的外部理由。

## Impact

- 內容：`src/content/posts/` 下 547 個檔案改成墓碑；刪除只被這些文章使用的 `src/assets/posts/**` 圖檔。
- Schema 與狀態：`src/content.config.ts`、`src/utils/post-status.ts`、`scripts/validate-posts.mjs`、新的墓碑文案模組與 GP 暫停旗標。
- 頁面與元件：繁中／英文文章路由、新的墓碑元件與素材、`BaseLayout`（robots）、GP 系列頁與首頁、glossary、`astro.config.mjs`（sitemap filter）。
- 匯出：`scripts/lib/post-markdown-exporter.mjs`（墓碑 Markdown）、`scripts/verify-canonical-public-output.mjs`（下架洩漏檢查）；JSON API 路由不用改（正文為空、摘要已中性化）。
- 轉址：`vercel.mjs` 的舊 GP 列表分頁規則；平台路由數不變。
- Gates 與自動化：新的 `scripts/check-takedown-ratchet.mjs`（pre-commit 與 CI）、內容 gates、Tribunal 候選選取、`scripts/dedup-gate.mjs`、部署 smoke 與 `scripts/verify-brand-redirects.mjs`。
- 測試：28 個以 GP 文章當測試頁的 Playwright spec、`lighthouserc.cjs`、`scripts/visual-test.mjs` 換頁；新增下架相關單元與 E2E 測試。
- Repo 副本：`sources/`、`tools/gp-pipeline/**/testdata/`、`tribunal/fixtures/`、`public/prompts/`、`scripts/ui-ux-auditor-prompt.md`、`.agents/skills/shroomdog-url-fetch/SKILL.md`。
- 品牌遷移掃描：`brand-taxonomy` delta 照抄既有要求，在 `quality/brand-taxonomy-residual-allowlist.json` 登記 active-change exact exceptions，archive 前移除。
- 營運（交給 owner）：遠端舊分支 HEAD 上的全文、舊 Vercel deployment 網址的保護設定、VM 更新（延到導讀新格式上線後）。
