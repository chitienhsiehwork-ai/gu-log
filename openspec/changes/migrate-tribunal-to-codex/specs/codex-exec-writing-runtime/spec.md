## ADDED Requirements

### Requirement: SP pipeline SHALL use Codex GPT-5.5 as the default real writer runtime

The SP pipeline SHALL route real writing, refine, review, and probe LLM calls through Codex using GPT-5.5 unless an explicit test fake is requested. Legacy CLI names MAY remain for compatibility but SHALL NOT change the default real routing away from Codex.

#### Scenario: Default writer chain

- **WHEN** an operator runs the SP pipeline without fake/test flags
- **THEN** the pipeline SHALL invoke `codex exec` with model `gpt-5.5`
- **AND** the pipeline SHALL NOT invoke `claude -p` for real writing steps

#### Scenario: Legacy flag compatibility

- **WHEN** an existing command passes a legacy model-selection flag
- **THEN** the CLI MAY accept the flag for compatibility
- **AND** the real default provider SHALL remain Codex/GPT-5.5 unless the flag explicitly selects a fake/test provider

### Requirement: Codex writer output SHALL be captured without CLI noise

The SP pipeline SHALL capture the final Codex assistant output through a deterministic mechanism such as `codex exec -o <file>` or an equivalent output file protocol. Stdout SHALL NOT be treated as article body unless the implementation strips CLI logs with a tested extractor.

#### Scenario: Codex emits banner or warning text

- **WHEN** Codex writes non-article text to stdout or stderr
- **THEN** the pipeline SHALL exclude that text from generated MDX and JSON artifacts
- **AND** generated article content SHALL contain only the intended final answer

#### Scenario: Output capture is unavailable

- **WHEN** the installed Codex CLI does not support the preferred output flag
- **THEN** the pipeline SHALL fail with an actionable error or use a tested fallback extractor
- **AND** it SHALL NOT silently write mixed CLI logs into article files
