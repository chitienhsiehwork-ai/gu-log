## MODIFIED Requirements

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
