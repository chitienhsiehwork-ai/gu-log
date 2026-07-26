# glossary-link-coverage Specification

## Purpose

定義文章 glossary link coverage 的語言路由、安全掃描區域、linking config、checker／fixer 分工與 blocking rollout，確保術語連結完整且不破壞 MDX。

## Requirements

### Requirement: Posts MUST link enabled glossary terms at least once

For each enabled glossary term that appears in a post body, the post SHALL contain at least one Markdown link from a safe occurrence of that term to the corresponding glossary anchor.

The system SHALL enforce article-level coverage, not occurrence-level coverage: one glossary link per term per post is sufficient.

#### Scenario: first safe occurrence is linked

- **WHEN** a post body contains the enabled term `Elixir`
- **AND** the post does not contain a link to `/glossary#elixir` or `/en/glossary#elixir` as appropriate for its language
- **THEN** the glossary coverage checker SHALL report a missing link violation
- **AND** the fixer SHALL be able to wrap the first safe occurrence in a Markdown link

#### Scenario: repeated occurrences do not require repeated links

- **WHEN** a post body contains `Elixir` ten times
- **AND** at least one safe occurrence links to the expected glossary anchor
- **THEN** the checker SHALL treat that term as covered for that post
- **AND** SHALL NOT require the other nine occurrences to be linked

---

### Requirement: Glossary link scanning MUST ignore unsafe regions

The glossary link scanner SHALL ignore non-prose or unsafe regions when detecting linkable occurrences.

Unsafe regions include:

- YAML frontmatter
- fenced code blocks
- inline code spans
- existing Markdown links and link targets
- raw URLs
- import/export lines
- raw MDX/HTML component tags and attributes
- blockquotes by default

#### Scenario: frontmatter term is ignored

- **WHEN** a post summary contains `Elixir` in YAML frontmatter
- **AND** the body does not contain `Elixir`
- **THEN** the checker SHALL NOT report a missing Elixir glossary link

#### Scenario: source quote term is ignored by default

- **WHEN** `Elixir` appears only inside a Markdown blockquote
- **THEN** the checker SHALL NOT require that quoted occurrence to be linked
- **AND** the fixer SHALL NOT modify the quote

#### Scenario: existing link text is not relinked

- **WHEN** a post contains `[Elixir](/glossary#elixir)`
- **THEN** the fixer SHALL NOT wrap `Elixir` again
- **AND** the checker SHALL count the term as covered

---

### Requirement: Link target MUST follow post language

The glossary link target SHALL match the post language.

For zh-tw posts, the target SHALL be `/glossary#<anchor>`. For English posts, the target SHALL be `/en/glossary#<anchor>`.

#### Scenario: zh-tw post links to zh-tw glossary

- **WHEN** a zh-tw post contains a safe `Elixir` occurrence
- **THEN** the fixer SHALL link it as `[Elixir](/glossary#elixir)`

#### Scenario: English post links to English glossary

- **WHEN** an English post contains a safe `Elixir` occurrence
- **THEN** the fixer SHALL link it as `[Elixir](/en/glossary#elixir)`

---

### Requirement: Automatic matching MUST use linking config, not all aliases

The glossary matcher SHALL use explicit `linking.match` values when present. If no `linking.match` exists, it SHALL use the canonical `term` only. It SHALL NOT automatically use every value in `aliases` as a link matcher.

#### Scenario: aliases are not automatic matches

- **WHEN** a glossary entry has alias `Power Elixir`
- **AND** `linking.match` only contains `Elixir`
- **THEN** the checker SHALL NOT require `Power Elixir` to link unless it also contains the canonical matcher `Elixir` as a configured safe match

#### Scenario: longer configured match wins

- **WHEN** `Codex app server` and `Codex` are both configured match strings
- **THEN** the scanner SHALL prefer the longer match at the same location
- **AND** SHALL NOT partially link `Codex` inside `Codex app server`

---

### Requirement: Checker and fixer MUST be separate

The system SHALL provide a checker that reports violations without changing files and a fixer that applies deterministic safe links.

#### Scenario: checker fails without modifying files

- **WHEN** a post is missing a glossary link
- **THEN** `scripts/check-glossary-links.mjs` SHALL exit non-zero
- **AND** SHALL NOT modify the post
- **AND** SHALL print the file, term, line, expected link, and suggested fixer command

#### Scenario: fixer is idempotent

- **WHEN** `scripts/apply-glossary-links.mjs --term Elixir` is run twice
- **THEN** the second run SHALL produce no additional changes
- **AND** existing glossary links SHALL remain valid Markdown

---

### Requirement: CI and pre-commit MUST enforce all three rollout phases

The implementation SHALL include all three rollout phases:

- Phase 1 changed-term / changed-post ratchet
- Phase 2 full-site report plus safe backfill support
- Phase 3 full-site hard gate in CI

#### Scenario: changed glossary term checks existing posts

- **WHEN** a PR adds or changes an enabled glossary term
- **THEN** CI SHALL check all existing posts for missing coverage of that changed term
- **AND** the PR SHALL fail until matching posts contain a glossary link or explicit ignore

#### Scenario: changed post checks enabled glossary terms

- **WHEN** a PR adds or changes a post
- **THEN** CI SHALL check that post for all enabled glossary terms
- **AND** the PR SHALL fail if any safe occurrence lacks article-level glossary coverage

#### Scenario: full-site CI gate catches historical drift

- **WHEN** any enabled glossary term appears in any post body without article-level coverage
- **THEN** `pnpm run glossary:check` SHALL fail in CI
- **AND** SHALL provide actionable output for backfill or ignore
