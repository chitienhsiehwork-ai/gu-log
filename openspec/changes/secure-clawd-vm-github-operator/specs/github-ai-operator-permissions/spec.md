## ADDED Requirements

### Requirement: gu-log token SHALL be selected-repository and least-privilege

Any GitHub token placed on clawd-vm for gu-log automation SHALL be scoped only to the gu-log repository and SHALL include only permissions needed for branch, commit, PR, status, and check inspection workflows.

#### Scenario: Token is created for gu-log

- **WHEN** an operator creates a GitHub token for gu-log automation
- **THEN** the token SHALL be selected-repository scoped to gu-log
- **AND** it SHALL NOT include unrelated repositories

### Requirement: gu-log token SHALL NOT include destructive repository administration

The gu-log automation token MUST NOT include permission to delete repositories, transfer repositories, change repository visibility, change branch protection, change rulesets, or bypass required reviews/checks.

#### Scenario: Prompt injection requests repository transfer

- **WHEN** an AI agent receives instructions to transfer gu-log to another account
- **THEN** the token SHALL be unable to perform the transfer
- **AND** the attempted operation SHALL fail at the GitHub permission layer

#### Scenario: Prompt injection requests branch protection removal

- **WHEN** an AI agent receives instructions to remove gu-log branch protection
- **THEN** the token SHALL be unable to change branch protection or rulesets

### Requirement: Sandbox repository tokens MAY have broader scope outside gu-log

Separate AI lab or sandbox repository tokens MAY have broader repo creation or administration permissions, but those tokens SHALL NOT have admin scope over gu-log.

#### Scenario: AI creates an experimental repo

- **WHEN** Iris or Clawd needs to create a new experimental open-source repo
- **THEN** it MAY use the AI lab token
- **AND** that token SHALL NOT grant destructive permissions over gu-log

### Requirement: Tokens SHALL be named and rotated audibly

GitHub tokens used by clawd-vm SHALL have descriptive names and documented rotation dates in secret-free machine notes.

#### Scenario: Token is rotated

- **WHEN** an operator rotates a clawd-vm token
- **THEN** the machine note SHALL record the token purpose and rotation date
- **AND** it SHALL NOT record the token value
