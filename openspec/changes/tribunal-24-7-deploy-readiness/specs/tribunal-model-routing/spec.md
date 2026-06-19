## ADDED Requirements

### Requirement: Each tribunal role SHALL resolve its provider and model independently

The tribunal SHALL select the LLM provider and model per role, not once globally for all roles. The writer, rewriter, and vibe scorer SHALL run on Claude Opus 4.5; the fact-checker, librarian, fresh-eyes judge, and the orchestrator/supervisor SHALL run on Codex GPT-5.5.

#### Scenario: Writer and vibe run on Opus 4.5

- **WHEN** the tribunal invokes the writer/rewriter or the vibe scorer
- **THEN** it SHALL execute on Claude `claude-opus-4-5`

#### Scenario: Other judges and orchestrator run on GPT-5.5

- **WHEN** the tribunal invokes fact-checker, librarian, fresh-eyes, or the supervisor loop
- **THEN** it SHALL execute on Codex `gpt-5.5`

#### Scenario: Roles do not share one global provider

- **WHEN** both `codex` and `claude` CLIs are present
- **THEN** the presence of one SHALL NOT force every role onto a single provider

### Requirement: Codex execution SHALL honor the per-role declared model

The codex execution path SHALL read the model from the role's `.codex/agents/<role>.toml` `model` field rather than a hardcoded CLI flag, and SHALL NOT instruct the model to ignore its declared model. It SHALL default to `gpt-5.5` only when no model is declared.

#### Scenario: Declared codex model is used

- **WHEN** a codex role has a `model` field in its agent spec
- **THEN** that model SHALL be passed to the codex CLI
- **AND** no prompt line SHALL instruct the model to ignore it

### Requirement: Missing provider CLI SHALL fail loudly, not silently reroute

When a role's required provider CLI is absent, the tribunal SHALL fail that role with a clear error rather than silently rerouting all roles onto the other provider.

#### Scenario: Required CLI absent

- **WHEN** a role requires `claude` but `claude` is not on PATH
- **THEN** the tribunal SHALL emit an explicit error for that role
- **AND** SHALL NOT silently move every role to codex
