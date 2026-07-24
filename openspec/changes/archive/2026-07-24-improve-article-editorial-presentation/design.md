# Design: 文章 editorial presentation

## Context

目前 `src/pages/posts/[...slug].astro` render 的文章模板包含：

- lines 84–105：title 與 metadata
- lines 146–154：content 前的 source citation
- line 157：content 前的 TOC
- lines 159–161：article body
- lines 163–271：tags / translation info / AI score / read / share / login / related / prev-next / comments / version / footer

目前 `src/styles/global.css` 的 global typography 是全站共用：lines 35–37 的 `--font-sans`、lines 106–128 的 global `h1/h2/h3`、lines 130–160 的 global paragraph spacing、lines 264–282 的 blockquote styles，以及 lines 336–349 的 source citation。`[...slug].astro` 內 post-specific style 很薄：lines 370–372 的 `.post-content` margin，以及 lines 374–377 的 `.post-content blockquote`。

比較 benchmark 是 Kevin Ma 的 Fable article，於 1440px desktop 量測：

- Kevin Ma: `h1 38.4px / 51.84px`, `h2 24.8px / 35.96px`, `p 14.72px / 26.496px`, article width `696px`.
- gu-log: `article h1 32px / 41.6px`, `.post-content h2 24px / 31.2px`, `.post-content p 16px / 28.8px`, article width `648px`.

修正後的資料顯示，gu-log 的問題不是單純「body text too small」。真正問題是整體 hierarchy：sans H1 的 presence 偏小、H2 line-height 比 benchmark 緊、TOC/source/status surfaces 讀起來像 tool cards，以及底部 utility modules 會跟文章收尾搶注意力。

## Goals

- 給 post pages 一套 scoped editorial typography system，但不改 index/tool UI typography。
- 讓首屏先像文章，再像 content-management dashboard。
- 保留 gu-log 有用的 affordances：source citation、TOC、Tribunal scores、read state、sharing、login、related articles、comments、version history。
- 收合或降低 technical metadata 的 visual weight，讓它仍可檢查，但不主導閱讀體驗。
- 要求在 dark/light 與 desktop/mobile 都做 visual verification。

## Non-goals

- 不新增 GP-251 explanatory images；那是 PR1 的範圍。
- 不設計或實作 interactive artifact；那由另一個 worker 負責。
- 不移除 reader tools 或 Tribunal transparency。
- 不強迫所有 posts 套成 Kevin Ma 的品牌或 visual language。

## Decisions

### D1: 建立 scoped article presentation layer

在 `.post` 或 `.post-content` 底下新增 article-specific CSS variables / selectors，而不是全域修改 `h1`、`h2` 和 `p`。Global styles 目前同時服務 site navigation、cards、list pages 和 tools；article-only layer 可以避免 app 其他地方意外變得像雜誌。

預期 implementation anchors：

- `src/styles/global.css`：放 reusable tokens 與 shared prose primitives。
- `src/pages/posts/[...slug].astro`：放 page-specific structure 與 scoped styles。

### D2: Typography 目標是 hierarchy 與 rhythm，不是放大 body-size

修正後的量測顯示，gu-log `.post-content p` 已經是 `16px / 28.8px`，比 Kevin Ma 量到的 paragraph text（`14.72px / 26.496px`）更大。Implementation 不應盲目放大 paragraphs，而應該調整：

- H1 presence，desktop 目標約 `~2.35rem` / mobile 約 `~1.9rem`。
- H2 line-height 與 spacing，讓 section breaks 有呼吸感。
- Paragraph max-width、paragraph margin、list spacing、quote spacing，以及 code / prompt example separation。
- MoguNote / ShroomDogNote weight，讓 commentary 支援正文，而不是變得一樣搶戲。**附帶條款（user 拍板）**：降音量（縮字級）時 line-height SHALL 跟著收緊——user 實測回饋：小字配 1.8 行距太鬆散；收緊後的實際行高值實作時實測定案。

**拍板（原 Open Q1）：heading 走 sans-first，不引入 serif。** user 品牌判斷（原話）：「書法招牌掛在賽博蘑菇店面上不搭」；技術理由：CJK webfont 上萬字符的 subset 成本。`--font-serif` token 留給未來獨立實驗，不進本 change。

### D3: First-screen hierarchy 要把工具退到 article lead 後面

Post header 應優先呈現 title、必要 date/category/ticket metadata，以及文章開頭。Source citation 和 TOC 仍然重要，但不應在 reader 抵達 lead 前，以同等重量的 cards 形式出現。

Source citation 位置評估過的選項：

1. 改成更輕的 inline source row。
2. 移到 dek / lead 後面。
3. source-based posts 延後到接近結尾。
4. ~~標題下輕量「小卡」~~（preview 後撤回）：第一版使用圓角底色與粉紅側邊條；user 在 iPhone preview 指出它和下方導航重複同一套生成式 UI 語法。

**Preview 修正後拍板：選項 1，改成安靜的 inline provenance row。** 保留 clean SVG、完整來源名稱、底線 link、44px touch target 與 link semantics，但移除卡片底色、圓角外框和 accent side-tab。這不是未設計的裸文字，而是用 typography、spacing、icon 和 underline 建立單一用途的來源列。

無論如何呈現，source attribution 都 SHALL 維持 visible 且 accessible。

### D4: TOC 保持有用，但視覺上更安靜

