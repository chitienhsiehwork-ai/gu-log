## ADDED Requirements

### Requirement: Machine-specific operational memory SHALL be local-only

Machine-specific facts for mac-cdx and clawd-vm SHALL be stored in a local-only ignored file, not in public project docs.

#### Scenario: Record clawd-vm roles

- **WHEN** the operator records that clawd-vm hosts Clawd and Iris
- **THEN** the record SHALL live in a local-only machine note
- **AND** it SHALL NOT be committed to gu-log public docs

### Requirement: Machine memory SHALL NOT contain secrets

Machine memory MUST NOT contain private keys, token values, passwords, recovery codes, or other credential material.

#### Scenario: Recording GitHub token policy

- **WHEN** machine memory documents token purpose or rotation date
- **THEN** it MAY record token name and scope summary
- **AND** it SHALL NOT record the token value

### Requirement: Global Codex instructions SHALL point to machine memory when local context exists

`~/.codex/AGENTS.md` SHALL include a short pointer to the local-only machine note when this Mac has local clawd-vm context, so local Codex sessions know where to find machine-specific information.

#### Scenario: Codex starts on mac-cdx

- **WHEN** Codex reads global instructions on this Mac
- **THEN** it SHALL be able to discover the local machine note location
- **AND** the global instruction SHALL remind agents not to write secrets into that note
