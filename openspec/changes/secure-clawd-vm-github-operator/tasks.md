## 1. Verify current access and scopes

- [x] 1.1 確認 browser session 已登入 GitHub account `chitienhsiehwork-ai`
- [x] 1.2 確認 mac-cdx 與 clawd-vm 目前的 `gh` auth status
- [x] 1.3 記錄目前 gu-log remote owner 與 branch protection state，不修改 settings

## 2. 定義並建立安全 token lanes

- [ ] 2.1 建立或確認新的 AI lab GitHub org，preferred name 為 `shroomdog-ai-lab`
- [ ] 2.2 建立或 refresh broad Iris / Clawd operator token，且只 scope 到 AI lab org
- [ ] 2.3 確認 broad AI lab token 不包含 `chitienhsiehwork-ai/gu-log`
- [ ] 2.4 建立或 refresh gu-log selected-repo token，權限為 Contents write、Pull requests write、Issues write、Metadata read，以及必要的 Actions/checks read
- [ ] 2.5 確認 gu-log token 沒有 Administration、Workflows write、Secrets/Variables write
- [ ] 2.6 確認 gu-log token 不能 delete repo、transfer repo、alter visibility、change branch protection、edit rulesets、或 edit `.github/workflows/**`
- [ ] 2.7 Token values 只能存在 approved secret store 或 environment，永遠不要寫進 repo 或 machine notes

## 3. Protect gu-log repository

- [ ] 3.1 設定 gu-log main branch protection/ruleset，要求 PR 與 required checks
- [ ] 3.2 確保 force push 與 branch deletion 被 blocked
- [ ] 3.3 確保 clawd-vm automation token 不能 bypass branch protection
- [ ] 3.4 確保 branch merge 前必須 up to date
- [x] 3.5 記錄 auto-merge guard 需要的 required check names

## 4. Implement auto-merge guard

- [x] 4.1 為 content/glossary lane 定義 low-risk path allowlist
- [x] 4.2 對 `.github/**`、workflow、secret、deployment、branch protection、package manager config/lockfile、auth/env handling、guard-code paths deny auto-merge
- [x] 4.3 Merge 前要求 CI green、branch up to date、PR state mergeable
- [x] 4.4 對 allowed PRs 使用 GitHub auto-merge，採 squash merge 並 delete branch
- [x] 4.5 記錄 auto-merge decisions，包含 PR number、checks、paths、decision、actor
- [ ] 4.6 用 safe draft PR 與 denied sensitive-path PR 做 smoke test

## 5. Record machine-specific knowledge

- [x] 5.1 為 mac-cdx 與 clawd-vm context 新增 local-only machine note
- [x] 5.2 記錄 clawd-vm hosts Clawd (OpenClaw) 與 Iris (Hermes agent)
- [x] 5.3 記錄這台 Mac 持有 clawd-vm 所需 private SSH path/context
- [x] 5.4 在 global Codex instructions 加入指向 local-only machine note 的 pointer
- [x] 5.5 確認沒有寫入 token values 或 private keys

Notes:
- Browser session 已確認登入 GitHub account `chitienhsiehwork-ai`；user 也提供 `https://github.com/chitienhsiehwork-ai/gu-log/settings/branches` 截圖。
- mac-cdx `gh auth status` 與 clawd-vm `gh auth status` 目前都回報 `chitienhsiehwork-ai` token invalid。mac-cdx 曾嘗試 `gh auth login -h github.com -p https -w -s repo,workflow,admin:repo_hook`，流程到達 GitHub device verification，但 browser 需要 session verification；該流程已停止，沒有暴露任何 token。
- `origin` 目前指向 `https://github.com/chitienhsiehwork-ai/gu-log.git`。
- 2026-05-06 的 branch settings 截圖顯示 gu-log："Classic branch protections have not been configured"。Branch protection/ruleset mutation 仍未勾選，因為 authenticated API token invalid，且 browser automation 不能安全地自主完成 session verification。
- Required branch-protection check name 應為 workflow `PR Fast Gate`（`.github/workflows/ci.yml`）中的 `ci-passed`。這個 aggregate job 依賴 lockfile、lint、type-check、contrast、validate-content、security-gate、unit-tests、build、internal-links、bundle-budget。
- `scripts/gu-log-auto-merge-guard.sh` 實作 local guard：PR 必須 open、non-draft、base `main`、GitHub-mergeable、required checks green、changed paths allowlisted。只有 guard pass 後才執行 `gh pr merge --auto --squash --delete-branch`。
- `scripts/tests/test-auto-merge-guard.sh` smoke-tests local guard：allowed content/glossary PR、denied `.github/**` PR、denied lockfile PR、denied failing-check PR。剩下的 4.6 task 專指 safe credentials/rulesets 存在後，做 real GitHub PR smoke。
- AI lab org creation、token creation、token scope verification、branch protection changes、real GitHub PR auto-merge guard smoke tests 仍刻意未勾選，因為這些需要 session verification / one-time token handling，不能洩漏進 repo、machine notes 或 chat context。