`TableOfContents.astro` desktop 目前會 render fixed `.toc-sidebar`，在 lines 347–352 使用 `background: var(--color-surface)`、border、padding 和 card radius。這對 navigation 有用，但它的 surface grammar 跟 source cards 和 notes 太像。Implementation 應讓 desktop TOC 感覺像 navigation chrome：更安靜的 background、hairline marker、較低 contrast，或只在 roomy breakpoints 顯示。Mobile TOC 可以維持 collapsible，但不應吃掉不成比例的首屏高度。

**拍板（user 同意）**：desktop 走細線導航——hairline rail＋active 亮橘標記、去掉卡片底色；mobile 照上述 spec（可發現、不佔首屏）。

**Preview 修正：mobile 不沿用 desktop accent rail。** iPhone preview 上，來源 side-tab、mobile TOC rail 和底部導航 side-tab 疊在同一條閱讀軸上，形成不必要的彩色直線節奏。Mobile TOC 不畫穿過 disclosure header 的 rail，也不畫 active pseudo-element。User 第二輪 preview 覺得展開內容完全無線時缺少 grouping；因此展開後只在 entries 旁顯示 `1px` 中性 `--color-toc-rail` rule，與文字保留 `12px` gap，收合時完全隱藏。這條線是內容編組，不是 ticket-colored side-tab：不使用 accent 色、不穿過標題、不搭配卡片底色或圓角。Desktop rail 仍保留，因為它在寬螢幕是獨立的 navigation chrome，不會和正文前後的 cards 串成同一種圖樣。

### D5: Technical metadata 改成 disclosed section

Translation pipeline、AI score 和 version history 是有價值的 provenance。它們應被 group 成 technical metadata section，預設為 low visual weight 或 collapsed disclosure。Content 必須維持足夠 crawlable / accessible，讓在意的使用者可以檢查；但預設 reading flow 應該先用 article、tags/source context 收尾，再進 optional tools。

**拍板（原 Open Q3）：全部進抽屜。** 翻譯 pipeline＋Tribunal 計分板＋版本歷史收進單一「技術資訊」collapsible，用原生 `<details>/<summary>`（即達標鍵盤可及性），summary 列秀總分當鉤子（例：`Tribunal 8/10 ・ 翻譯 pipeline ・ v1`）。

預期 implementation anchors：

- `src/pages/posts/[...slug].astro` lines 178–217：translation info 與 AI score placement。
- `src/components/AiJudgeScore.astro`：default panel density。
- `src/pages/posts/[...slug].astro` lines 257–267：version history。

### D6: Reader actions 是 commands，不是 article content

Read status、share、login、related articles、prev/next 和 comments 應整理成有清楚 hierarchy 的 bottom interaction zone。它們不應像一疊互不相干的 stacked cards。Version history 屬於 D5 的 technical metadata group，不屬於 reader-action group。Design 可以把 read/share/login group 成一個 action row，把 related/prev-next 留作 onward navigation，comments 則作為獨立 participation section。

**Preview 修正：onward navigation 採 editorial list，不採 side-tab cards。** Related、series prev/next 與 chronological prev/next 使用中性色 divider、文字層級和留白分組；不使用 surface-filled rounded cards、ticket-colored left borders 或位移 hover。Ticket type 可保留為小型文字 metadata，但不得靠粗彩色側邊條區分。

## Implementation 原則（user 拍板）

- **卡片只留給真正有 container 語意的互動。** Source provenance 與 onward navigation 不需要各自成為浮起的容器；用排版、divider、完整 touch target 和 focus state 表達結構。避免把每段 secondary information 都做成「圓角底色＋彩色側邊條」。
- **UI chrome 一律 clean SVG line icons、不用 emoji**（📄🔧 都算 cheap）——對齊現有 nav 的 search/globe/moon 線條 icon 風格；source provenance row 與技術資訊抽屜的 icon 需要設計。

## Risks / Trade-offs

- **Risk: provenance 被藏得太深。** gu-log 有意公開 AI 與 pipeline metadata。Mitigation：collapse 或降低 weight，但不要刪除；確保 keyboard 與 screen-reader access。
- **Risk: serif heading 影響 CJK rendering 或 performance。** 已由 D2 拍板 sans-first 消除——本 change 不引入 serif；若未來獨立實驗 `--font-serif` 再重新評估。
- **Risk: TOC 對長文變得太安靜。** Mitigation：保留 active section marker，並在 desktop 和 mobile 驗證 long-post usability。
- **Risk: implementation 變成重設計每個 component。** Mitigation：scope 限在 article page presentation；不要改 reader sync、share provider logic 或 scoring semantics。

## Validation Plan

- 使用 Playwright 或等效 browser script 重新跑 scoped DOM measurement。
- 為 dark Dracula 與 light Solarized 擷取 desktop 1440 和 mobile 390 screenshots。
- 確認 `.post-content h2` 是用 scoped selector 量測，不是 TOC `h2`。
- 跑 touched files 相關的 repo checks：format/check、build，以及可用時的 targeted Playwright 或 visual checks。
- Manual visual review 必須確認：
  - 首屏讀起來 article-first；
  - post body 有穩定的 H1/H2/p/blockquote rhythm；
  - TOC 有用，但 weight 低於 title/body；
  - bottom tools 已 group/disclose，讀起來不像 dashboard wall。
