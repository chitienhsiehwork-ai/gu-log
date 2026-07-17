## MODIFIED Requirements

### Requirement: Broad operator token SHALL 被限制在 AI lab organization

Iris / Mogu 的 broad GitHub operator credentials SHALL 只作用在 dedicated AI lab organization，prefer name 為 `shroomdog-ai-lab`，並且 SHALL NOT 包含 `chitienhsiehwork-ai/gu-log`。Legacy host or Unix account names SHALL NOT change this permission boundary.

#### Scenario: 為 Iris 或 Mogu 建立 broad token

- **WHEN** operator 為 Iris 或 Mogu 建立 broad GitHub token
- **THEN** 該 token SHALL 只 scope 到 AI lab organization
- **AND** 該 token SHALL NOT 包含 `chitienhsiehwork-ai/gu-log`
- **AND** 該 token MAY 在 AI lab organization 內包含建立 repo、管理 CI/CD、secrets/variables、issue、PR、Actions、workflow、以及 repository-management permissions

### Requirement: Sandbox repository tokens MAY 在 gu-log 以外有 broader scope

獨立的 AI lab organization tokens MAY 擁有較寬的 repo creation 或 administration permissions，但這些 tokens SHALL NOT 對 gu-log 擁有 admin scope。

#### Scenario: AI 建立 experimental repo

- **WHEN** Iris 或 Mogu 需要建立新的 experimental open-source repo
- **THEN** 它 MAY 使用 AI lab organization token
- **AND** 該 token SHALL NOT 對 gu-log 授予 destructive permissions
