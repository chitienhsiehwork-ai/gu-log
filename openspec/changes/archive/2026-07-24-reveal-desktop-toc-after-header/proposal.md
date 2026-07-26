## Why

Desktop 文章頁目前在首屏就固定顯示完整目錄，並預先把第一節標成 active；文章正文尚未進入段落導覽階段，右欄卻已像一塊持續運作的控制面板，削弱 title、來源與 lead 的閱讀層級。目錄應在讀者離開文章 header、真正開始往下閱讀後才出現。

## What Changes

- Desktop 首屏先隱藏 fixed TOC，保留完整文章寬度與視覺焦點。
- 當文章 header 滑出既定 top offset 後，desktop TOC 才淡入並啟用互動。
- 回到文章頂端時收起 desktop TOC；hash 深連結或在文章中段重新整理時依目前 scroll position 正確顯示。
- 保留既有 active-section tracking、smooth scroll、desktop rail 與 mobile disclosure 行為。
- 尊重 `prefers-reduced-motion`，不強迫 reveal transition。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `article-editorial-presentation`：補強 desktop TOC 的 progressive reveal 契約，讓首屏以文章為主，進入正文後才顯示段落導覽。

## Impact

- `src/components/TableOfContents.astro`
- `tests/toc.spec.ts`
- `openspec/specs/article-editorial-presentation/spec.md`（archive sync 時更新）
- 不改文章內容、mobile TOC、routing、資料模型或外部 dependency。
