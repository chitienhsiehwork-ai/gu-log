# Evidence: machine note 與 secret handling

Date: 2026-05-07  
Scope: `secure-clawd-vm-github-operator` / `machine-operator-memory`

## Machine Notes

- live machine note：`~/.codex/machine.md`
- dotfiles bootstrap copy：`/Users/shroom/dotfiles/codex/machine.md`
- global Codex instructions：`~/.codex/AGENTS.md` 指向 `~/.codex/machine.md`

machine note 記錄：

- `mac-cdx` 是這台 Mac。
- `clawd-vm` 是可透過 SSH 到達的 remote VM。
- clawd-vm hosts Clawd (OpenClaw) 與 Iris (Hermes agent)。
- gu-log token policy：selected-repo、no Administration、no Workflows write、no Secrets/Variables write。
- broad AI lab token policy：只屬於 AI lab org，不包含 gu-log owner lane。
- global Git hook policy：`.md` prose 預設繁中比例檢查。

## Secret Handling Evidence

- clawd-vm token files 權限皆為 `600 clawd clawd`。
- evidence 命令只用 API metadata 與檔案 mode/owner/size 驗證，沒有輸出 token value。
- repo evidence 只記錄 token purpose、path、capability result，不記錄 token value 或 prefix。

## Review Notes

- dotfiles 的 `codex/machine.md` 是 secret-free bootstrap，不是 token store。
- `~/.codex/machine.md` 可以保存 machine-specific facts，但同樣 MUST NOT 保存 token value、private key、recovery code。
