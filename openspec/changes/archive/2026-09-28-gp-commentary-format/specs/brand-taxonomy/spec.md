<!-- md-zh-tw: ignore -->

## MODIFIED Requirements

### Requirement: Public and machine taxonomy SHALL share one canonical vocabulary

gu-log SHALL use the same canonical names in reader-facing UI and machine-facing storage. The commentary persona SHALL be `Mogu`; its note component SHALL be `MoguNote`; its Vibe score dimension SHALL be `moguNote`. The external-content series SHALL be `GP` (`Gu-log Picks`) for ShroomDog-curated reading guides written in Mogu's voice and `MP` (`Mogu Picks`) for Mogu-authored source-grounded writing. Original and tutorial series SHALL remain `SD` and `Lv`.

The application SHALL NOT store a retired taxonomy alias and translate it to GP/MP only at render time. Frontmatter, filenames, routes, counters, filters, APIs, search, feeds, pipelines, tests and generated data SHALL use the canonical values directly.

#### Scenario: GP article renders without an alias translation

- **GIVEN** a Gu-log Picks article has ticket `GP-258`
- **WHEN** the article is indexed, rendered, searched or returned by the feed API
- **THEN** every layer SHALL use `GP-258`
- **AND** no layer SHALL first store a retired alias and replace its prefix for display

#### Scenario: MP article uses the same identity across layers

- **GIVEN** a Mogu Picks article has ticket `MP-314` and an `mp-314-*` slug
- **WHEN** pipeline output is validated and published
- **THEN** counter, frontmatter, filename, route, badge, search and feed SHALL agree on the MP identity
- **AND** reader-facing copy SHALL identify its source-grounded Mogu writing contract rather than translation

## REMOVED Requirements

### Requirement: Canonical series routes and CLI paths SHALL match the taxonomy

**Reason**: GP resumes as reading guides, so this requirement's GP pagination rationale and its "paused Gu-log Picks listing" scenario no longer hold, and the requirement still calls `gp-pipeline` a translation CLI. OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Re-added as "Canonical series routes, CLI paths and legacy redirects SHALL match the taxonomy" with the same routes, redirects, manifest and CLI rules. The GP listing's empty state is owned by `editorial-charter`.

### Requirement: Reader-facing series labels MUST state the editorial relationship to source

**Reason**: GP no longer uses translation labels; the "GP keeps translation labels" scenario cannot survive a MODIFIED delta.

**Migration**: Replaced by "Reader-facing series labels MUST describe each series' relationship to its source". The MP rules and scenarios carry over unchanged.

## ADDED Requirements

### Requirement: Canonical series routes, CLI paths and legacy redirects SHALL match the taxonomy

Gu-log Picks SHALL use route `/gu-log-picks`, ticket prefix `GP`, allocated filename `gp-N-YYYYMMDD-slug.mdx`, and pending filename `gp-pending-YYYYMMDD-slug.mdx`（English pair adds `en-`）. Mogu Picks SHALL use route `/mogu-picks`, ticket prefix `MP`, allocated filename `mp-N-YYYYMMDD-slug.mdx`, pending filename `mp-pending-YYYYMMDD-slug.mdx`, and Mogu-named queue / prompt / runner files. English listing routes SHALL use the same path below `/en`. The canonical article pipeline CLI and Go module path SHALL be `gp-pipeline` and `tools/gp-pipeline`.

Series identity SHALL come from `ticketId`; content-type tags `clawd-picks`, `mogu-picks`, `shroom-picks`, `shroomdog-picks`, and any transitional `gu-log-picks` SHALL be removed without replacement.

Reader-facing listing and article URLs that were publicly reachable before being retired SHALL be the sole compatibility boundary. `/shroomdog-picks` and `/clawd-picks` listing paths, their English equivalents, and their purely numeric pagination subpaths SHALL return an HTTP 308 permanent redirect to the corresponding canonical GP／MP listing in the same language. Mogu Picks pagination redirects SHALL preserve the page number. Gu-log Picks pagination redirects SHALL go to the Gu-log Picks listing root, because the translations those old pages listed have been taken down under `post-takedown` and the reading guides the listing shows now do not correspond to the old page numbers. Every retired article URL recorded in `quality/brand-taxonomy-post-migration.json`, both with and without exactly one trailing slash, SHALL return an HTTP 308 permanent redirect to that entry's exact current canonical GP／MP article URL. This SHALL include old SP／CP cutover URLs and a previously canonical GP／MP URL later retired by an editorial correction or reclassification. Multiple exact historical article URLs MAY converge on one current canonical destination. Redirects SHALL NOT infer destinations from a broad legacy prefix or accept deeper paths below an article alias. Manifest summary counts SHALL be derived from its entries and SHALL fail validation when files, unique tickets, complete language pairs, or incomplete tickets drift.

#### Scenario: Reader opens a canonical series page

- **WHEN** a reader opens `/gu-log-picks` or `/mogu-picks`
- **THEN** the page SHALL filter directly by GP or MP ticket IDs
- **AND** SHALL NOT read SP/CP IDs or legacy tags and translate them for display

