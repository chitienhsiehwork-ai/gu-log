## Context

使用者希望 Iris / Clawd 在 clawd-vm 上能幫忙管理 AI GitHub account 的工作，例如開 repo、管理 CI/CD、維護 open-source vibe-coding 專案。clawd-vm 沒有高價值秘密，但 gu-log 是長期作品，不能讓 prompt injection 透過 token 執行 delete / transfer / branch protection 修改。

目前本機 Chrome 已確認登入的是 `chitienhsiehwork-ai`；本機 `gh auth status` 顯示既有 token 失效。這個 change 不建立 token 本身，只定義安全權限與操作流程。

使用者偏好的 operator lane 是：

- 新建 AI lab GitHub org，例如 `shroomdog-ai-lab`。
- Iris / Clawd 的 broad operator token 只作用在 AI lab org。
- `chitienhsiehwork-ai/gu-log` 不放進 broad admin token 範圍。
- gu-log 只使用 selected-repo token，且不得包含 Administration、Workflows write、Secrets/Variables write。

## Goals / Non-Goals

**Goals:**

- 讓 clawd-vm 可以用 AI account 做一般 repo automation，但 broad automation 只能在 AI lab org 內發生。
- 保護 gu-log 免於 delete、transfer、force push、branch protection tampering。
- 允許低風險 PR auto-merge，但只在 CI green + path guard + branch protection 通過後。
- 把 machine-specific knowledge 記在 local-only dotfile，而不是散在聊天紀錄。

**Non-Goals:**

- 不在 repo 內保存 GitHub token 或 private key。
- 不在此 change 實際建立 GitHub org/repo/token；那些是人工或後續 operator task。
- 不給 clawd-vm gu-log repo administration 權限。
- 不讓 auto-merge 繞過 branch protection。

## Decisions

### 1. 將 gu-log token 與 AI lab org token 分開

**Decision:** 建立新的 AI lab GitHub org（暫定 `shroomdog-ai-lab`）承載 Iris / Clawd 的 broad operator token。gu-log 使用 selected-repo fine-grained token，權限只足夠 branch/PR/commit/status 操作；AI lab org token 可以另用較寬權限。

**AI lab org broad token MAY include:** 在 AI lab org 內建立 repo、管理 CI/CD、管理 repo secrets / variables、issues / PRs / Actions / workflows，以及 repo settings。

**AI lab org broad token MUST NOT include:** `chitienhsiehwork-ai/gu-log` 或任何 gu-log administration surface。

**Rejected alternative:** 一把 broad token 管所有 repo。  
**Reason:** 對 sandbox 方便，對 gu-log 太危險。方便到可以刪庫就不是方便，是懸崖附滑梯。

### 2. gu-log token 不給 Administration permission

**Decision:** gu-log token MUST NOT include repository Administration、Workflows write、Actions secrets/variables write、repo deletion、transfer、visibility mutation、branch protection/ruleset mutation、或 bypass permissions。

**Allowed gu-log token permissions:**

- Contents: write
- Pull requests: write
- Issues: write
- Metadata: read
- Actions/checks: read as needed

**Rejected alternative:** 給 admin 權限後靠 prompt discipline。  
**Reason:** prompt discipline 不能當 security boundary。

### 3. Auto-merge 只能透過 guards 執行

**Decision:** 只有在 branch protection pass、required checks green、PR branch up to date、PR mergeable、PR diff 符合 allowlisted paths，且沒有碰 workflow/secrets/config-sensitive files 時，AI MAY auto-merge gu-log PR。

需要 human confirmation 的 high-risk paths 包含：

- `.github/**`
- Vercel / deployment configuration
- security gates / allowlists
- package manager config 或 lockfiles
- auth、secret、environment handling
- push、deploy、delete、或 mutate GitHub settings 的 scripts

**Rejected alternative:** CI green 就 auto-merge。  
**Reason:** CI 不一定能判斷「這個 PR 正在修改自己未來的安全邏輯」。

### 4. Machine memory 必須 local-only 且 secret-free

**Decision:** machine-specific facts 放在 `~/.codex/machine.md`。dotfiles MAY 提供 secret-free bootstrap copy（例如 `codex/machine.md`），但 live token values、private keys、recovery codes 一律不得寫入該檔或 repo docs。`~/.codex/AGENTS.md` SHALL 指向這份 machine note。

**Rejected alternative:** 將 VM details、token values、或 private key notes 直接放進 gu-log repo docs。
**Reason:** machine facts 對這台 Mac 有用，但不該變成 project-wide public docs；secret-free policy 可以進 dotfiles bootstrap，secret value 永遠不行。

## Risks / Trade-offs

- **AI lab token 權限過寬並滲入 gu-log** → 維持 separate org boundary、token names、environment variables、repo scopes；broad token 永遠不要選 gu-log。
- **Path guard misses sensitive file** → workflow、token、branch protection、deployment、package manager、automation config paths 預設 deny。
- **Branch protection bypass via token** → Token MUST NOT 被允許修改 branch protection 或 bypass rules。
- **Machine note accidentally stores secret** → 加上明確的 "no secret" section，並讓該檔被 git ignore。

## Migration Plan

1. 先 create/update OpenSpec artifacts。
2. 在獨立 implementation step 新增或更新 secret-free machine note 與 `~/.codex/AGENTS.md` pointer。
3. Create 或 confirm AI lab org，例如 `shroomdog-ai-lab`。
4. 依此 policy 手動 create 或 refresh GitHub tokens。
5. 從 GitHub UI 或可信任的 human admin context 設定 gu-log branch protection/rulesets。
6. 只有在 token scope 與 branch protection 都驗證後，才新增 auto-merge guard。

## Open Questions

- Final AI lab org name。Preferred candidate: `shroomdog-ai-lab`。
- Branch protection review 後，gu-log auto-merge 要求哪些 CI check names。
