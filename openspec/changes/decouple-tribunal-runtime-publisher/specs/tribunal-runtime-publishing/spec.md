## ADDED Requirements

### Requirement: Tribunal runtime SHALL persist canonical progress outside tracked git files

The long-running Tribunal runtime SHALL store canonical article progress, stage progress, attempts, terminal outcomes, and publishing eligibility in ignored runtime ledger files rather than tracked repo files.

#### Scenario: Runtime records a terminal PASS

- **WHEN** a worker completes all required Tribunal stages and final validation for an article
- **THEN** runtime SHALL write a terminal PASS ledger entry to ignored runtime state
- **AND** the write SHALL be restart-safe through locking and atomic replacement or append
- **AND** the write SHALL NOT require modifying tracked git files in the daemon worktree

#### Scenario: Runtime records a FAILED or EXHAUSTED result

- **WHEN** a worker reaches a terminal FAILED or EXHAUSTED outcome
- **THEN** runtime SHALL write the terminal outcome, failed stage, attempts, and judge summary to the ignored ledger
- **AND** the write SHALL NOT require committing to the daemon worktree

#### Scenario: Runtime restarts after ledger writes

- **WHEN** tribunal-loop restarts after one or more terminal ledger writes
- **THEN** runtime SHALL load existing ledger state
- **AND** SHALL NOT re-dispatch PASS or EXHAUSTED articles for the same Tribunal version
- **AND** SHALL preserve retry semantics for non-terminal or explicitly requeued articles

### Requirement: Tribunal publisher SHALL create batch PRs from terminal ledger entries

Tribunal SHALL provide a publisher that reads terminal ledger entries and creates reviewable batch PRs from a clean checkout based on current `origin/main`.

#### Scenario: Ten terminal results are ready

- **WHEN** at least the configured batch threshold of terminal results is publishable
- **THEN** publisher SHALL create a clean publishing worktree from `origin/main`
- **AND** SHALL apply publishable PASS artifacts and batch metadata
- **AND** SHALL run required validation before commit
- **AND** SHALL push a branch and open a PR instead of modifying the daemon worktree

#### Scenario: Manual flush is requested

- **WHEN** an operator requests a publisher flush below the default threshold
- **THEN** publisher SHALL create a batch PR for currently publishable terminal entries
- **AND** SHALL record that the batch was manually flushed

#### Scenario: No publishable entries are ready

- **WHEN** publisher runs and finds no publishable terminal entries
- **THEN** publisher SHALL exit successfully
- **AND** SHALL report that no PR was created

### Requirement: Publisher SHALL protect human and agent editorial edits

Publisher SHALL NOT overwrite post files that changed on `origin/main` after Tribunal produced its artifact for the same post.

#### Scenario: Post changed after Tribunal artifact base

- **WHEN** a terminal PASS entry includes a post artifact based on commit A
- **AND** current `origin/main` has changed that same post after commit A
- **THEN** publisher SHALL mark the article as conflicted or requeue-needed
- **AND** SHALL NOT apply the stale Tribunal artifact to the batch PR
- **AND** SHALL report the skipped article and conflicting paths

#### Scenario: Post did not change after Tribunal artifact base

- **WHEN** a terminal PASS entry includes a post artifact based on commit A
- **AND** current `origin/main` has not changed that same post after commit A
- **THEN** publisher MAY apply the artifact to the batch PR
- **AND** SHALL include validation evidence in the PR body or batch metadata

### Requirement: Conflicted posts SHALL trigger event-driven triage without blocking clean posts

Publisher SHALL separate conflicted entries from unambiguous publishable entries. Clean entries SHALL continue into batch PRs, while conflicted entries SHALL create a triage event for OpenClaw or another designated agent.

#### Scenario: Batch contains both clean and conflicted entries

- **WHEN** publisher selects a batch containing clean PASS artifacts and conflicted PASS artifacts
- **THEN** publisher SHALL include the clean artifacts in the batch PR
- **AND** SHALL exclude conflicted artifacts from that PR
- **AND** SHALL create or update a triage event for the conflicted artifacts
- **AND** SHALL NOT block clean artifacts from reaching CI/prod because unrelated posts need judgment

#### Scenario: Conflict requires Sprin's opinion

- **WHEN** a conflicted artifact cannot be merged with high confidence
- **THEN** the triage agent SHALL summarize the conflict in human terms
- **AND** SHALL present concise choices such as keep current wording, accept Tribunal rewrite, merge both, or requeue
- **AND** SHALL ask Sprin for a decision before changing the production-bound post

#### Scenario: Conflict can be merged safely by an agent

- **WHEN** a conflict is low-risk and the triage agent can preserve both the human/Iris/Clawd edit and the Tribunal improvement
- **THEN** the agent MAY produce a merged candidate
- **AND** the merged candidate SHALL still pass validation and relevant Tribunal checks before entering a publisher PR
- **AND** the event SHALL record what was merged and why it did not need human judgment

### Requirement: Publisher SHALL be idempotent

Publisher SHALL avoid publishing the same terminal ledger entry more than once, even after process restarts or repeated manual runs.

#### Scenario: Batch PR is created successfully

- **WHEN** publisher creates a PR for a set of ledger entry IDs
- **THEN** publisher SHALL mark those entries as assigned to that batch
- **AND** a later publisher run SHALL NOT create a second PR for the same entries unless the first batch is explicitly abandoned or requeued

#### Scenario: Publisher crashes before PR creation

- **WHEN** publisher applies artifacts in a temporary worktree but exits before recording a batch PR
- **THEN** a later publisher run SHALL either reuse the same batch identity or safely create a new one
- **AND** SHALL NOT mark entries as published without a branch or PR reference

### Requirement: Publisher SHALL expose operator status

Tribunal SHALL provide a status view that separates daemon health, ledger backlog, publisher queue, conflicted entries, open batch PRs, and production merge state.

#### Scenario: Operator checks status

- **WHEN** an operator requests Tribunal status
- **THEN** the system SHALL report daemon lifecycle state separately from publisher queue state
- **AND** SHALL include counts for pending, in-progress, PASS, FAILED, EXHAUSTED, RUNNER_ERROR, publishable, batched, conflicted, and published entries
- **AND** SHALL identify the oldest unpublished terminal entry age
