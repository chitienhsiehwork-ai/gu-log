# Design: Article editorial presentation

## Context

Current `src/pages/posts/[...slug].astro` renders one article template that includes:

- title and metadata at lines 84–105
- source citation before content at lines 146–154
- TOC before content at line 157
- article body at lines 159–161
- tags / translation info / AI score / read / share / login / related / prev-next / comments / version / footer at lines 163–271

The current global typography in `src/styles/global.css` is site-wide: `--font-sans` at lines 35–37, global `h1/h2/h3` at lines 106–128, global paragraph spacing at lines 130–160, blockquote styles at lines 264–282, and source citation at lines 336–349. Post-specific style in `[...slug].astro` is thin: `.post-content` margin at lines 370–372 and `.post-content blockquote` at lines 374–377.

The comparison benchmark is Kevin Ma's Fable article, measured on 1440px desktop:

- Kevin Ma: `h1 38.4px / 51.84px`, `h2 24.8px / 35.96px`, `p 14.72px / 26.496px`, article width `696px`.
- gu-log: `article h1 32px / 41.6px`, `.post-content h2 24px / 31.2px`, `.post-content p 16px / 28.8px`, article width `648px`.

The corrected data says gu-log's problem is not "body text too small" in isolation. It is the combined hierarchy: sans H1 with smaller presence, H2 line-height tighter than benchmark, TOC/source/status surfaces reading like tool cards, and bottom utility modules competing with the article close.

## Goals

- Give post pages a scoped editorial typography system without changing index/tool UI typography.
- Make the first screen feel like an article before it feels like a content-management dashboard.
- Preserve useful gu-log affordances: source citation, TOC, Tribunal scores, read state, sharing, login, related articles, comments, version history.
- Collapse or reduce technical metadata weight so it remains inspectable without dominating the reading experience.
- Require visual verification across dark/light and desktop/mobile.

## Non-goals

- Do not add SP-251 explanatory images; PR1 owns that.
- Do not design or implement the interactive artifact; another worker owns that.
- Do not remove reader tools or Tribunal transparency.
- Do not force all posts into Kevin Ma's brand or visual language.

## Decisions

### D1: Create a scoped article presentation layer

Add article-specific CSS variables / selectors under `.post` or `.post-content` instead of globally changing `h1`, `h2`, and `p`. Global styles currently serve site navigation, cards, list pages, and tools; an article-only layer avoids making the rest of the app look like a magazine by accident.

Expected implementation anchors:

- `src/styles/global.css` for reusable tokens and shared prose primitives.
- `src/pages/posts/[...slug].astro` for page-specific structure and scoped styles.

### D2: Typography target is hierarchy and rhythm, not body-size inflation

Corrected measurement shows gu-log `.post-content p` is already `16px / 28.8px`, larger than Kevin Ma's measured paragraph text (`14.72px / 26.496px`). The implementation should not blindly enlarge paragraphs. It should instead tune:

- H1 presence, likely `~2.35rem` desktop / `~1.9rem` mobile, optionally article-only serif.
- H2 line-height and spacing so section breaks breathe.
- Paragraph max-width, paragraph margin, list spacing, quote spacing, and code / prompt example separation.
- ClawdNote / MoguNote weight so commentary supports the body rather than becoming equally loud.

### D3: First-screen hierarchy moves tools behind the article lead

The post header should prioritize title, essential date/category/ticket metadata, and the beginning of the article. Source citation and TOC remain important, but they should not appear as equally heavy cards before the reader reaches the lead.

Implementation may move source citation after a dek / lead, restyle it as a lighter inline source row, or defer it near the end for source-based posts as long as source attribution remains visible and accessible.

### D4: TOC stays useful but becomes visually quieter

`TableOfContents.astro` desktop currently renders a fixed `.toc-sidebar` with `background: var(--color-surface)`, border, padding, and card radius at lines 347–352. That is useful for navigation, but it has the same surface grammar as source cards and notes. The implementation should make desktop TOC feel like navigation chrome: quieter background, hairline marker, lower contrast, or show only at roomy breakpoints. Mobile TOC may stay collapsible but should not consume disproportionate first-screen height.

### D5: Technical metadata becomes a disclosed section

Translation pipeline, AI score, and version history are valuable provenance. They should be grouped into a technical metadata section that defaults to low visual weight or collapsed disclosure. The content must remain crawlable / accessible enough for users who care, but the default reading flow should end with the article, tags/source context, then optional tools.

Expected implementation anchors:

- `src/pages/posts/[...slug].astro` lines 178–217 for translation info and AI score placement.
- `src/components/AiJudgeScore.astro` for default panel density.
- `src/pages/posts/[...slug].astro` lines 257–267 for version history.

### D6: Reader actions are commands, not article content

Read status, share, login, related articles, prev/next, and comments should be organized into a bottom interaction zone with clear hierarchy. They should not appear as unrelated stacked cards. Version history belongs to the technical metadata group from D5, not the reader-action group. The design may group read/share/login into one action row, leave related/prev-next as onward navigation, then comments as a separate participation section.

## Risks / Trade-offs

- **Risk: hiding provenance too much.** gu-log intentionally exposes AI and pipeline metadata. Mitigation: collapse or reduce weight, do not delete; ensure keyboard and screen-reader access.
- **Risk: serif heading hurts CJK rendering or performance.** Mitigation: article-only font token, measured fallback stack, and no body-wide font switch in first implementation.
- **Risk: TOC gets too quiet for long posts.** Mitigation: preserve active section marker and verify long-post usability on desktop and mobile.
- **Risk: implementation turns into a redesign of every component.** Mitigation: keep scope to article page presentation; do not alter reader sync, share provider logic, or scoring semantics.

## Validation Plan

- Re-run scoped DOM measurement using Playwright or an equivalent browser script.
- Capture desktop 1440 and mobile 390 screenshots for dark Dracula and light Solarized.
- Verify `.post-content h2` is measured with scoped selector, not TOC `h2`.
- Run the normal repo checks relevant to the touched files: format/check, build, and targeted Playwright or visual checks where available.
- Manual visual review must confirm:
  - first screen reads as article-first;
  - post body has stable H1/H2/p/blockquote rhythm;
  - TOC is useful but lower weight than title/body;
  - bottom tools are grouped/disclosed and do not read as a dashboard wall.

## Open Questions

- Should gu-log introduce `--font-serif` using Noto Serif TC / Source Han Serif style fallback, or rely on existing sans with better scale first?
- Should source citation live before body, after the first lead section, or near the end for SP/CP posts?
- Which metadata should default collapsed: AI score only, pipeline/version only, or all technical provenance?
