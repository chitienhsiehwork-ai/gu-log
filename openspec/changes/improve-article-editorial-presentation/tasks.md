# Tasks

## 1. OpenSpec

- [x] 1.1 新增 `article-editorial-presentation` capability spec delta。
- [x] 1.2 記錄修正後的 scoped measurements，並明確取代舊報告中的 stale numbers。
- [ ] 1.3 OpenSpec CLI 可用時，用 `openspec validate improve-article-editorial-presentation --strict` 驗證。

## 2. Article typography 與 prose rhythm

- [ ] 2.1 在 `src/styles/global.css` 和/或 scoped post styles 新增 post-specific prose tokens/selectors。
- [ ] 2.2 調整 `.post-header h1` scale、line-height、margin，以及 optional article-only serif heading token。
- [ ] 2.3 調整 `.post-content h2`、`h3`、paragraph、list、blockquote、ClawdNote / MoguNote，以及 code / prompt-example spacing。
- [ ] 2.4 驗證 implementation 量測的是 `.post-content h2` 和 `.post-content p`，不是 unscoped TOC/source selectors。

## 3. First-screen 與 metadata hierarchy

- [ ] 3.1 重整 `src/pages/posts/[...slug].astro` 的 header/meta/source/TOC ordering，讓首屏 article-first。
- [ ] 3.2 保留 ticket/date/category/source attribution 可取得，但不要把它們全部 render 成同等重量的 cards。
- [ ] 3.3 降低 `src/components/TableOfContents.astro` 的 desktop TOC card weight；保留 active section affordance。
- [ ] 3.4 保持 mobile TOC 可 discover，但維持 compact。

## 4. Bottom tool module consolidation

- [ ] 4.1 將 translation pipeline、AI score 和 version history group 成 low-weight 或 collapsible technical metadata section。
- [ ] 4.2 將 read status、share 和 login CTA 重整成 coherent action area。
- [ ] 4.3 將 related articles / series nav / prev-next 保留為 article close 之後的 onward navigation。
- [ ] 4.4 保留 Giscus comments 作為 participation section，並在視覺上和 provenance metadata 分開。

## 5. Verification

- [ ] 5.1 對 touched Astro/CSS files 跑 formatting 和 build checks。
- [ ] 5.2 擷取 dark/light desktop 1440px screenshots。
- [ ] 5.3 擷取 dark/light mobile 390px screenshots。
- [ ] 5.4 比較 selector metrics before/after，並在 PR notes 納入修正後的 `.post-content` numbers。
- [ ] 5.5 確認 implementation 不包含 PR1 image work 或 artifact work。
