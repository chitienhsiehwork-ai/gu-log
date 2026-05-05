## ADDED Requirements

### Requirement: gu-log auto-merge SHALL require CI green and branch protection

AI-driven auto-merge for gu-log SHALL only merge PRs after required CI checks pass, the branch is up to date, GitHub marks the PR mergeable, and branch protection/rulesets allow the merge.

#### Scenario: Required check fails

- **WHEN** a gu-log PR has any required check failing or pending
- **THEN** the auto-merge guard SHALL refuse to merge

#### Scenario: Branch protection blocks merge

- **WHEN** GitHub branch protection or rulesets block a PR
- **THEN** the auto-merge guard SHALL refuse to bypass the protection

### Requirement: gu-log auto-merge SHALL enforce path allowlists

The auto-merge guard SHALL inspect changed paths and SHALL only merge PRs whose files are within allowlisted low-risk paths for the configured lane.

#### Scenario: Content-only PR

- **WHEN** a PR only changes allowlisted content or glossary files
- **AND** all required checks pass
- **THEN** the auto-merge guard MAY merge the PR

#### Scenario: Workflow or security-sensitive file changes

- **WHEN** a PR changes `.github/**`, GitHub workflows, token handling, branch protection scripts, deployment configuration, package manager config, lockfiles, auth/env/secret handling, or automation guard code
- **THEN** the auto-merge guard SHALL refuse to auto-merge
- **AND** the PR SHALL require human review

#### Scenario: Low-risk content/code PR

- **WHEN** a PR only changes ordinary article content, glossary entries, or low-risk code paths
- **AND** it does not touch denied high-risk paths
- **AND** all required checks pass
- **THEN** the auto-merge guard MAY enable GitHub auto-merge with squash merge and branch deletion

### Requirement: Auto-merge decisions SHALL be auditable

Each auto-merge attempt SHALL leave an auditable record containing PR number, changed path summary, check status, guard decision, and actor.

#### Scenario: Auto-merge succeeds

- **WHEN** the guard merges a PR
- **THEN** it SHALL record why the PR satisfied CI and path guard requirements

#### Scenario: Auto-merge is denied

- **WHEN** the guard refuses to merge a PR
- **THEN** it SHALL record the blocking reason
