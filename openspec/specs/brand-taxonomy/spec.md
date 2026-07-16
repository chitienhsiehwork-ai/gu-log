<!-- md-zh-tw: ignore -->

# brand-taxonomy Specification

## Purpose

Define the one canonical Mogu / GP / MP vocabulary across public UI, stored data, routes, feeds, pipelines, and operator-facing contracts, including the rules for an atomic breaking migration from retired taxonomy.

## Requirements

### Requirement: Public and machine taxonomy SHALL share one canonical vocabulary

gu-log SHALL use the same canonical names in reader-facing UI and machine-facing storage. The commentary persona SHALL be `Mogu`; its note component SHALL be `MoguNote`; its Vibe score dimension SHALL be `moguNote`. Translation series SHALL be `GP` (`Gu-log Picks`) and `MP` (`Mogu Picks`). Original and tutorial series SHALL remain `SD` and `Lv`.

The application SHALL NOT store SP/CP and translate them to GP/MP only at render time. Frontmatter, filenames, routes, counters, filters, APIs, search, feeds, pipelines, tests and generated data SHALL use the canonical values directly.

#### Scenario: GP article renders without an alias translation

- **GIVEN** a Gu-log Picks article has ticket `GP-258`
- **WHEN** the article is indexed, rendered, searched or returned by the feed API
- **THEN** every layer SHALL use `GP-258`
- **AND** no layer SHALL first store `SP-258` and replace its prefix for display

#### Scenario: MP article uses the same identity across layers

- **GIVEN** a Mogu Picks article has ticket `MP-314` and an `mp-314-*` slug
- **WHEN** pipeline output is validated and published
- **THEN** counter, frontmatter, filename, route, badge, search and feed SHALL agree on the MP identity

### Requirement: Canonical series routes and CLI paths SHALL match the taxonomy

Gu-log Picks SHALL use route `/gu-log-picks`, ticket prefix `GP`, allocated filename `gp-N-YYYYMMDD-slug.mdx`, and pending filename `gp-pending-YYYYMMDD-slug.mdx`（English pair adds `en-`）. Mogu Picks SHALL use route `/mogu-picks`, ticket prefix `MP`, allocated filename `mp-N-YYYYMMDD-slug.mdx`, pending filename `mp-pending-YYYYMMDD-slug.mdx`, and Mogu-named queue / prompt / runner files. English listing routes SHALL use the same path below `/en`. The canonical translation CLI and Go module path SHALL be `gp-pipeline` and `tools/gp-pipeline`.

Series identity SHALL come from `ticketId`; content-type tags `clawd-picks`, `mogu-picks`, `shroom-picks`, `shroomdog-picks`, and any transitional `gu-log-picks` SHALL be removed without replacement.

#### Scenario: Reader opens a canonical series page

- **WHEN** a reader opens `/gu-log-picks` or `/mogu-picks`
- **THEN** the page SHALL filter directly by GP or MP ticket IDs
- **AND** SHALL NOT read SP/CP IDs or legacy tags and translate them for display

#### Scenario: Agent invokes the translation CLI

- **WHEN** an agent runs the Gu-log Picks pipeline
- **THEN** the documented and executable entrypoint SHALL be `tools/gp-pipeline/gp-pipeline`
- **AND** neither `tools/sp-pipeline` nor an `sp-pipeline` shim SHALL exist

#### Scenario: Old series routes are requested

- **WHEN** a request targets `/shroomdog-picks`, `/clawd-picks`, an old SP/CP post slug, or their English equivalents after cutover
- **THEN** the site SHALL return 404
- **AND** SHALL NOT render or redirect to canonical content

### Requirement: Legacy branding contracts SHALL be retired atomically

The merge-ready tree SHALL NOT expose `Clawd`, `ClawdNote`, `clawdNote`, ShroomDog Picks / `SP`, or Clawd Picks / `CP` as active persona, component, schema, series, ticket, slug, route, tag, pipeline or authoring contract. Legacy aliases, fallback readers, dual writers, display translations, wrappers and redirect routes SHALL be removed in the same change after data migration succeeds.

#### Scenario: New content attempts to use a retired contract

- **WHEN** a changed post, prompt, fixture or runtime file introduces `ClawdNote`, `clawdNote`, an `SP-N` / `CP-N` ticket, or an `sp-` / `cp-` canonical slug
- **THEN** the deterministic taxonomy gate SHALL fail
- **AND** the diagnostic SHALL identify the file, token and expected canonical replacement

#### Scenario: Merge-ready site has no compatibility path

- **WHEN** the migration is complete
- **THEN** the site SHALL NOT retain old post redirects, Reader Tracker slug aliases, SP pipeline shims or a ClawdNote wrapper
- **AND** all repo-owned callers SHALL already use the canonical contract

### Requirement: Migration SHALL preserve numeric article identity and pair integrity

Existing SP and CP article numbers SHALL map one-to-one to the same numeric GP and MP identities. Translation pairs SHALL retain matching ticket IDs and base slugs. Counter next values SHALL move to the new namespace without decrementing or reallocating a published number.

#### Scenario: Existing SP pair migrates to GP

- **GIVEN** zh-tw and en posts both carry `SP-165`
- **WHEN** the migration runs
- **THEN** both SHALL carry `GP-165`
- **AND** both filenames SHALL use the `gp-165-` canonical base
- **AND** no other post SHALL acquire `GP-165`

#### Scenario: Counter namespace migrates

- **GIVEN** the SP and CP counters have current next values
- **WHEN** the counter file migrates
- **THEN** the identical values SHALL be stored under GP and MP
- **AND** SP and CP keys SHALL no longer be accepted

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
