## MODIFIED Requirements

### Requirement: Machine-specific operational memory SHALL 是 local-only

Local machine actor（例如 `m1-cdx`）與 legacy `clawd-vm` coordinate 的 machine-specific facts SHALL 存在 local machine note；若 dotfiles 提供 bootstrap copy，內容 MUST secret-free，且不得把 token value 或 private key 寫進 public project docs。Machine note SHALL distinguish the host / Unix coordinate from the agent brand and record that the host runs Mogu (OpenClaw) and Iris.

#### Scenario: Record legacy clawd-vm roles

- **WHEN** operator 記錄 legacy `clawd-vm` coordinate hosts Mogu and Iris
- **THEN** 該 record SHALL 存在 local machine note
- **AND** SHALL distinguish the coordinate from the Mogu persona/operator name
- **AND** 該 record SHALL NOT 被 commit 到 gu-log public docs
- **AND** 該 record SHALL NOT contain credentials
