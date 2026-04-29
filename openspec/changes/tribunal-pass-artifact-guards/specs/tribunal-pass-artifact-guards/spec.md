## ADDED Requirements

### Requirement: Tribunal PASS commits SHALL publish target article artifacts

Tribunal SHALL NOT create a final `all 4 stages PASS + final build` commit unless the staged commit includes the target article artifact from `src/content/posts`.

#### Scenario: Final PASS commit includes target zh-tw article

- **WHEN** an article has passed all judge stages and the final full build gate
- **AND** Tribunal is about to create the final PASS commit
- **THEN** the staged diff SHALL include `src/content/posts/$POST_FILE`
- **AND** the published target post SHALL contain `scores.tribunalVersion: 3`

#### Scenario: Final PASS commit only includes progress JSON

- **WHEN** the staged diff for a final PASS commit includes `scores/tribunal-progress.json`
- **AND** the staged diff does not include `src/content/posts/$POST_FILE`
- **THEN** Tribunal SHALL fail before commit
- **AND** it SHALL log that the PASS artifact postcondition failed
- **AND** it SHALL NOT create a progress-only PASS commit

#### Scenario: Target post has an English counterpart

- **WHEN** `src/content/posts/en-$POST_FILE` exists for the target article
- **AND** Tribunal is about to create the final PASS commit
- **THEN** the staged diff SHALL include `src/content/posts/en-$POST_FILE`
- **AND** the published English counterpart SHALL contain `scores.tribunalVersion: 3`

### Requirement: Tribunal SHALL provide a historical PASS artifact audit

Tribunal SHALL provide an operator-runnable audit that scans Tribunal PASS commits and fails loudly if any scanned PASS commit lacks target article artifacts.

#### Scenario: Audit scans a progress-only historical PASS commit

- **WHEN** the audit encounters a commit whose subject indicates `all 4 stages PASS + final build`
- **AND** the commit does not include `src/content/posts/<target>.mdx`
- **THEN** the audit SHALL report the commit hash and subject
- **AND** it SHALL describe the missing artifact problem
- **AND** it SHALL exit nonzero

#### Scenario: Audit scans a valid PASS commit

- **WHEN** the audit encounters a Tribunal PASS commit that includes the target zh-tw post artifact
- **AND** includes the English counterpart artifact when the counterpart exists
- **AND** the published artifacts contain `scores.tribunalVersion: 3`
- **THEN** the audit SHALL count the commit as valid
- **AND** it SHALL continue scanning remaining commits

### Requirement: New Tribunal PASS commits SHALL be checked before push

The repository SHALL prevent newly pushed Tribunal PASS commits from reaching main/master if they lack required article artifacts.

#### Scenario: Pushing to main contains a bad Tribunal PASS commit

- **WHEN** a pre-push hook receives a push range targeting `refs/heads/main` or `refs/heads/master`
- **AND** that range contains a progress-only Tribunal PASS commit
- **THEN** the hook SHALL fail
- **AND** it SHALL abort the push before remote update

#### Scenario: Pushing to main contains no Tribunal PASS commits

- **WHEN** a pre-push hook receives a push range targeting `refs/heads/main` or `refs/heads/master`
- **AND** that range contains no Tribunal PASS commits
- **THEN** the audit SHALL pass without blocking unrelated work

### Requirement: Production SHALL run a daily Tribunal PASS artifact audit

The production VM SHALL run a scheduled daily audit that checks post-fix Tribunal PASS commits on the remote main branch.

#### Scenario: Daily audit succeeds

- **WHEN** the scheduled audit runs
- **AND** every scanned Tribunal PASS commit contains required target artifacts
- **THEN** the audit service SHALL exit successfully
- **AND** operators MAY continue trusting new Tribunal PASS metadata

#### Scenario: Daily audit fails

- **WHEN** the scheduled audit finds a progress-only Tribunal PASS commit
- **THEN** the audit service SHALL exit nonzero
- **AND** operators SHALL treat new Tribunal PASS metadata as suspect until the named commit is investigated
