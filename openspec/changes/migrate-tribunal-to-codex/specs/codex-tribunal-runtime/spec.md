## ADDED Requirements

### Requirement: Tribunal v4 SHALL use Codex GPT-5.5 for all judge stages

The canonical tribunal runner SHALL execute Librarian, FactChecker, FreshEyes, and VibeScorer through `codex exec` using model `gpt-5.5`. Historical Claude/Opus agent metadata MAY remain as calibration context, but SHALL NOT be treated as runtime model selection.

#### Scenario: Full tribunal run

- **WHEN** an operator runs the canonical tribunal runner for one post
- **THEN** each judge stage SHALL execute through Codex/GPT-5.5
- **AND** frontmatter score metadata SHALL record runtime model `gpt-5.5`

#### Scenario: Single-stage run

- **WHEN** an operator runs `scripts/tribunal.sh --only-stage vibe <post>`
- **THEN** only the VibeScorer stage SHALL run
- **AND** that stage SHALL execute through Codex/GPT-5.5

### Requirement: `scripts/tribunal.sh` SHALL be the canonical tribunal entrypoint

The canonical single-post tribunal entrypoint SHALL be `scripts/tribunal.sh`. Legacy entrypoints such as `scripts/tribunal-all-claude.sh` MAY remain as wrappers but SHALL delegate to the canonical runner.

#### Scenario: Legacy wrapper invocation

- **WHEN** an existing automation invokes `scripts/tribunal-all-claude.sh <post>`
- **THEN** the wrapper SHALL delegate to `scripts/tribunal.sh <post>`
- **AND** the run SHALL use the same Codex/GPT-5.5 runtime as the canonical command

### Requirement: Tribunal score transfer SHALL use explicit score files

Each tribunal judge SHALL write its JSON score to an explicit score file path provided by the runner. The runner SHALL validate the JSON schema before writing frontmatter score metadata.

#### Scenario: Judge returns malformed JSON

- **WHEN** the judge fails to write valid score JSON
- **THEN** the stage SHALL fail validation
- **AND** the runner SHALL NOT write partial or untrusted score metadata to the post

### Requirement: VibeScorer compatibility wrapper SHALL preserve legacy output

`scripts/vibe-scorer.sh` SHALL delegate to the canonical tribunal vibe stage while preserving the legacy JSON output path contract expected by older callers.

#### Scenario: Legacy vibe scorer caller passes output path

- **WHEN** an older script calls `scripts/vibe-scorer.sh <post> <output-path>`
- **THEN** the wrapper SHALL run `scripts/tribunal.sh --only-stage vibe <post>`
- **AND** it SHALL write the resulting vibe score JSON to `<output-path>`
