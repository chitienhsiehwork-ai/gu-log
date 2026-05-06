## ADDED Requirements

### Requirement: gu-log auto-merge SHALL 要求 CI green 與 branch protection

gu-log 的 AI-driven auto-merge SHALL 只在 required CI checks pass、branch up to date、GitHub 標記 PR mergeable，且 branch protection/rulesets allow merge 後才 merge PR。

#### Scenario: Required check 失敗

- **WHEN** gu-log PR 有任何 required check failing 或 pending
- **THEN** auto-merge guard SHALL 拒絕 merge

#### Scenario: Branch protection blocks merge

- **WHEN** GitHub branch protection 或 rulesets block PR
- **THEN** auto-merge guard SHALL 拒絕 bypass 該 protection

### Requirement: gu-log auto-merge SHALL enforce path allowlists

Auto-merge guard SHALL inspect changed paths，並且 SHALL 只 merge 檔案都在 configured lane allowlisted low-risk paths 內的 PR。

#### Scenario: Content-only PR

- **WHEN** PR 只修改 allowlisted content 或 glossary files
- **AND** all required checks pass
- **THEN** auto-merge guard MAY merge 該 PR

#### Scenario: Workflow or security-sensitive file changes

- **WHEN** PR 修改 `.github/**`、GitHub workflows、token handling、branch protection scripts、deployment configuration、package manager config、lockfiles、auth/env/secret handling、或 automation guard code
- **THEN** auto-merge guard SHALL 拒絕 auto-merge
- **AND** 該 PR SHALL require human review

#### Scenario: Low-risk content/code PR

- **WHEN** PR 只修改 ordinary article content、glossary entries、或 low-risk code paths
- **AND** PR 沒有 touch denied high-risk paths
- **AND** all required checks pass
- **THEN** auto-merge guard MAY 啟用 GitHub auto-merge，使用 squash merge 並 delete branch

### Requirement: Auto-merge decisions SHALL be auditable

每次 auto-merge attempt SHALL 留下 auditable record，包含 PR number、changed path summary、check status、guard decision、actor。

#### Scenario: Auto-merge succeeds

- **WHEN** guard merge PR
- **THEN** guard SHALL 記錄該 PR 為何滿足 CI 與 path guard requirements

#### Scenario: Auto-merge 被拒絕

- **WHEN** guard 拒絕 merge PR
- **THEN** guard SHALL 記錄 blocking reason
