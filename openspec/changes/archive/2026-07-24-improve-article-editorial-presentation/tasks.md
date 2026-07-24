# Tasks

## 1. OpenSpec

- [x] 1.1 新增 `article-editorial-presentation` capability spec delta。
- [x] 1.2 記錄修正後的 scoped measurements，並明確取代舊報告中的 stale numbers。
- [x] 1.3 OpenSpec CLI 可用時，用 `openspec validate improve-article-editorial-presentation --strict` 驗證。

## 2. Article typography 與 prose rhythm

- [x] 2.1 在 `src/styles/global.css` 和/或 scoped post styles 新增 post-specific prose tokens/selectors。
- [x] 2.2 調整 `.post-header h1` scale、line-height、margin（sans-first，不引入 serif heading token——見 design.md D2 拍板）。
- [x] 2.3 調整 `.post-content h2`、`h3`、paragraph、list、blockquote、MoguNote / ShroomDogNote，以及 code / prompt-example spacing。
- [x] 2.4 驗證 implementation 量測的是 `.post-content h2` 和 `.post-content p`，不是 unscoped TOC/source selectors。
- [x] 2.5 MoguNote / ShroomDogNote 降音量時同步收緊 line-height，實際行高值以實測定案（user 實測回饋：小字配 1.8 行距太鬆散）。

## 3. First-screen 與 metadata hierarchy

- [x] 3.1 重整 `src/pages/posts/[...slug].astro` 的 header/meta/source/TOC ordering，讓首屏 article-first。
- [x] 3.2 保留 ticket/date/category/source attribution 可取得，但不要把它們全部 render 成同等重量的 cards；source citation 依 design.md D3 的 preview 修正做成 inline provenance row，保留 icon、underline 與完整 touch target。
- [x] 3.3 降低 `src/components/TableOfContents.astro` 的 desktop TOC card weight（hairline rail＋active 亮橘標記、去底色）；保留 active section affordance。
- [x] 3.4 保持 mobile TOC 可 discover，但維持 compact。
- [x] 3.5 「精修中」橫幅改成一行輕量狀態列，具體樣式實作時定案（教材模擬器只驗過概念，未定樣式細節）。

## 4. Bottom tool module consolidation

- [x] 4.1 將 translation pipeline、AI score 和 version history 收進單一「技術資訊」collapsible（原生 `<details>/<summary>`），summary 列秀總分當鉤子（例：`Tribunal 8/10 ・ 翻譯 pipeline ・ v1`）。
- [x] 4.2 將 read status、share 和 login CTA 重整成 coherent action area。
- [x] 4.3 將 related articles / series nav / prev-next 保留為 article close 之後的 onward navigation。
- [x] 4.4 保留 Giscus comments 作為 participation section，並在視覺上和 provenance metadata 分開。

## 5. Verification

- [x] 5.1 對 touched Astro/CSS files 跑 formatting 和 build checks。
- [x] 5.2 擷取 dark/light desktop 1440px screenshots。
- [x] 5.3 擷取 dark/light mobile 390px screenshots。
- [x] 5.4 比較 selector metrics before/after，並在 PR notes 納入修正後的 `.post-content` numbers。
- [x] 5.5 確認 implementation 不包含 PR1 image work 或 artifact work。
- [x] 5.6 驗證細線 TOC 在 Dracula 深色主題的對比度符合 WCAG AA。
- [x] 5.7 拿一篇缺 optional 模組（無分數／無相關文章／無版本）的文章驗 footer 間距：不留空盤、不重複分隔線。
- [x] 5.8 跑 `uiux-auditor` skill（repo 規定：改視覺必跑；複驗 PASS 9/10，零 blocker）。

## 6. Mobile preview revision

- [x] 6.1 依 user 的 iPhone preview 回饋，將 source citation 從 side-tab card 改為 inline provenance row。
- [x] 6.2 移除 mobile TOC 的 vertical rail 與 active-link side-tab；保留 compact disclosure、44px touch target 和 active state。
- [x] 6.3 將 related、series 與 chronological onward navigation 從彩色側邊卡片收斂成中性 editorial list/divider。
- [x] 6.4 新增 regression assertions，防止 mobile article chrome 回復成 repeated rounded surface cards + colored side borders。
- [x] 6.5 重跑 OpenSpec strict validation、targeted tests、dark/light mobile screenshots 與 fresh-eyes `uiux-auditor`（PASS 9/10，零 blocker）。

## 7. Mobile TOC grouping-rule iteration

- [x] 7.1 依 user 第二輪 iPhone preview 回饋，更新 spec/design：允許展開 entries 使用中性 grouping rule，但禁止 collapsed stub、accent rail 與 active side-tab。
- [x] 7.2 在 `TableOfContents.astro` 實作只於 mobile expanded state 顯示的 `1px` neutral rule；線不得穿過 disclosure header。
- [x] 7.3 新增 regression assertions，驗證 collapsed/open border state、neutral token、透明背景與無圓角。
- [x] 7.4 重跑 OpenSpec strict validation、targeted tests、dark/light mobile screenshots 與 fresh-eyes designer audit（PASS 10/10，零 finding）。
