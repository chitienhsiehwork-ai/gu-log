## MODIFIED Requirements

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
- **THEN** auto-merge guard MAY merge 該 PR 並 delete branch，merge method 依〈Auto-merge SHALL 依 PR 是否動到文章選擇 merge method〉

## ADDED Requirements

### Requirement: Auto-merge SHALL 依 PR 是否動到文章選擇 merge method

`src/data/post-versions.json` 依碰過每篇文章的非 merge commit 數算版本；把 PR 上的多個 commit squash 成一個，main 的 manifest freshness 檢查就會失敗。Auto-merge guard 合併動到 `src/content/posts/` 的 PR 時 SHALL 使用 merge commit，SHALL NOT squash。沒動到文章的 PR MAY 使用 squash merge。

#### Scenario: PR 動到文章

- **WHEN** guard 允許合併一個修改 `src/content/posts/` 下檔案的 PR
- **THEN** guard SHALL 用 merge commit 合併
- **AND** SHALL NOT squash 該 PR 的 commits

#### Scenario: PR 沒動到文章

- **WHEN** guard 允許合併一個沒有修改 `src/content/posts/` 的 PR
- **THEN** guard MAY 用 squash merge
