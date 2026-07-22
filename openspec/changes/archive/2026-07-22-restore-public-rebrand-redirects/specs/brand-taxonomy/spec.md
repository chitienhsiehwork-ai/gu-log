<!-- md-zh-tw: ignore -->

## MODIFIED Requirements

### Requirement: Canonical series routes and CLI paths SHALL match the taxonomy

Gu-log Picks SHALL use route `/gu-log-picks`, ticket prefix `GP`, allocated filename `gp-N-YYYYMMDD-slug.mdx`, and pending filename `gp-pending-YYYYMMDD-slug.mdx`（English pair adds `en-`）. Mogu Picks SHALL use route `/mogu-picks`, ticket prefix `MP`, allocated filename `mp-N-YYYYMMDD-slug.mdx`, pending filename `mp-pending-YYYYMMDD-slug.mdx`, and Mogu-named queue / prompt / runner files. English listing routes SHALL use the same path below `/en`. The canonical translation CLI and Go module path SHALL be `gp-pipeline` and `tools/gp-pipeline`.

Series identity SHALL come from `ticketId`; content-type tags `clawd-picks`, `mogu-picks`, `shroom-picks`, `shroomdog-picks`, and any transitional `gu-log-picks` SHALL be removed without replacement.

Reader-facing legacy listing and article URLs that existed before cutover SHALL be the sole compatibility boundary. `/shroomdog-picks` and `/clawd-picks` listing paths, their English equivalents, and their purely numeric pagination subpaths SHALL return an HTTP 308 permanent redirect to the corresponding canonical GP／MP path while preserving the page number. Every old SP／CP article URL recorded in `quality/brand-taxonomy-post-migration.json` SHALL return an HTTP 308 permanent redirect to that entry's exact canonical GP／MP article URL. Redirects SHALL NOT infer destinations from a broad legacy prefix.

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
- **WHEN** a reader requests that language's old public article URL
- **THEN** the response SHALL be HTTP 308
- **AND** `Location` SHALL equal that entry's exact canonical public article URL
- **AND** following the redirect SHALL return 200 without a redirect loop

#### Scenario: Request has no controlled public compatibility mapping

- **WHEN** a request targets an unknown legacy article slug, the never-published `/shroom-picks` listing, a legacy API path, artifact, asset, Reader alias, pipeline alias, or machine contract
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
