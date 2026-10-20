# Spec Delta

## MODIFIED Requirements

### Requirement: Legacy branding contracts SHALL be retired atomically

The merge-ready tree SHALL NOT expose `Clawd`, `ClawdNote`, `clawdNote`, ShroomDog Picks / `SP`, or Clawd Picks / `CP` as active persona, component, schema, series, ticket, slug, route, tag, pipeline or authoring contract. Legacy aliases, fallback readers, dual writers, display translations and wrappers SHALL be removed in the same change after data migration succeeds.

The only permitted legacy compatibility surface SHALL be the declarative reader-facing HTTP redirects sourced from `quality/brand-taxonomy-post-migration.json` plus the finite set of actual legacy listing routes. New content, sitemap entries and generated links SHALL remain canonical-only. A deterministic taxonomy check SHALL reject retired tokens in tracked files, except in a short path exclusion list kept in the scanner itself for files whose job is to handle or record the old names (redirect implementation and manifest, validators that reject retired names, tests, history and verbatim quotations).

#### Scenario: New content attempts to use a retired contract

- **WHEN** a changed post, prompt, fixture or runtime file outside the exclusion list introduces `ClawdNote`, `clawdNote`, an `SP-N` / `CP-N` ticket, or an `sp-` / `cp-` canonical slug
- **THEN** the deterministic taxonomy gate SHALL fail
- **AND** the diagnostic SHALL identify the file and token

#### Scenario: Merge-ready site retains only the public URL boundary

- **WHEN** the migration is complete
- **THEN** the site SHALL retain only controlled HTTP redirects for manifest-backed old articles and actual legacy listings
- **AND** SHALL NOT retain Reader Tracker slug aliases, API aliases, SP pipeline shims, a ClawdNote wrapper, legacy frontmatter, legacy counters, or other machine compatibility paths
- **AND** all repo-owned callers and generated links SHALL already use the canonical contract

#### Scenario: Taxonomy gate audits intentional redirect sources

- **WHEN** a redirect source contains a retired public slug or listing token
- **THEN** it SHALL live only in the redirect implementation, the migration manifest or their tests, which the scanner excludes by path
- **AND** the same token in any other tracked file SHALL fail the taxonomy gate

### Requirement: Factual names and deployment coordinates SHALL not be corrupted by branding migration

The migration SHALL preserve accurate references to third-party products and entities, including `Claude`, `Claude Code`, `Anthropic` and `OpenClaw`, and SHALL preserve verbatim source quotations and archived decision evidence. External hostnames, SSH aliases, Unix users and filesystem paths that still contain retired naming MAY remain when they are actual deployment coordinates rather than persona branding.

The scanner SHALL target semantically explicit ticket, slug, route, tag, component, schema-key and command patterns rather than bare `SP` / `CP` substrings.

#### Scenario: Article discusses Claude Code

- **WHEN** a post factually names Claude Code or Anthropic
- **THEN** the migration SHALL leave that product/entity name unchanged
- **AND** the residual checker SHALL NOT confuse `Claude` with the retired persona name

#### Scenario: Operator still uses a legacy SSH coordinate

- **WHEN** an operator must still connect through an actual legacy SSH alias or host-specific Unix path
- **THEN** the coordinate MAY remain in local machine context or external runtime config
- **AND** tracked repo docs / scripts SHALL prefer neutral host/path variables
