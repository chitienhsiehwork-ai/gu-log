# Proposal: 改善文章 editorial presentation

## 背景

GP-251 的 UI/UX 差距分析把 gu-log 文章頁和 Kevin Ma 的 Fable 文章頁放在一起看，結論不是「少一個漂亮 hero」而是文章頁的 editorial presentation 還太像工具頁：首屏先露出行政資訊與工具模組，正文節奏和標題層級不夠像長文版面，正文結束後又接上一串 dashboard 式功能區。

本 change 覆蓋分析報告建議的 PR2–PR4：

- PR2：article typography + prose spacing
- PR3：首屏與 metadata hierarchy
- PR4：底部工具模組收斂

不覆蓋 PR1 文章插圖，也不覆蓋互動 artifact；那兩條已有其他 worker 處理。本 change 只定義文章頁模板與 presentation contract，讓後續 implementation 有一份可審的 spec，而不是靠截圖心得各自發揮。

## 修正後的量測紀錄

本 proposal 不照抄原分析報告的兩個錯誤數字，已用 scoped Playwright measurement 重新量測 live pages。

- Kevin Ma 的 `p` 是 `14.72px / 26.496px`，不是拿 `body 17px / 34px` 直接對 gu-log 段落。真正差距是文章整體節奏：Kevin Ma 的 article line-height 是 `32px`，段落視覺更鬆，H1 是 `38.4px / 51.84px` serif。
- gu-log 的 `.post-content p` 是 `16px / 28.8px`，不是舊報告列的 `14.4px / 23.04px`；舊值來自 unscoped `p`，量到 source / meta 區的段落。
- gu-log 的 `.post-content h2` 是 `24px / 31.2px`，寬 `648px`；舊報告的 `h2 15.2px / 19.76px`、寬 `206px` 是 TOC heading，不是文章 H2。

因此本 change 不要求單純放大 body text，而是要求建立 post-specific editorial scale、改善 H1/H2/blockquote/source/TOC 的 hierarchy，以及整理正文前後的功能重量。

## 變更內容

新增 `article-editorial-presentation` capability，定義 gu-log 文章頁應該如何在保留現有功能的前提下更像 editorial article：

- 文章頁 SHALL 有 post-specific typography layer，不能只靠全站 `h1/h2/p` token。
- `.post-content` SHALL 是正文節奏的主錨點；H2、段落、blockquote / MoguNote、code / prompt examples 要有可掃描的層級。
- 首屏 SHALL 先服務文章：title、必要 meta、summary / dek（若有）、content lead；source citation、TOC、status / scoring banners 要降低行政感。
- Desktop TOC SHALL 保留長文導航價值，但 visual weight 要低於正文和 title。
- 文章結尾 SHALL 先完成 editorial close，再進工具 metadata；AI score、pipeline attribution、version history 這類 technical metadata 應收斂成低權重或 collapsible 區域。
- Reading / sharing / login / related / comments 等互動功能 SHALL 保留，但不得在正文結尾形成連續 dashboard。

## Non-goals

- 不新增或修改 GP-251 文章插圖、`PostImage`、圖片 assets。
- 不設計互動 artifact 或 artifact callout。
- 不改 Tribunal scoring 語意、reader sync API、登入流程、Giscus provider、sharing provider。
- 不把全站 typography 全面切成 serif；若引入 serif，只限定 article heading / editorial accent。
- 不要求 Kevin Ma 視覺 1:1 clone；Kevin Ma 是參考 benchmark，不是品牌替換。

## Capabilities

### New Capabilities

- `article-editorial-presentation`：文章頁的 typography、首屏 hierarchy、TOC visual weight、底部工具模組收斂與驗證要求。

### Modified Capabilities

- 無。`zoomable-post-images` 仍只管文章圖片能力；本 change 不碰它。

## 影響範圍

Implementation 預期會碰以下檔案，實際 patch 可在 apply 階段收斂：

- `src/styles/global.css`：全站 typography token、blockquote、source citation、code / pre、post-specific prose variables。
- `src/layouts/BaseLayout.astro`：若需載入 article heading serif font，應在這裡用 scoped / low-blast-radius 方式處理。
- `src/pages/posts/[...slug].astro`：post header、source citation、TOC、`.post-content`、tags、translation info、AI score、read/share/login/related/comments/version/footer 的 ordering 與 wrappers。
- `src/components/TableOfContents.astro`：desktop sidebar surface weight、mobile TOC compactness。
- `src/components/AiJudgeScore.astro`：AI score 在文章結尾的 default collapsed / metadata treatment。
- `src/components/ReadStatusButton.astro`、`src/components/ShareButton.astro`、`src/components/LoginCta.astro`、`src/components/RelatedArticles.astro`、`src/components/PrevNextNav.astro`、`src/components/Giscus.astro`：底部工具區資訊架構與 spacing。

## 核准此變更的意思

核准這個 change 代表 gu-log 應該先把文章頁視為 editorial reading surface，其次才是工具 dashboard。Implementation 應保留既有 reader tools，但重新整理它們的 visual weight、順序與 disclosure，讓它們支援文章，而不是接管整個頁面。
