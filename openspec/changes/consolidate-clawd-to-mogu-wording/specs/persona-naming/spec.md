## ADDED Requirements

### Requirement: The gu-log commentary persona SHALL have exactly one canonical reader-facing name

The voice that speaks inside commentary note boxes SHALL be named `Mogu` in all reader-facing surfaces (rendered note prefixes, prose mentions, glossary entry, and author/about references). `Clawd` SHALL NOT be used as the reader-facing name of this persona in new content.

#### Scenario: New content uses the canonical name

- **WHEN** a new post or SSOT prompt authors a commentary note or names the persona in prose
- **THEN** it SHALL use `Mogu`
- **AND** SHALL NOT introduce a new reader-facing `Clawd` persona mention

#### Scenario: The glossary anchor resolves

- **WHEN** prose links the persona name to the glossary
- **THEN** the link target SHALL be `/glossary#mogu` (or `/en/glossary#mogu`)
- **AND** SHALL NOT target `/glossary#clawd`, which has no glossary entry

### Requirement: A single rendered page SHALL NOT show two names for the persona

No single rendered article page SHALL simultaneously display a `Mogu …` note prefix and a `Clawd …` note prefix (or prose persona mention) for the same commentary persona. When a page mixes `<MoguNote>` and `<ClawdNote>`, the rendered prefixes diverge into two names, which the reader cannot reconcile.

#### Scenario: Mixed-component page is a violation

- **WHEN** a post uses both `<MoguNote>` and `<ClawdNote>` in its body
- **THEN** this SHALL be treated as a naming-consistency violation to be resolved
- **AND** the resolution SHALL converge the page on a single persona name (`Mogu`)

#### Scenario: The known mixed page is named

- **WHEN** the consolidation work enumerates reader-visible inconsistencies
- **THEN** `src/content/posts/sd-26-20260616-loop-engineering-at-gu-log.mdx` and its `en-` pair SHALL be listed as mixed-prefix pages (4 `Clawd` prefixes + 1 `Mogu` prefix each at proposal time)

### Requirement: Content-gating tooling SHALL recognize MoguNote before any mass component migration

The content-gating checkers and tests that special-case the commentary component — `scripts/check-pronoun-clarity.mjs`, `scripts/check-jingjing.mjs`, `tests/content-integrity.spec.ts`, and `tests/content-gates.test.ts` — SHALL recognize `MoguNote` in addition to the legacy `ClawdNote`. This recognition SHALL land (Phase 0) before any change that migrates post imports from `ClawdNote` to `MoguNote` at scale.

#### Scenario: Pronoun checker masks MoguNote bodies

- **WHEN** a zh-tw post wraps `你`/`我` inside `<MoguNote> … </MoguNote>`
- **THEN** the pronoun-clarity checker SHALL mask that region (the speaker is explicit)
- **AND** SHALL NOT flag those pronouns as violations

#### Scenario: Redundant-prefix gate covers MoguNote

- **WHEN** a post writes a redundant `Mogu：` prefix immediately inside a `<MoguNote>` block (which the component already adds)
- **THEN** the content-integrity redundant-prefix check SHALL flag it
- **AND** the check SHALL apply the same rule it currently applies to `<ClawdNote>`

#### Scenario: Migration is gated on tooling readiness

- **WHEN** a change proposes to migrate post imports from `ClawdNote` to `MoguNote` in bulk
- **THEN** Phase 0 tooling recognition SHALL already be in place
- **AND** migrating before Phase 0 SHALL be rejected as it would break the pronoun and redundant-prefix gates

### Requirement: The persona rename SHALL NOT change the OpenClaw automation-agent identity

The rename SHALL apply to the gu-log commentary persona only. The OpenClaw / clawd-vm automation-agent identity ("Clawd (OpenClaw)") and the `scripts/clawd-picks-prompt.md` / `scripts/clawd-picks-config.json` pipeline filenames SHALL remain unchanged by this rename.

#### Scenario: VM agent identity untouched

- **WHEN** the rename is applied
- **THEN** references to the OpenClaw / clawd-vm agent (e.g. in `CLAUDE.md` and `secure-clawd-vm-github-operator`) SHALL remain `Clawd`
- **AND** the `clawd-picks-*` pipeline filenames SHALL NOT be renamed

#### Scenario: Series label already consistent

- **WHEN** the CP series label is read from `scripts/article-counter.json`
- **THEN** it SHALL already read `Mogu Picks`
- **AND** the rename SHALL NOT require changing it

### Requirement: The scores.vibe.clawdNote schema key SHALL remain a stable internal identifier

The frontmatter score-dimension key `scores.vibe.clawdNote` SHALL be treated as a stable internal identifier, exempt from the reader-facing naming rule. This change SHALL NOT rename it to `moguNote`.

#### Scenario: Schema key is not renamed

- **WHEN** the persona rename is applied
- **THEN** the `scores.vibe.clawdNote` key SHALL remain `clawdNote` in the Zod schema, validators, tribunal v2 types, frontmatter tooling, and the ~158 existing scored posts
- **AND** renaming it to `moguNote` SHALL be deferred to a separate schema-migration change

#### Scenario: Existing scored posts still validate

- **WHEN** an existing post carrying `scores.vibe.clawdNote` is validated after the rename
- **THEN** validation SHALL pass unchanged
- **AND** the post SHALL NOT be re-gated solely because the persona was renamed

### Requirement: Existing posts SHALL remain renderable via the legacy alias during grandfathering

Posts that still `import ClawdNote` SHALL continue to render unchanged. The `src/components/ClawdNote.astro` legacy alias (which wraps `MoguNote`) SHALL be retained for the grandfathering period so the ~1082 legacy posts are not force-migrated.

#### Scenario: Legacy post renders

- **WHEN** a grandfathered post imports and uses `<ClawdNote>`
- **THEN** it SHALL render via the legacy alias
- **AND** SHALL NOT require migration to `<MoguNote>` to remain valid

#### Scenario: Bulk codemod is opt-in and gated

- **WHEN** a maintainer chooses to migrate a batch of legacy posts to `<MoguNote>` plus Mogu prose
- **THEN** the codemod SHALL be opt-in (not a forced mass rewrite)
- **AND** SHALL run only after Phase 0 tooling recognition is in place
