## Why

clawd-vm 上的 Iris / Clawd 需要能代表 GitHub AI account 做 open-source repo automation，例如開 PR、管理 CI/CD、建立實驗 repo。可是 gu-log 不能暴露在 prompt injection 可以刪 repo、transfer repo、或修改 branch protection 的權限下。

這個 change 將 clawd-vm GitHub operator 權限設計成 OpenSpec contract：AI 可以幫忙工作，但不能拿到足以把 gu-log 整包送人的鑰匙。這是很基本的職業安全感，不是 paranoia。

## What Changes

- 定義 `chitienhsiehwork-ai` 作為 AI GitHub account 的操作邊界。
- 建立新的 AI lab GitHub org（暫定 `shroomdog-ai-lab`）作為 Iris / Clawd broad operator token 的唯一作用範圍。
- 定義 gu-log selected-repo token 的最小權限，且 `chitienhsiehwork-ai/gu-log` 不得放進 broad admin token 範圍。
- 明確禁止 delete repo、transfer repo、修改 gu-log branch protection。
- 定義 AI lab / sandbox repo 可以有較寬權限，用於開新 repo、CI/CD、repo secrets / variables、issues / PRs / Actions / workflows；production gu-log repo 必須最小化權限。
- 定義 PR auto-merge 僅能在 CI green、branch protection、path guard 通過後執行。
- 記錄 mac-cdx / clawd-vm / Iris / Clawd 的 machine-specific knowledge，但不記錄任何 secret。

## Capabilities

### New Capabilities

- `github-ai-operator-permissions`: 定義 AI GitHub account token、repo scope、禁止權限與 rotation 原則。
- `github-ai-automerge-guard`: 定義 gu-log auto-merge 的 CI、branch protection、path guard、audit 要求。
- `machine-operator-memory`: 定義 mac-cdx 與 clawd-vm 的 machine-specific 記憶放置位置，以及不可寫入 secret 的規則。

### Modified Capabilities

（無。此 change 新增 GitHub operator safety contract，不修改既有 specs。）

## Impact

- clawd-vm GitHub token setup
- New AI lab GitHub organization，例如 `shroomdog-ai-lab`
- GitHub AI account `chitienhsiehwork-ai`
- gu-log repository branch protection / ruleset
- clawd-vm automation for Iris / Clawd
- dotfiles 內的 local Codex machine memory
- 未來的 auto-merge scripts 或 GitHub Actions
