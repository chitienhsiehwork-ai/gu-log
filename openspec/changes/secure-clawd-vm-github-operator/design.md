## Context

使用者希望 Iris / Clawd 在 clawd-vm 上能幫忙管理 AI GitHub account 的工作，例如開 repo、管理 CI/CD、維護 open-source vibe-coding 專案。clawd-vm 沒有高價值秘密，但 gu-log 是長期作品，不能讓 prompt injection 透過 token 執行 delete / transfer / branch protection 修改。

目前本機 Chrome 已確認登入的是 `chitienhsiehwork-ai`；本機 `gh auth status` 顯示既有 token 失效。這個 change 不建立 token 本身，只定義安全權限與操作流程。

## Goals / Non-Goals

**Goals:**

- 讓 clawd-vm 可以用 AI account 做一般 repo automation。
- 保護 gu-log 免於 delete、transfer、force push、branch protection tampering。
- 允許低風險 PR auto-merge，但只在 CI green + path guard + branch protection 通過後。
- 把 machine-specific knowledge 記在 local-only dotfile，而不是散在聊天紀錄。

**Non-Goals:**

- 不在 repo 內保存 GitHub token 或 private key。
- 不在此 change 建立 GitHub org/repo/token；那些是人工或後續 operator task。
- 不給 clawd-vm gu-log repo administration 權限。
- 不讓 auto-merge 繞過 branch protection。

## Decisions

### 1. Split gu-log token from AI lab token

**Decision:** gu-log 使用 selected-repo fine-grained token，權限只足夠 branch/PR/commit/status 操作；AI lab / sandbox repo 可以另用較寬 token。

**Rejected alternative:** 一把 broad token 管所有 repo。  
**Reason:** 對 sandbox 方便，對 gu-log 太危險。方便到可以刪庫就不是方便，是懸崖附滑梯。

### 2. No Administration permission for gu-log token

**Decision:** gu-log token MUST NOT include repository Administration, repo deletion, transfer, branch protection/ruleset mutation, or Actions secrets/variables write.

**Rejected alternative:** 給 admin 權限後靠 prompt discipline。  
**Reason:** prompt discipline 不能當 security boundary。

### 3. Auto-merge is allowed only through guards

**Decision:** AI MAY auto-merge gu-log PR only if branch protection passes, required checks are green, PR diff matches allowlisted paths, and no workflow/secrets/config-sensitive files are touched.

**Rejected alternative:** CI green 就 auto-merge。  
**Reason:** CI 不一定能判斷「這個 PR 正在修改自己未來的安全邏輯」。

### 4. Machine memory is local-only and secret-free

**Decision:** machine-specific facts live in a local-only dotfile such as `codex/machine.md.local`, with `~/.codex/AGENTS.md` linking to it. It records host names, roles, and safety policy, but not secrets.

**Rejected alternative:** Put VM details and token notes directly in repo docs.  
**Reason:** machine facts are useful for this Mac but should not become project-wide public docs.

## Risks / Trade-offs

- **AI lab token too broad leaks into gu-log** → Keep separate token names, environment variables, and repo scopes.
- **Path guard misses sensitive file** → Deny by default for workflow, token, branch protection, deployment, package manager, and automation config paths.
- **Branch protection bypass via token** → Token MUST NOT be allowed to alter branch protection or bypass rules.
- **Machine note accidentally stores secret** → Add explicit "no secret" section and keep file ignored by git.

## Migration Plan

1. Create/update OpenSpec artifacts first.
2. Add local-only machine note and `~/.codex/AGENTS.md` pointer in a separate implementation step.
3. Manually create or refresh GitHub tokens according to this policy.
4. Configure gu-log branch protection/rulesets from the GitHub UI or a trusted human admin context.
5. Add auto-merge guard only after token scope and branch protection are verified.

## Open Questions

- Whether AI lab work should live under a new GitHub organization or the existing AI account namespace.
- Which CI check names are required for gu-log auto-merge once branch protection is reviewed.
