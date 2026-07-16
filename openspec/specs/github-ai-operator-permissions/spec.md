# github-ai-operator-permissions Specification

## Purpose
定義 AI GitHub operator 的 organization boundary、gu-log least-privilege token 與 rotation audit contract。
## Requirements
### Requirement: Broad operator token SHALL 被限制在 AI lab organization

Iris / Mogu 的 broad GitHub operator credentials SHALL 只作用在 dedicated AI lab organization，prefer name 為 `shroomdog-ai-lab`，並且 SHALL NOT 包含 `chitienhsiehwork-ai/gu-log`。

#### Scenario: 為 Iris 或 Mogu 建立 broad token

- **WHEN** operator 為 Iris 或 Mogu 建立 broad GitHub token
- **THEN** 該 token SHALL 只 scope 到 AI lab organization
- **AND** 該 token SHALL NOT 包含 `chitienhsiehwork-ai/gu-log`
- **AND** 該 token MAY 在 AI lab organization 內包含建立 repo、管理 CI/CD、secrets/variables、issue、PR、Actions、workflow、以及 repository-management permissions

### Requirement: gu-log token SHALL 是 selected-repository 且 least-privilege

任何放在 remote automation host、用於 gu-log automation 的 GitHub token，SHALL 預設只 scope 到 gu-log repository；若額外 selected repository 是同一 gu-log operating lane 的必要範圍，MUST 有 explicit human approval 與 evidence 記錄。該 token SHALL 只包含 branch、commit、PR、status、check inspection workflow 所需權限。

#### Scenario: 為 gu-log 建立 token

- **WHEN** operator 為 gu-log automation 建立 GitHub token
- **THEN** 該 token SHALL selected-repository scoped 到 gu-log
- **AND** 該 token SHALL NOT 包含 unrelated repositories
- **AND** 若包含 `gu-log-api` 等額外 selected repository，該 scope expansion SHALL 記錄 explicit human approval 與理由
- **AND** 該 token SHALL 至多包含 Contents write、Pull requests write、Issues write、Metadata read，以及必要的 Actions/checks read

### Requirement: gu-log token SHALL NOT 包含 destructive repository administration

gu-log automation token MUST NOT 包含 delete repositories、transfer repositories、change repository visibility、change branch protection、change rulesets、edit GitHub workflows、write repository secrets/variables、或 bypass required reviews/checks 的能力。

#### Scenario: Prompt injection requests repository transfer

- **WHEN** AI agent 收到把 gu-log transfer 到其他 account 的指令
- **THEN** token SHALL 無法執行該 transfer
- **AND** 該 attempted operation SHALL 在 GitHub permission layer 失敗

#### Scenario: Prompt injection 要求移除 branch protection

- **WHEN** AI agent 收到移除 gu-log branch protection 的指令
- **THEN** token SHALL 無法 change branch protection 或 rulesets

### Requirement: Sandbox repository tokens MAY 在 gu-log 以外有 broader scope

獨立的 AI lab organization tokens MAY 擁有較寬的 repo creation 或 administration permissions，但這些 tokens SHALL NOT 對 gu-log 擁有 admin scope。

#### Scenario: AI 建立 experimental repo

- **WHEN** Iris 或 Mogu 需要建立新的 experimental open-source repo
- **THEN** 它 MAY 使用 AI lab organization token
- **AND** 該 token SHALL NOT 對 gu-log 授予 destructive permissions

### Requirement: Tokens SHALL 被命名並可稽核 rotation

Remote automation host 使用的 GitHub tokens SHALL 有 descriptive names，並在 secret-free machine notes 中記錄 rotation dates。

#### Scenario: Token rotation

- **WHEN** operator rotation remote automation host token
- **THEN** machine note SHALL 記錄 token purpose 與 rotation date
- **AND** machine note SHALL NOT 記錄 token value
