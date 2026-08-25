<!-- md-zh-tw: ignore -->

# brand-taxonomy Specification

## Purpose

Define the one canonical Mogu / GP / MP vocabulary across public UI, stored data, routes, feeds, pipelines, and operator-facing contracts, including the rules for an atomic breaking migration from retired taxonomy.

## Requirements

### Requirement: Public and machine taxonomy SHALL share one canonical vocabulary

gu-log SHALL use the same canonical names in reader-facing UI and machine-facing storage. The commentary persona SHALL be `Mogu`; its note component SHALL be `MoguNote`; its Vibe score dimension SHALL be `moguNote`. The external-content series SHALL be `GP` (`Gu-log Picks`) for source-author-voice faithful translation and `MP` (`Mogu Picks`) for Mogu-authored source-grounded writing. Original and tutorial series SHALL remain `SD` and `Lv`.

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

### Requirement: Canonical series routes and CLI paths SHALL match the taxonomy

Gu-log Picks SHALL use route `/gu-log-picks`, ticket prefix `GP`, allocated filename `gp-N-YYYYMMDD-slug.mdx`, and pending filename `gp-pending-YYYYMMDD-slug.mdx`（English pair adds `en-`）. Mogu Picks SHALL use route `/mogu-picks`, ticket prefix `MP`, allocated filename `mp-N-YYYYMMDD-slug.mdx`, pending filename `mp-pending-YYYYMMDD-slug.mdx`, and Mogu-named queue / prompt / runner files. English listing routes SHALL use the same path below `/en`. The canonical translation CLI and Go module path SHALL be `gp-pipeline` and `tools/gp-pipeline`.

Series identity SHALL come from `ticketId`; content-type tags `clawd-picks`, `mogu-picks`, `shroom-picks`, `shroomdog-picks`, and any transitional `gu-log-picks` SHALL be removed without replacement.

Reader-facing listing and article URLs that were publicly reachable before being retired SHALL be the sole compatibility boundary. `/shroomdog-picks` and `/clawd-picks` listing paths, their English equivalents, and their purely numeric pagination subpaths SHALL return an HTTP 308 permanent redirect to the corresponding canonical GP／MP path while preserving the page number. Every retired article URL recorded in `quality/brand-taxonomy-post-migration.json`, both with and without exactly one trailing slash, SHALL return an HTTP 308 permanent redirect to that entry's exact current canonical GP／MP article URL. This SHALL include old SP／CP cutover URLs and a previously canonical GP／MP URL later retired by an editorial correction or reclassification. Multiple exact historical article URLs MAY converge on one current canonical destination. Redirects SHALL NOT infer destinations from a broad legacy prefix or accept deeper paths below an article alias. Manifest summary counts SHALL be derived from its entries and SHALL fail validation when files, unique tickets, complete language pairs, or incomplete tickets drift.

#### Scenario: Reader opens a canonical series page

- **WHEN** a reader opens `/gu-log-picks` or `/mogu-picks`
- **THEN** the page SHALL filter directly by GP or MP ticket IDs
- **AND** SHALL NOT read SP/CP IDs or legacy tags and translate them for display

#### Scenario: Agent invokes the translation CLI

- **WHEN** an agent runs the Gu-log Picks pipeline
- **THEN** the documented and executable entrypoint SHALL be `tools/gp-pipeline/gp-pipeline`
- **AND** neither `tools/sp-pipeline` nor an `sp-pipeline` shim SHALL exist

#### Scenario: Reader requests an old listing path

- **WHEN** a request targets `/shroomdog-picks`, `/clawd-picks`, their English equivalents, or one of those routes followed by a numeric page segment
- **THEN** the response SHALL be HTTP 308
- **AND** `Location` SHALL be the corresponding `/gu-log-picks` or `/mogu-picks` canonical path with the same language and page number
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

### Requirement: Legacy branding contracts SHALL be retired atomically

The merge-ready tree SHALL NOT expose `Clawd`, `ClawdNote`, `clawdNote`, ShroomDog Picks / `SP`, or Clawd Picks / `CP` as active persona, component, schema, series, ticket, slug, route, tag, pipeline or authoring contract. Legacy aliases, fallback readers, dual writers, display translations and wrappers SHALL be removed in the same change after data migration succeeds.

The only permitted legacy compatibility surface SHALL be the declarative reader-facing HTTP redirects sourced from `quality/brand-taxonomy-post-migration.json` plus the finite set of actual legacy listing routes. Redirect sources MAY contain retired public URL tokens solely in the centralized routing implementation, tests, specifications and operations evidence. New content, sitemap entries and generated links SHALL remain canonical-only, and deterministic taxonomy checks SHALL reject legacy tokens outside those exact audited exceptions.

#### Scenario: New content attempts to use a retired contract

- **WHEN** a changed post, prompt, fixture or runtime file introduces `ClawdNote`, `clawdNote`, an `SP-N` / `CP-N` ticket, or an `sp-` / `cp-` canonical slug
- **THEN** the deterministic taxonomy gate SHALL fail
- **AND** the diagnostic SHALL identify the file, token and expected canonical replacement

#### Scenario: Merge-ready site retains only the public URL boundary

