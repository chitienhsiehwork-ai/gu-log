# Tasks

## 1. OpenSpec

- [x] 1.1 Add `article-editorial-presentation` capability spec delta.
- [x] 1.2 Record corrected scoped measurements and explicitly supersede the stale report numbers.
- [ ] 1.3 Validate with `openspec validate improve-article-editorial-presentation --strict` when the OpenSpec CLI is available.

## 2. Article typography and prose rhythm

- [ ] 2.1 Add post-specific prose tokens/selectors in `src/styles/global.css` and/or scoped post styles.
- [ ] 2.2 Tune `.post-header h1` scale, line-height, margin, and optional article-only serif heading token.
- [ ] 2.3 Tune `.post-content h2`, `h3`, paragraph, list, blockquote, ClawdNote / MoguNote, and code / prompt-example spacing.
- [ ] 2.4 Verify the implementation measures `.post-content h2` and `.post-content p`, not unscoped TOC/source selectors.

## 3. First-screen and metadata hierarchy

- [ ] 3.1 Rework `src/pages/posts/[...slug].astro` header/meta/source/TOC ordering so the first screen is article-first.
- [ ] 3.2 Keep ticket/date/category/source attribution available without rendering all of them as equally heavy cards.
- [ ] 3.3 Reduce desktop TOC card weight in `src/components/TableOfContents.astro`; keep active section affordance.
- [ ] 3.4 Keep mobile TOC discoverable but compact.

## 4. Bottom tool module consolidation

- [ ] 4.1 Group translation pipeline, AI score, and version history into a low-weight or collapsible technical metadata section.
- [ ] 4.2 Reorganize read status, share, and login CTA into a coherent action area.
- [ ] 4.3 Keep related articles / series nav / prev-next as onward navigation after the article close.
- [ ] 4.4 Keep Giscus comments available as a participation section, visually separate from provenance metadata.

## 5. Verification

- [ ] 5.1 Run formatting and build checks for touched Astro/CSS files.
- [ ] 5.2 Capture dark/light desktop screenshots at 1440px.
- [ ] 5.3 Capture dark/light mobile screenshots at 390px.
- [ ] 5.4 Compare selector metrics before/after and include corrected `.post-content` numbers in PR notes.
- [ ] 5.5 Confirm no PR1 image work or artifact work is included in this implementation.
