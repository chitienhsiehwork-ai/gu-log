# tribunal-scoring-dimensions Specification

## Purpose

定義 Tribunal scoring dimensions 的單一 judge ownership、version-aware composite 與 pass／floor gates，並確保 dimension migration 不破壞既有文章分數語意。

## Requirements

### Requirement: Each scoring dimension SHALL be owned by exactly one judge, version-gated

The tribunal scoring system SHALL assign every scoring dimension to exactly one judge. Dimension ownership SHALL be selected by the post's `tribunalVersion`: posts at `tribunalVersion >= 9` use the new ownership; posts at `tribunalVersion <= 8` use the legacy clarity ownership. The persona-note dimension SHALL be named `moguNote` at every version after the taxonomy migration.

#### Scenario: Vibe owns four dimensions at version 9+

- **WHEN** a post is scored at `tribunalVersion >= 9`
- **THEN** the Vibe judge SHALL own exactly `persona`, `moguNote`, `vibe`, `narrative`
- **AND** the Vibe judge SHALL NOT score `clarity`

#### Scenario: Fresh Eyes owns five dimensions at version 9+

- **WHEN** a post is scored at `tribunalVersion >= 9`
- **THEN** the Fresh Eyes judge SHALL own exactly `readability`, `firstImpression`, `payoffDensity`, `lengthFit`, `clarity`
- **AND** `clarity` SHALL retain its meaning of pronoun / voice attribution (each sentence makes it obvious who is speaking)
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

### Requirement: Vibe pass bar SHALL evaluate over the version-resolved dimension set

The Vibe pass bar SHALL be: composite >= 8 AND at least one owned dimension >= 9 AND no owned dimension < 8. The owned dimension set is resolved by `tribunalVersion`.

#### Scenario: Vibe passes over four dimensions at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Vibe composite >= 8, at least one of the 4 dims >= 9, and no dim < 8
- **THEN** the Vibe stage SHALL pass

#### Scenario: Vibe fails when any owned dimension is below 8

- **WHEN** a `tribunalVersion >= 9` post has a Vibe dimension < 8
- **THEN** the Vibe stage SHALL fail regardless of composite

### Requirement: Fresh Eyes pass bar SHALL include a non-compensating clarity gate at version 9+

For `tribunalVersion >= 9`, the Fresh Eyes pass bar SHALL be: composite >= 8 AND `payoffDensity` >= 8 AND `lengthFit` >= 8 AND `clarity` >= 8. Each gated dimension is non-compensating: a value below 8 fails the stage even if the composite is >= 8. For `tribunalVersion <= 8`, the legacy bar (composite >= 8 AND payoffDensity >= 8 AND lengthFit >= 8) SHALL apply with no clarity gate.

#### Scenario: Low clarity fails Fresh Eyes despite high composite at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Fresh Eyes composite >= 8 but `clarity` = 7
- **THEN** the Fresh Eyes stage SHALL fail

#### Scenario: Fresh Eyes passes when all gates met at version 9+

- **WHEN** a `tribunalVersion >= 9` post has composite >= 8 AND payoffDensity >= 8 AND lengthFit >= 8 AND clarity >= 8
- **THEN** the Fresh Eyes stage SHALL pass

#### Scenario: Legacy Fresh Eyes bar has no clarity gate

- **WHEN** a `tribunalVersion <= 8` post is evaluated
- **THEN** the Fresh Eyes pass bar SHALL NOT require a `clarity` dimension

### Requirement: The floor commit gate SHALL require the version-resolved Vibe dimension set

The pre-commit floor gate SHALL require `scores.vibe` to contain every Vibe-owned dimension for the post's `tribunalVersion` and a composite >= 3 (composite = floor(sum / count)). A reader-visible post missing any required Vibe dimension SHALL be blocked from commit.

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

### Requirement: Librarian pass bar SHALL 只看 composite

Librarian SHALL 在每個 `tribunalVersion` 都擁有 `glossary`、`crossRef`、`sourceAlign`、`attribution` 四維，composite 照〈Per-judge composite〉計算。Librarian stage SHALL 在 composite >= 8 時過關；單一維度 SHALL NOT 另設門檻。

#### Scenario: 單一低分維度被 composite 補回來

- **WHEN** Librarian 的 glossary、crossRef、sourceAlign 都是 10，attribution 是 2
- **THEN** composite SHALL 是 8
- **AND** Librarian stage SHALL 過關

#### Scenario: composite 低於 8

- **WHEN** Librarian 的 glossary 7、crossRef 7、sourceAlign 8、attribution 9
- **THEN** composite SHALL 是 7
- **AND** Librarian stage SHALL 不過關

### Requirement: Fact Checker pass bar SHALL 分開檢查核心 composite 與兩個邊界維度

Fact Checker SHALL 擁有 `accuracy`、`fidelity`、`consistency`、`sourceBoundary`、`commentarySeparation` 五維，composite 照〈Per-judge composite〉計算。Fact Checker stage SHALL 只在三個條件都成立時過關：`floor((accuracy + fidelity + consistency) / 3) >= 8`、`sourceBoundary >= 8`、`commentarySeparation >= 8`。兩個邊界維度 SHALL 不能被其他維度補償。

#### Scenario: 核心三維 floor 到 8

- **WHEN** accuracy 7、fidelity 8、consistency 9，sourceBoundary 與 commentarySeparation 都是 8
- **THEN** Fact Checker stage SHALL 過關

#### Scenario: 核心三維 floor 到 7

- **WHEN** accuracy 7、fidelity 7、consistency 9，sourceBoundary 與 commentarySeparation 都是 10
- **THEN** Fact Checker stage SHALL 不過關

#### Scenario: 邊界維度低於 8

- **WHEN** 核心三維都是 10，但 `sourceBoundary` 或 `commentarySeparation` 是 7
- **THEN** Fact Checker stage SHALL 不過關

### Requirement: Tribunal PASS SHALL 要求四位評審都過關

一篇文章 SHALL 只在 Vibe、Fact Checker、Librarian、Fresh Eyes 四位評審都有分數，而且各自依文章的 `tribunalVersion` 通過自己的 pass bar 時，才算達到 Tribunal PASS bar（首頁與 featured 用的 publish bar）。評審之間 SHALL NOT 互相補償。Tribunal runner 逐關判定的 gate 與網站判定 publish bar 的邏輯，對同一份分數 SHALL 得到相同結果。

#### Scenario: 一位評審沒過

- **WHEN** 三位評審都過關且 composite 很高，第四位沒過自己的 pass bar
- **THEN** 這篇文章 SHALL 不算 PASS

#### Scenario: 缺一位評審的分數

- **WHEN** 文章的 scores 缺 Vibe、Fact Checker、Librarian、Fresh Eyes 其中任何一位
- **THEN** 這篇文章 SHALL 不算 PASS

#### Scenario: runner 與網站對同一份分數的判定一致

- **WHEN** 同一份評審分數分別交給 Tribunal runner 的 gate 與網站的 publish bar 判定
- **THEN** 兩邊對每位評審過不過關、整篇算不算 PASS SHALL 得到相同結果
