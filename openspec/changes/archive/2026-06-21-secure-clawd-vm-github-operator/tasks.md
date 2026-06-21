## 1. Verify current access and scopes

- [x] 1.1 確認 browser session 已登入 GitHub account `chitienhsiehwork-ai`
- [x] 1.2 確認 mac-cdx 與 clawd-vm 目前的 `gh` auth status
- [x] 1.3 記錄目前 gu-log remote owner 與 branch protection state，不修改 settings

## 2. 定義並建立安全 token lanes

- [x] 2.1 建立或確認新的 AI lab GitHub org，preferred name 為 `shroomdog-ai-lab`
- [x] 2.2 建立或 refresh broad Iris / Clawd operator token，且只 scope 到 AI lab org
- [x] 2.3 確認 broad AI lab token 不包含 `chitienhsiehwork-ai/gu-log`
- [x] 2.4 建立或 refresh gu-log selected-repo token，權限為 Contents write、Pull requests write、Issues write、Metadata read，以及必要的 Actions/checks read
- [x] 2.5 確認 gu-log token 沒有 Administration、Workflows write、Secrets/Variables write
- [x] 2.6 確認 gu-log token 不能 delete repo、transfer repo、alter visibility、change branch protection、edit rulesets、或 edit `.github/workflows/**`
- [x] 2.7 Token values 只能存在 approved secret store 或 environment，永遠不要寫進 repo 或 machine notes

## 3. Protect gu-log repository

- [x] 3.1 設定 gu-log main branch protection/ruleset，要求 PR 與 required checks
- [x] 3.2 確保 force push 與 branch deletion 被 blocked
- [x] 3.3 確保 clawd-vm automation token 不能 bypass branch protection
- [x] 3.4 確保 branch merge 前必須 up to date
- [x] 3.5 記錄 auto-merge guard 需要的 required check names

## 4. Implement auto-merge guard

- [x] 4.1 為 content/glossary lane 定義 low-risk path allowlist
- [x] 4.2 對 `.github/**`、workflow、secret、deployment、branch protection、package manager config/lockfile、auth/env handling、guard-code paths deny auto-merge
- [x] 4.3 Merge 前要求 CI green、branch up to date、PR state mergeable
- [x] 4.4 對 allowed PRs 使用 GitHub auto-merge，採 squash merge 並 delete branch
- [x] 4.5 記錄 auto-merge decisions，包含 PR number、checks、paths、decision、actor
- [x] 4.6 用 safe draft PR 與 denied sensitive-path PR 做 smoke test

## 5. Record machine-specific knowledge

- [x] 5.1 為 mac-cdx 與 clawd-vm context 新增 local-only machine note
- [x] 5.2 記錄 clawd-vm hosts Clawd (OpenClaw) 與 Iris (Hermes agent)
- [x] 5.3 記錄這台 Mac 持有 clawd-vm 所需 private SSH path/context
- [x] 5.4 在 global Codex instructions 加入指向 local-only machine note 的 pointer
- [x] 5.5 確認沒有寫入 token values 或 private keys

Notes:
- Detailed evidence now lives next to each spec:
  - `specs/github-ai-operator-permissions/evidence/2026-05-07-clawd-vm-token-capabilities.md`
  - `specs/github-ai-automerge-guard/evidence/2026-05-07-ruleset-pr-checks-and-smoke.md`
  - `specs/machine-operator-memory/evidence/2026-05-07-machine-note-and-secret-handling.md`
- Required branch-protection check name is `ci-passed` from workflow `PR Fast Gate`.
- clawd-vm gu-log selected token includes `gu-log-api` as a user-approved selected-repo scope expansion; spec now requires explicit human approval + evidence for this kind of expansion.
- Token values are intentionally absent from OpenSpec, machine notes, and repo files.