#### Scenario: Agent invokes the article pipeline CLI

- **WHEN** an agent runs the article pipeline
- **THEN** the documented and executable entrypoint SHALL be `tools/gp-pipeline/gp-pipeline`
- **AND** neither `tools/sp-pipeline` nor an `sp-pipeline` shim SHALL exist

#### Scenario: Reader requests an old listing path

- **WHEN** a request targets `/shroomdog-picks`, `/clawd-picks`, their English equivalents, or one of those routes followed by a numeric page segment
- **THEN** the response SHALL be HTTP 308
- **AND** `Location` SHALL be the corresponding `/gu-log-picks` or `/mogu-picks` canonical path in the same language
- **AND** a `/clawd-picks` numeric page SHALL keep its page number, while a `/shroomdog-picks` numeric page SHALL go to the Gu-log Picks listing root
- **AND** following the redirect SHALL return 200 without a redirect loop

#### Scenario: Reader requests an old article URL in the migration manifest

- **GIVEN** an entry in `quality/brand-taxonomy-post-migration.json` has an `oldSlug`, `newSlug`, and language
- **WHEN** a reader requests that language's old public article URL with no trailing slash or with exactly one trailing slash
- **THEN** both forms SHALL respond with HTTP 308
- **AND** `Location` SHALL equal that entry's exact current canonical public article URL
- **AND** following either redirect SHALL return 200 without a redirect loop

#### Scenario: Published canonical article is reclassified

- **GIVEN** a published GP／MP article is withdrawn and replaced under a different canonical ticket and slug
- **WHEN** the migration manifest records both its earlier public alias and any older cutover alias
- **THEN** every exact alias SHALL return HTTP 308 directly to the localized current canonical article
- **AND** multiple aliases MAY share that destination
- **AND** every entry's ticket, slug, filename and language SHALL remain internally consistent
- **AND** a historical mismatch between content ticket and public-route ticket SHALL be represented explicitly, with the route ticket matching the old public filename and slug
- **AND** entries without such a historical mismatch SHALL NOT silently split those identities

#### Scenario: Repo-owned article link targets a reclassified article

- **GIVEN** a maintained article links to another article that has been reclassified
- **WHEN** the link is updated after the replacement becomes canonical
- **THEN** its URL SHALL point directly to the localized current canonical article
- **AND** its reader-visible ticket label and title SHALL identify that current article
- **AND** it SHALL NOT present a historical alias ticket or title as the current identity
- **AND** link-only maintenance SHALL be accepted only when the staged destination resolves uniquely to that canonical article and the label exactly matches its ticket and title
- **AND** an unresolved, ambiguous, non-canonical, or mismatched destination SHALL fail closed instead of bypassing the normal content gates

#### Scenario: Request has no controlled public compatibility mapping

- **WHEN** a request targets an unknown legacy article slug, a deeper path below an exact article alias, the never-published `/shroom-picks` listing, a legacy API path, artifact, asset, Reader alias, pipeline alias, or machine contract
- **THEN** the application SHALL NOT synthesize a destination from a legacy prefix
- **AND** the request SHALL remain retired with the contract-appropriate 404, 410, or validation failure

### Requirement: Reader-facing series labels MUST describe each series' relationship to its source

Reader-facing zh-TW 與 English UI SHALL 用符合系列 contract 的文字描述 source relationship。GP SHALL 使用導讀語言：說明這是 ShroomDog 精選、由 Mogu 撰寫的導讀，並帶讀者回原文；GP SHALL NOT 標成翻譯（例如「翻譯自」、「翻譯 pipeline」、`Translated from` 或 `translation pipeline`）。MP SHALL 使用 source-grounded writing 語言，並清楚指出正文由 Mogu 依來源撰寫。MP SHALL NOT 顯示為「翻譯自」、「原文出處」、`Translated from`、`Original source` 或 translation pipeline，也 SHALL NOT 假裝成沒有來源的 original writing。

#### Scenario: GP uses reading-guide labels

- **WHEN** reader 開啟 GP 首頁卡片、系列頁、文章頁或 About 頁的系列說明
- **THEN** zh-TW UI SHALL 使用導讀語言（例如「ShroomDog 精選導讀」），並讓讀者找得到原文連結
- **AND** English UI SHALL 使用對應的 reading-guide language
- **AND** 兩種語言都 SHALL NOT 把 GP 標成翻譯

#### Scenario: MP uses source-material labels

- **WHEN** reader 開啟 MP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「來源材料／Mogu 依來源撰寫」等 source-grounded language
- **AND** English UI SHALL 使用 `Source material` 或同義的 source-grounded language
- **AND** MP technical details SHALL 描述 source-grounded writing pipeline

#### Scenario: legacy MP receives no new verification claim

- **WHEN** 既有 MP 使用新的中性 source-grounded label
- **THEN** UI SHALL NOT 宣稱該文曾通過本 change 之後才建立的 judge 或 verification
- **AND** SHALL NOT 因 label 更新而改寫文章內容或 frontmatter
