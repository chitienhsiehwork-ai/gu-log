# Proposal

## Why

gu-log 的 GP 系列（繁中 271 篇、英文 sidecar 270 篇）是沒有取得原作者同意的整篇翻譯；整篇翻譯屬於改作，需要作者同意。另有少數 MP 直接取材自付費新聞媒體。ShroomDog 已決定下架這些文章，但網站目前沒有真正的「下架」：`status: retired／deprecated` 只是貼標籤，全文照樣出現在文章頁、`/api/posts/*.json`（整份 MDX 原文）、`.md` 匯出、sitemap 與公開 repo 的 HEAD。要在推廣前一次關掉這些出口，同時保留網址，讓外部舊連結看到清楚的交代（墓碑頁），而不是 404。

授權來源：ShroomDog 於 2026-09-26 在 chat 做出下架決定，並於 2026-09-27 在 chat 授權「下架清單不用給我看，直接 e2e 做完」。因此本 change 的下架批次依規則產生清單、由 controller 對帳，不設逐篇確認的 owner gate。

## What Changes

- 新增文章狀態 `status: taken-down`（下架）。下架文章的 frontmatter 只保留墓碑頁需要的欄位，正文清空；繁中與英文 sidecar 一起下架。既有的 `deprecated`／`retired` 維持「仍公開全文的標籤」，不再被誤當成下架。
- 新增墓碑頁：下架文章的原網址改顯示定稿的墓碑設計（石碑、Mogu、「Mogu 內心小劇場：」、「去讀原文 →」卡片），碑上不放文章標題；另有視覺隱藏的 h1。英文 sidecar 使用 controller 定案的英文文案。
- 下架文章的網址回 HTTP 410。做法是沿用既有的 Vercel Routing Middleware，不新增逐篇轉址，平台路由數維持約 1,082／2,048。
- 從所有出口移除下架文章：首頁與系列列表、tags、閱讀紀錄、glossary 的文章連結、相關文章與上下篇導覽、RSS、JSON feed、三份搜尋索引、sitemap、`/api/posts/*.json`、`.md` 匯出與內容協商；墓碑頁不輸出 `.md` alternate、版本資訊與 GitHub 修改歷史連結、留言、AI popup。
- 調整既有「HTML／JSON／`.md` slug 集合一致」的建置不變式：未下架文章在三種輸出都存在；下架文章只以帶 marker 的 HTML 墓碑存在，JSON 與 `.md` 都不存在；任何不一致都讓 build 失敗。另加上 postbuild 洩漏檢查。
- 下架不是改寫：墓碑不需要 Tribunal 分數，內容 gates 與 Tribunal 候選、dedup／交叉連結等語料工具都跳過下架文章。
- 執行一批下架（清單：`takedown-list.json`）：全部 GP（繁中 271、英文 270），以及 `sourceUrl` 明確來自付費新聞媒體網域的 MP 4 篇（繁中 4、英文 4），共 549 個檔案。判斷不確定的 39 篇 MP 邊界案例本次不下架，留給之後的 MP 防翻譯檢查。
- 清掉公開 repo HEAD 上的副本：下架文章的正文、`sources/` 裡的第三方原文擷取（保留 ShroomDog 自己的 `sources/chatgpt/`）、gp-pipeline 測試資料裡的原文與譯文、只被下架文章使用的圖檔；並把「第三方原文不存進 repo」寫進擷取 skill。git 歷史先接受，改寫歷史另見 issue #1111。
- **BREAKING**：`/api/posts/{slug}.json` 不再提供下架文章（iOS app 等 consumer 會拿到 404）；舊 SP 網址的 308 轉址終點從 200 變成 410。
- **BREAKING（待 owner 確認）**：GP 暫停收新文。在後續 change 定義「作者同意」的紀錄方式之前，任何非下架狀態的 GP（含 `GP-PENDING`）都會被驗證擋下。

## Capabilities

### New Capabilities

- `post-takedown`：已發布文章的下架契約，涵蓋 `taken-down` 狀態與 frontmatter 範圍、HTTP 410 墓碑頁的內容與無障礙要求、從所有公開輸出移除、建置與洩漏檢查、內容 gates／Tribunal 的例外、下架批次的規則與授權紀錄，以及 repo HEAD 不留譯文與第三方原文副本。

### Modified Capabilities

- `editorial-charter`：新增「GP 整篇翻譯要先取得來源作者同意才可公開」；在同意紀錄格式定義前，GP 不得有公開文章。
- `post-markdown-representation`：Markdown 表示、`.md` alternate、內容協商與 status marker 只適用未下架文章；slug 集合不變式改成「未下架三種輸出一致、下架只剩 HTML 墓碑」。
- `publish-bar-visibility`：沒有分數的下架文章不適用 grandfather 規則，不會留在首頁。
- `brand-taxonomy`：舊文章網址的 308 轉址終點若已下架，追到的是 410 墓碑，而不是 200。
- `extended-post-frontmatter`：必填欄位要求只適用未下架文章。
- `article-editorial-presentation`：technical provenance（含 version history）維持可用的要求不適用墓碑頁。

## Impact

- 內容：`src/content/posts/` 下 549 個檔案改成墓碑 frontmatter；刪除只被這些文章使用的 `src/assets/posts/**` 圖檔。
- Schema 與狀態：`src/content.config.ts`、`src/utils/post-status.ts`、`scripts/validate-posts.mjs`。
- 頁面與元件：繁中／英文文章路由、新的墓碑元件與素材、`BaseLayout`、列表頁、tags、glossary、閱讀紀錄、`astro.config.mjs`（sitemap filter）、`src/pages/api/posts/[slug].json.ts`。
- 路由：`middleware.ts`（410）；`vercel.mjs` 的平台路由數不變。
- 建置與驗證：新的下架清單產生器與 freshness gate、`scripts/build-post-markdown.mjs`、`scripts/verify-canonical-public-output.mjs`、部署 smoke（`.github/workflows/deploy-smoke-test.yml`、`scripts/verify-post-markdown-deployment.mjs`、新的下架部署驗證）。
- Gates 與自動化：pre-commit／CI 內容 gates、`scripts/list-content-gate-posts.mjs`、Tribunal 候選選取與 publisher、dedup／交叉連結工具、gp-pipeline 的 GP lane（若 GP 暫停收新文成立）。
- 測試：28 個以 GP 文章當測試頁的 Playwright spec（另有少數 vitest、Go 與 shell 測試）要換成仍公開的文章；新增下架相關單元與 E2E 測試。
- Repo 副本：`sources/`、`tools/gp-pipeline/**/testdata/`、`.agents/skills/shroomdog-url-fetch/SKILL.md`。
- 品牌遷移掃描：`brand-taxonomy` delta 照抄既有要求，會帶到舊品牌字樣，所以在 `quality/brand-taxonomy-residual-allowlist.json` 登記 active-change exact exceptions，archive 時移除。
- 營運：Tribunal VM worker 要在 merge 後同步才會跳過墓碑；舊 Vercel deployment URL、搜尋引擎快取、iOS app 快取與 git 歷史不在 repo 能控制的範圍（見 design）。
