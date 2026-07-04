## ADDED Requirements

### Requirement: Article pages MUST use a scoped editorial typography layer

Post pages SHALL define article-specific typography and prose rhythm under `.post`, `.post-header`, and/or `.post-content` rather than relying only on global `h1`, `h2`, and `p` rules.

The layer SHALL preserve the current UI typography for non-article surfaces while allowing article headings, section spacing, blockquotes, notes, and code / prompt examples to have a reading-oriented hierarchy.

#### Scenario: Article heading scale is scoped to posts

- **GIVEN** the site renders a post page and a non-post page
- **WHEN** article heading styles are changed
- **THEN** the post H1 and `.post-content` headings SHALL receive the editorial scale
- **AND** index cards, navigation, tools, and other non-post UI SHALL NOT inherit article-only heading scale by accident

#### Scenario: Scoped measurement uses article body selectors

- **GIVEN** an agent verifies article typography
- **WHEN** it measures H2 or paragraph styling
- **THEN** it SHALL measure `.post-content h2` and `.post-content p`
- **AND** it SHALL NOT use unscoped `h2` or `p` values when those selectors can match TOC, source citation, or metadata text

#### Scenario: Body text is tuned by rhythm, not blind enlargement

- **GIVEN** `.post-content p` is already at a readable size
- **WHEN** an implementation improves prose readability
- **THEN** it SHALL tune line-height, margins, measure, heading contrast, lists, quotes, and note density
- **AND** it SHALL NOT treat body font-size inflation as the only required fix

---

### Requirement: First screen MUST prioritize the article over administrative metadata

The first screen of a post page SHALL make the title and article lead the dominant reading path. Ticket/date/category/source/TOC/status metadata MAY appear near the top, but their visual weight SHALL be lower than the article title and lead.

#### Scenario: Reader lands on a source-based post

- **GIVEN** a reader opens an SP or CP post
- **WHEN** the first viewport renders
- **THEN** the title SHALL be the dominant element
- **AND** essential metadata SHALL be scan-friendly
- **AND** source attribution SHALL remain discoverable
- **AND** source attribution, TOC, and status panels SHALL NOT collectively dominate the first viewport over the article lead

#### Scenario: Source attribution remains accessible after hierarchy changes

- **GIVEN** source citation is restyled or moved
- **WHEN** a reader wants to inspect the original source
- **THEN** the source link SHALL remain visible or clearly reachable from the post page
- **AND** it SHALL preserve link semantics, target, and rel safety

---

### Requirement: TOC MUST be useful navigation with lower visual weight than the article

The table of contents SHALL remain available for long articles, but desktop and mobile TOC presentation SHALL avoid using the same heavy card grammar as primary article content, source cards, or metadata panels.

#### Scenario: Desktop reader uses TOC

- **GIVEN** a desktop viewport wide enough to show the TOC sidebar
- **WHEN** the reader scrolls a long article
- **THEN** the TOC SHALL remain usable for navigation
- **AND** the active section SHALL be identifiable
- **AND** the TOC SHALL have lower visual prominence than the post title and article body

#### Scenario: Mobile reader reaches content quickly

- **GIVEN** a mobile viewport
- **WHEN** the reader opens a post
- **THEN** the TOC SHALL be discoverable if headings exist
- **AND** it SHALL NOT consume disproportionate first-screen height before the article lead

---

### Requirement: Technical provenance MUST be grouped or disclosed after the editorial close

Technical provenance such as translation pipeline, AI Tribunal scores, and version history SHALL remain available, but SHALL be grouped into a low-weight or collapsible technical metadata area after the article body.

#### Scenario: Reader finishes the article

- **GIVEN** a reader reaches the end of `.post-content`
- **WHEN** post metadata and tools render
- **THEN** the page SHALL first provide an editorially coherent close such as tags, source context, or onward reading
- **AND** technical provenance SHALL NOT interrupt the article close as multiple unrelated full-weight panels

#### Scenario: Provenance-focused reader inspects metadata

- **GIVEN** a reader wants Tribunal scores, translation pipeline, or version history
- **WHEN** the technical metadata section is collapsed or visually reduced
- **THEN** the reader SHALL be able to open or inspect it with keyboard and pointer
- **AND** the content SHALL preserve the same underlying data and links

---

### Requirement: Reader tools MUST be organized as a coherent bottom action area

Read status, sharing, login CTA, related articles, series navigation, prev/next navigation, and comments SHALL be organized so they support post completion rather than appearing as a stack of unrelated dashboard widgets.

Version history SHALL remain grouped with technical provenance metadata, not with reader action controls.

#### Scenario: Post has all optional bottom modules

- **GIVEN** a post has scores, tags, translation info, read tracking, share buttons, login CTA, related articles, prev/next nav, comments, and version info
- **WHEN** the reader reaches the post footer area
- **THEN** related modules SHALL be grouped by purpose
- **AND** action controls SHALL be visually distinct from provenance metadata
- **AND** onward navigation SHALL be visually distinct from comments
- **AND** the combined footer SHALL NOT read as one continuous dashboard wall

#### Scenario: Optional modules are absent

- **GIVEN** a post lacks one or more optional modules
- **WHEN** the footer renders
- **THEN** the remaining groups SHALL keep stable spacing and hierarchy
- **AND** absent modules SHALL NOT leave awkward gaps or duplicate separators

---

### Requirement: Editorial presentation changes MUST be visually verified across themes and viewports

Any implementation of this capability SHALL be verified on both supported themes and on desktop and mobile article viewports.

#### Scenario: Implementation is ready for review

- **GIVEN** an implementation changes post typography, first-screen hierarchy, TOC presentation, or bottom tool organization
- **WHEN** the PR is prepared for review
- **THEN** it SHALL include verification for dark Dracula desktop, light Solarized desktop, dark Dracula mobile, and light Solarized mobile
- **AND** it SHALL include scoped selector measurements for `.post-content h2` and `.post-content p`
- **AND** it SHALL confirm that PR1 image work and artifact work are outside the patch
