## MODIFIED Requirements

### Requirement: Each scoring dimension SHALL be owned by exactly one judge, version-gated

The tribunal scoring system SHALL assign every scoring dimension to exactly one judge. Dimension ownership SHALL be selected by the post's `tribunalVersion`: posts at `tribunalVersion >= 9` use the new ownership; posts at `tribunalVersion <= 8` use the legacy clarity ownership. The persona-note dimension SHALL be named `moguNote` at every version after the taxonomy migration.

#### Scenario: Vibe owns four dimensions at version 9+

- **WHEN** a post is scored at `tribunalVersion >= 9`
- **THEN** the Vibe judge SHALL own exactly `persona`, `moguNote`, `vibe`, `narrative`
- **AND** the Vibe judge SHALL NOT score `clarity`

#### Scenario: Fresh Eyes owns five dimensions at version 9+

- **WHEN** a post is scored at `tribunalVersion >= 9`
- **THEN** the Fresh Eyes judge SHALL own exactly `readability`, `firstImpression`, `payoffDensity`, `lengthFit`, `clarity`
- **AND** `clarity` SHALL retain its meaning of pronoun / voice attribution
- **AND** `clarity` and `readability` SHALL be scored as two independent dimensions

#### Scenario: Legacy clarity ownership preserved at version 8 and below

- **WHEN** a post is scored or read at `tribunalVersion <= 8`
- **THEN** the Vibe judge SHALL own `persona`, `moguNote`, `vibe`, `clarity`, `narrative`
- **AND** the Fresh Eyes judge SHALL own `readability`, `firstImpression`, `payoffDensity`, `lengthFit`
- **AND** `clawdNote` SHALL NOT be accepted as an alias

### Requirement: Per-judge composite SHALL be the floored mean of that judge's owned dimensions, version-aware

Each judge's composite SHALL be computed as `floor(sum(owned dimensions) / count(owned dimensions))`, where the owned dimension set is resolved by `tribunalVersion`.

#### Scenario: Vibe composite over four dimensions at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Vibe dims persona/moguNote/vibe/narrative
- **THEN** the Vibe composite SHALL equal `floor((persona + moguNote + vibe + narrative) / 4)`

#### Scenario: Fresh Eyes composite over five dimensions at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Fresh Eyes dims readability/firstImpression/payoffDensity/lengthFit/clarity
- **THEN** the Fresh Eyes composite SHALL equal `floor((readability + firstImpression + payoffDensity + lengthFit + clarity) / 5)`

#### Scenario: Legacy composites unchanged at version 8 and below

- **WHEN** a `tribunalVersion <= 8` post is read after key migration
- **THEN** the Vibe composite SHALL equal `floor(sum(5 vibe dims, including moguNote) / 5)`
- **AND** the Fresh Eyes composite SHALL equal `floor(sum(4 fresh eyes dims) / 4)`

### Requirement: The floor commit gate SHALL require the version-resolved Vibe dimension set

The pre-commit floor gate SHALL require `scores.vibe` to contain every Vibe-owned dimension for the post's `tribunalVersion` and a composite >= 3. A reader-visible post missing any required Vibe dimension SHALL be blocked from commit.

#### Scenario: Version 9+ post requires four vibe dimensions

- **WHEN** a new or reader-visible-edited `tribunalVersion >= 9` zh-tw post is committed
- **THEN** the floor gate SHALL require persona/moguNote/vibe/narrative present AND composite >= 3
- **AND** SHALL NOT require `clarity` under `scores.vibe`

#### Scenario: Version 8 post still requires five vibe dimensions

- **WHEN** a reader-visible-edited `tribunalVersion <= 8` zh-tw post is committed
- **THEN** the floor gate SHALL require persona/moguNote/vibe/clarity/narrative present AND composite >= 3

#### Scenario: Missing a required dimension blocks the commit

- **WHEN** a gated post is missing one of its version-required Vibe dimensions
- **THEN** the commit SHALL be blocked

## REMOVED Requirements

### Requirement: Existing posts SHALL remain valid without modification

**Reason**: 本 change 明確選擇一次性全 corpus migration，舊 frontmatter 不再 grandfather。保留這條會和 `clawdNote` 退役契約衝突。

## ADDED Requirements

### Requirement: Existing scored posts SHALL remain semantically valid after deterministic key migration

Every active scored post SHALL migrate `clawdNote` to `moguNote` without changing the numeric score, `tribunalVersion`, clarity ownership, composite or pass/fail outcome.

#### Scenario: Version 8 post migrates its persona-note key

- **WHEN** a `tribunalVersion <= 8` post with Vibe clarity is migrated
- **THEN** only `clawdNote` SHALL become `moguNote`
- **AND** `clarity` SHALL remain under Vibe
- **AND** the composite and publish-bar result SHALL remain unchanged

#### Scenario: Version 9 post migrates its persona-note key

- **WHEN** a `tribunalVersion >= 9` post is migrated
- **THEN** `moguNote` SHALL replace `clawdNote`
- **AND** `clarity` SHALL remain under Fresh Eyes
- **AND** the composite and publish-bar result SHALL remain unchanged
