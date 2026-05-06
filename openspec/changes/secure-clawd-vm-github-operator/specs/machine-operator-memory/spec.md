## ADDED Requirements

### Requirement: Machine-specific operational memory SHALL 是 local-only

mac-cdx 與 clawd-vm 的 machine-specific facts SHALL 存在 local-only ignored file，而不是 public project docs。

#### Scenario: Record clawd-vm roles

- **WHEN** operator 記錄 clawd-vm hosts Clawd and Iris
- **THEN** 該 record SHALL 存在 local-only machine note
- **AND** 該 record SHALL NOT 被 commit 到 gu-log public docs

### Requirement: Machine memory SHALL NOT contain secrets

Machine memory MUST NOT 包含 private keys、token values、passwords、recovery codes、或其他 credential material。

#### Scenario: Recording GitHub token policy

- **WHEN** machine memory 記錄 token purpose 或 rotation date
- **THEN** machine memory MAY 記錄 token name 與 scope summary
- **AND** machine memory SHALL NOT 記錄 token value

### Requirement: Global Codex instructions SHALL 在 local context 存在時指向 machine memory

當這台 Mac 有 local clawd-vm context 時，`~/.codex/AGENTS.md` SHALL 包含指向 local-only machine note 的 short pointer，讓 local Codex sessions 知道去哪裡找 machine-specific information。

#### Scenario: Codex starts on mac-cdx

- **WHEN** Codex 在這台 Mac 讀取 global instructions
- **THEN** Codex SHALL 能 discover local machine note location
- **AND** global instruction SHALL remind agents 不要把 secrets 寫進該 note
