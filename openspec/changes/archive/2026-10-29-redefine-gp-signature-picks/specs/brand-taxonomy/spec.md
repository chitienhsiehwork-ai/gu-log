<!-- md-zh-tw: ignore -->

## MODIFIED Requirements

### Requirement: Public and machine taxonomy SHALL share one canonical vocabulary

gu-log SHALL use the same canonical names in reader-facing UI and machine-facing storage. The commentary persona SHALL be `Mogu`; its note component SHALL be `MoguNote`; its Vibe score dimension SHALL be `moguNote`. The external-content series SHALL be `GP` (`Gu-log Picks`) for signature articles that ShroomDog explicitly designates, written under the same Mogu-authored source-grounded rules as MP, and `MP` (`Mogu Picks`) for everyday Mogu-authored source-grounded writing, the default series for new source-based articles. Original and tutorial series SHALL remain `SD` and `Lv`.

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

### Requirement: Migration SHALL preserve numeric article identity and pair integrity

At the initial taxonomy cutover, existing SP and CP article numbers SHALL map one-to-one to the same numeric GP and MP identities. Translation pairs SHALL retain matching ticket IDs and base slugs. Counter next values SHALL move to the new namespace without decrementing or reallocating a published number.

A later editorial correction or reclassification MAY replace that article with a newly allocated canonical ticket from another series. This includes ShroomDog designating a published MP as a GP and a GP moving back to MP, both through `scripts/reclassify-post.mjs` (`gp-signature-picks`). This SHALL NOT reuse or reallocate either published number: the replacement SHALL use its series' current counter, both language variants SHALL move together, and every earlier public URL SHALL become an exact historical alias to the replacement.

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

- **GIVEN** a published GP／MP article must move to another series because its voice owner or editorial contract changes, because ShroomDog designates an MP as a GP, or because a GP moves back to MP
- **WHEN** the replacement ticket is allocated
- **THEN** the replacement SHALL consume the next number from its destination series
- **AND** the withdrawn ticket SHALL NOT be assigned to another article
- **AND** zh-tw and English SHALL share the replacement ticket
- **AND** all earlier public URLs SHALL resolve through exact aliases to that pair

### Requirement: Canonical series routes, CLI paths and legacy redirects SHALL match the taxonomy

Gu-log Picks SHALL use route `/gu-log-picks`, ticket prefix `GP`, allocated filename `gp-N-YYYYMMDD-slug.mdx`（English pair adds `en-`）, and no pending filename, because a GP only comes from promoting a published MP (`gp-signature-picks`). Mogu Picks SHALL use route `/mogu-picks`, ticket prefix `MP`, allocated filename `mp-N-YYYYMMDD-slug.mdx`, pending filename `mp-pending-YYYYMMDD-slug.mdx`, and Mogu-named queue / prompt / runner files. English listing routes SHALL use the same path below `/en`. The canonical article pipeline CLI and Go module path SHALL be `gp-pipeline` and `tools/gp-pipeline`.

Series identity SHALL come from `ticketId`; content-type tags `clawd-picks`, `mogu-picks`, `shroom-picks`, `shroomdog-picks`, and any transitional `gu-log-picks` SHALL be removed without replacement.

Reader-facing listing and article URLs that were publicly reachable before being retired SHALL be the sole compatibility boundary. `/shroomdog-picks` and `/clawd-picks` listing paths, their English equivalents, and their purely numeric pagination subpaths SHALL return an HTTP 308 permanent redirect to the corresponding canonical GP／MP listing in the same language. Mogu Picks pagination redirects SHALL preserve the page number. Gu-log Picks pagination redirects SHALL go to the Gu-log Picks listing root, because the translations those old pages listed have been taken down under `post-takedown` and the signature articles the listing shows now do not correspond to the old page numbers. Every retired article URL recorded in `quality/brand-taxonomy-post-migration.json`, both with and without exactly one trailing slash, SHALL return an HTTP 308 permanent redirect to that entry's exact current canonical GP／MP article URL. This SHALL include old SP／CP cutover URLs and a previously canonical GP／MP URL later retired by an editorial correction or reclassification. Multiple exact historical article URLs MAY converge on one current canonical destination. Redirects SHALL NOT infer destinations from a broad legacy prefix or accept deeper paths below an article alias. Manifest summary counts SHALL be derived from its entries and SHALL fail validation when files, unique tickets, complete language pairs, or incomplete tickets drift.

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

## REMOVED Requirements

### Requirement: Reader-facing series labels MUST describe each series' relationship to its source

**Reason**: GP is no longer a reading guide. Its labels must now say it is a ShroomDog-designated signature article and describe its source relationship the same way as MP. OpenSpec does not let a MODIFIED block drop the existing "GP uses reading-guide labels" scenario, so the requirement is replaced under a new name.

**Migration**: Use "Reader-facing series labels MUST match each series' identity and source relationship". The MP label rules and the legacy-MP scenario carry over unchanged; GP homepage, listing, article technical details and About copy move from reading-guide wording to signature-pick wording.

## ADDED Requirements

### Requirement: Reader-facing series labels MUST match each series' identity and source relationship

Reader-facing zh-TW 與 English UI SHALL 用符合系列 contract 的文字描述系列身份與 source relationship。GP SHALL 標示為 ShroomDog 指定的招牌文章（例如「ShroomDog 指定的招牌文章」／`ShroomDog's signature picks`），它跟來源的關係 SHALL 使用跟 MP 相同的 source-grounded writing 語言；GP SHALL NOT 標成導讀（例如「導讀」、`reading guide`）或翻譯（例如「翻譯自」、`Translated from`）。MP SHALL 使用 source-grounded writing 語言，清楚指出正文由 Mogu 依來源撰寫，SHALL NOT 顯示為「翻譯自」、「原文出處」、`Translated from`、`Original source` 或 translation pipeline，也 SHALL NOT 假裝成沒有來源的 original writing。

#### Scenario: GP uses signature-pick labels

- **WHEN** reader 開啟 GP 首頁區塊、系列頁、文章頁或 About 頁的系列說明
- **THEN** zh-TW UI SHALL 說明 GP 是 ShroomDog 指定的招牌文章，並讓讀者找得到原文連結
- **AND** English UI SHALL 使用對應的 signature-pick language
- **AND** 兩種語言都 SHALL NOT 把 GP 標成導讀或翻譯

#### Scenario: GP article technical details match MP

- **WHEN** reader 展開 GP 文章頁的技術資訊
- **THEN** pipeline 標示 SHALL 跟 MP 一樣描述 source-grounded writing pipeline
- **AND** SHALL NOT 顯示「導讀 pipeline」或 `reading-guide pipeline`

#### Scenario: MP uses source-material labels

- **WHEN** reader 開啟 MP 首頁卡片、系列頁或文章頁
- **THEN** zh-TW UI SHALL 使用「來源材料／Mogu 依來源撰寫」等 source-grounded language
- **AND** English UI SHALL 使用 `Source material` 或同義的 source-grounded language
- **AND** MP technical details SHALL 描述 source-grounded writing pipeline

#### Scenario: legacy MP receives no new verification claim

- **WHEN** 既有 MP 使用新的中性 source-grounded label
- **THEN** UI SHALL NOT 宣稱該文曾通過本 change 之後才建立的 judge 或 verification
- **AND** SHALL NOT 因 label 更新而改寫文章內容或 frontmatter