- **WHEN** the migration is complete
- **THEN** the site SHALL retain only controlled HTTP redirects for manifest-backed old articles and actual legacy listings
- **AND** SHALL NOT retain Reader Tracker slug aliases, API aliases, SP pipeline shims, a ClawdNote wrapper, legacy frontmatter, legacy counters, or other machine compatibility paths
- **AND** all repo-owned callers and generated links SHALL already use the canonical contract

#### Scenario: Taxonomy gate audits intentional redirect sources

- **WHEN** a redirect source contains a retired public slug or listing token
- **THEN** its file, pattern, reason and expected count SHALL be centralized in the exact residual allowlist
- **AND** stale, broadened or newly introduced exceptions SHALL fail the taxonomy gate

### Requirement: Migration SHALL preserve numeric article identity and pair integrity

At the initial taxonomy cutover, existing SP and CP article numbers SHALL map one-to-one to the same numeric GP and MP identities. Translation pairs SHALL retain matching ticket IDs and base slugs. Counter next values SHALL move to the new namespace without decrementing or reallocating a published number.

A later editorial correction or reclassification MAY replace that article with a newly allocated canonical ticket from another series. This SHALL NOT reuse or reallocate either published number: the replacement SHALL use its series' current counter, both language variants SHALL move together, and every earlier public URL SHALL become an exact historical alias to the replacement.

#### Scenario: Existing SP pair migrates to GP

- **GIVEN** zh-tw and en posts both carry `SP-165`
- **WHEN** the initial taxonomy migration runs
- **THEN** both SHALL carry `GP-165`
- **AND** both filenames SHALL use the `gp-165-` canonical base
- **AND** no other post SHALL acquire `GP-165`

#### Scenario: Counter namespace migrates

- **GIVEN** the SP and CP counters have current next values
- **WHEN** the counter file migrates
- **THEN** the identical values SHALL be stored under GP and MP
- **AND** SP and CP keys SHALL no longer be accepted

#### Scenario: Later reclassification allocates a new identity

- **GIVEN** a previously migrated GP／MP article must move to another series because its voice owner or editorial contract changes
- **WHEN** the replacement ticket is allocated
- **THEN** the replacement SHALL consume the next number from its destination series
- **AND** the withdrawn ticket SHALL NOT be assigned to another article
- **AND** zh-tw and English SHALL share the replacement ticket
- **AND** all earlier public URLs SHALL resolve through exact aliases to that pair

### Requirement: Factual names and deployment coordinates SHALL not be corrupted by branding migration

The migration SHALL preserve accurate references to third-party products and entities, including `Claude`, `Claude Code`, `Anthropic` and `OpenClaw`, and SHALL preserve verbatim source quotations and archived decision evidence. External hostnames, SSH aliases, Unix users and filesystem paths that still contain retired naming MAY remain only when they are actual deployment coordinates rather than persona branding.

Immutable history trees such as `sources/**` and archived OpenSpec decision records MAY be named as scanner-scope exclusions. Active code, docs, posts and authoring inputs SHALL NOT use broad directory exclusions: every allowed residual there SHALL be centralized as exact path + exact token/pattern + reason + expected count. The scanner SHALL target semantically explicit ticket, slug, route, tag, label, component, schema-key and command patterns rather than bare `SP` / `CP` substrings.

#### Scenario: Article discusses Claude Code

- **WHEN** a post factually names Claude Code or Anthropic
- **THEN** the migration SHALL leave that product/entity name unchanged
- **AND** the residual checker SHALL NOT confuse `Claude` with the retired persona name

#### Scenario: Operator still uses a legacy SSH coordinate

- **WHEN** an operator must still connect through an actual legacy SSH alias or host-specific Unix path
- **THEN** the coordinate MAY remain in local machine context or external runtime config
- **AND** tracked repo docs / scripts SHALL prefer neutral host/path variables
- **AND** any unavoidable active-tree coordinate SHALL have an exact allowlist entry and reason

### Requirement: Reader-facing series labels MUST state the editorial relationship to source

Reader-facing zh-TW 與 English UI SHALL 用符合系列 contract 的文字描述 source relationship。GP SHALL 使用翻譯語言；MP SHALL 使用 source-grounded writing 語言，並清楚指出正文由 Mogu 依來源撰寫。MP SHALL NOT 顯示為「翻譯自」、「原文出處」、`Translated from`、`Original source` 或 translation pipeline，也 SHALL NOT 假裝成沒有來源的 original writing。

#### Scenario: GP keeps translation labels

- **WHEN** reader 開啟 GP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「翻譯自／原文出處／翻譯 pipeline」等 translation language
- **AND** English UI SHALL 使用對應的 translation language

#### Scenario: MP uses source-material labels

- **WHEN** reader 開啟 MP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「來源材料／Mogu 依來源撰寫」等 source-grounded language
- **AND** English UI SHALL 使用 `Source material` 或同義的 source-grounded language
- **AND** MP technical details SHALL 描述 source-grounded writing pipeline

#### Scenario: legacy MP receives no new verification claim

- **WHEN** 既有 MP 使用新的中性 source-grounded label
- **THEN** UI SHALL NOT 宣稱該文曾通過本 change 之後才建立的 judge 或 verification
- **AND** SHALL NOT 因 label 更新而改寫文章內容或 frontmatter
