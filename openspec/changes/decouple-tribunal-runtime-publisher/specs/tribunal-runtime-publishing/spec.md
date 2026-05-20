## ADDED Requirements

### Requirement: Tribunal runtime SHALL persist canonical progress outside tracked git files

The long-running Tribunal runtime SHALL store canonical article progress, stage progress, attempts, terminal outcomes, and publishing eligibility in ignored runtime ledger files rather than tracked repo files.

#### Scenario: Runtime records a terminal PASS

- **WHEN** a worker completes all required Tribunal stages and final validation for an article
- **THEN** runtime SHALL write a terminal PASS ledger entry to ignored runtime state
- **AND** the write SHALL be restart-safe through locking and atomic replacement or append
- **AND** the write SHALL NOT require modifying tracked git files in the daemon worktree
- **AND** the ledger entry SHALL include a schema version, stable entry ID, Tribunal version, publish state, timestamps, and artifact manifest metadata

#### Scenario: Runtime records a FAILED or EXHAUSTED result

- **WHEN** a worker reaches a terminal FAILED or EXHAUSTED outcome
- **THEN** runtime SHALL write the terminal outcome, failed stage, attempts, and judge summary to the ignored ledger
- **AND** the write SHALL NOT require committing to the daemon worktree

#### Scenario: Runtime records a RUNNER_ERROR result

- **WHEN** a worker hits an infrastructure failure such as missing score output, incompatible CLI runtime, or interrupted runner state
- **THEN** runtime SHALL write a RUNNER_ERROR ledger entry with infrastructure-failure classification
- **AND** the entry SHALL be excluded from publishable batches
- **AND** the entry SHALL NOT be silently rewritten into FAILED or EXHAUSTED

#### Scenario: Runtime restarts after ledger writes

- **WHEN** tribunal-loop restarts after one or more terminal ledger writes
- **THEN** runtime SHALL load existing ledger state
- **AND** SHALL NOT re-dispatch PASS or EXHAUSTED articles for the same Tribunal version
- **AND** SHALL treat FAILED as operator-visible but re-dispatchable only after explicit requeue policy or human/agent decision
- **AND** SHALL preserve retry semantics for non-terminal or explicitly requeued articles
- **AND** SHALL preserve RUNNER_ERROR as non-publishable infrastructure state rather than terminal content failure

### Requirement: Migration SHALL preserve outcome semantics from tracked progress

Migration from tracked Tribunal progress into the ignored runtime ledger SHALL preserve both history and behavior.

#### Scenario: PASS and EXHAUSTED migrate as non-dispatchable terminal outcomes

- **WHEN** migration reads tracked PASS or EXHAUSTED records for the current Tribunal version
- **THEN** it SHALL create ledger entries that remain non-dispatchable after restart
- **AND** it SHALL preserve attempts, timestamps, and available judge/stage summaries

#### Scenario: FAILED migrates as operator-visible but not auto-retried

- **WHEN** migration reads a tracked FAILED record
- **THEN** it SHALL create a FAILED ledger entry
- **AND** the entry SHALL appear in operator status and metadata
- **AND** the article SHALL NOT be auto-retried on restart unless explicit requeue policy marks it eligible again

#### Scenario: RUNNER_ERROR migrates as infrastructure failure

- **WHEN** migration reads a tracked RUNNER_ERROR or equivalent runner-failure record
- **THEN** it SHALL create a RUNNER_ERROR ledger entry
- **AND** the entry SHALL NOT count toward batch thresholds
- **AND** the entry SHALL remain eligible for recovery or requeue after runtime remediation

#### Scenario: Stale in-progress state migrates without false exhaustion

- **WHEN** migration finds stale in-progress state with no active claim or no valid score artifact
- **THEN** it SHALL migrate the article into a retryable non-terminal recovery state
- **AND** it SHALL NOT convert process interruption alone into EXHAUSTED

### Requirement: Tribunal publisher SHALL create batch PRs from publishable PASS artifacts

Tribunal SHALL provide a publisher that reads ledger entries and creates reviewable batch PRs from a clean checkout based on current `origin/main`.

#### Scenario: Ten publishable PASS artifacts are ready

- **WHEN** at least the configured batch threshold of publishable PASS artifacts is ready
- **THEN** publisher SHALL create a clean publishing worktree from `origin/main`
- **AND** SHALL apply publishable PASS artifacts and batch metadata
- **AND** SHALL run required validation before commit
- **AND** SHALL push a branch and open a PR instead of modifying the daemon worktree
- **AND** FAILED, EXHAUSTED, and RUNNER_ERROR entries SHALL NOT count toward that threshold

#### Scenario: Manual flush is requested

- **WHEN** an operator requests a publisher flush below the default threshold
- **THEN** publisher SHALL create a batch PR for currently publishable PASS artifacts
- **AND** SHALL record that the batch was manually flushed

#### Scenario: No publishable entries are ready

- **WHEN** publisher runs and finds no publishable PASS artifacts
- **THEN** publisher SHALL exit successfully
- **AND** SHALL report that no PR was created

### Requirement: Publisher SHALL detect conflicts from artifact manifests

Publisher SHALL NOT overwrite publishable artifact paths that changed after Tribunal produced their manifest base.

#### Scenario: Post changed after Tribunal artifact base

- **WHEN** a terminal PASS entry includes a manifest path with base commit A and base blob X
- **AND** current `origin/main` contains a different blob for that same manifest path
- **THEN** publisher SHALL mark the article as conflicted or requeue-needed
- **AND** SHALL NOT apply the stale Tribunal artifact to the batch PR
- **AND** SHALL report the skipped article and conflicting paths

#### Scenario: Post did not change after Tribunal artifact base

- **WHEN** a terminal PASS entry includes manifest paths whose current `origin/main` blobs still match the recorded base blobs
- **THEN** publisher MAY apply the artifact to the batch PR
- **AND** SHALL include validation evidence in the PR body or batch metadata

#### Scenario: Open editorial PR already touches the same manifest path

- **WHEN** a non-publisher open PR already touches one or more manifest paths for a publishable PASS artifact
- **THEN** publisher SHALL treat that artifact as conflicted or waiting-on-editorial-review
- **AND** SHALL avoid racing a second PR against the same paths

### Requirement: Conflicted posts SHALL trigger event-driven triage without blocking clean posts

Publisher SHALL separate conflicted entries from unambiguous publishable entries. Clean entries SHALL continue into batch PRs, while conflicted entries SHALL create a triage event for OpenClaw or another designated agent.

#### Scenario: Batch contains both clean and conflicted entries

- **WHEN** publisher selects a batch containing clean PASS artifacts and conflicted PASS artifacts
- **THEN** publisher SHALL include the clean artifacts in the batch PR
- **AND** SHALL exclude conflicted artifacts from that PR
- **AND** SHALL create or update a triage event for the conflicted artifacts
- **AND** SHALL NOT block clean artifacts from reaching CI/prod because unrelated posts need judgment

### Requirement: Triage events SHALL use a durable schema and state machine

Every conflict or validation-blocked triage event SHALL be durably recorded with a stable schema.

#### Scenario: Triage event is created

- **WHEN** publisher or a triage agent creates a new event
- **THEN** the event SHALL include at least event ID, schema version, article slug, Tribunal version, event kind, conflict fingerprint, owner, state, candidate manifest, decision options, createdAt, and updatedAt
- **AND** the dedup key SHALL prevent duplicate events for the same article slug, artifact base, and conflict fingerprint

#### Scenario: Triage event moves through state machine

- **WHEN** an event is processed
- **THEN** its state SHALL move through explicit values such as pending_agent_review, agent_merging, awaiting_human, resolved_keep_current, resolved_accept_tribunal, resolved_agent_merge, requeued, validation_blocked, or closed
- **AND** the resolution SHALL record who resolved it and what changed

#### Scenario: Conflict requires Sprin's opinion

- **WHEN** a conflicted artifact changes overlapping editorial content, factual claims, headings, or other non-metadata hunks that cannot be merged deterministically
- **THEN** the triage agent SHALL summarize the conflict in human terms
- **AND** SHALL present concise choices such as keep current wording, accept Tribunal rewrite, merge both, or requeue
- **AND** SHALL ask Sprin for a decision before changing the production-bound post

#### Scenario: Conflict can be merged safely by an agent

- **WHEN** a conflict is limited to disjoint hunks or metadata-only overlap
- **AND** the triage agent can preserve both the human/Iris/Clawd edit and the Tribunal improvement
- **THEN** the agent MAY produce a merged candidate
- **AND** the merged candidate SHALL still pass validation and relevant Tribunal checks before entering a publisher PR
- **AND** the event SHALL record what was merged and why it did not need human judgment

### Requirement: Validation failures SHALL be isolated without blocking clean entries

Publisher SHALL isolate candidate-level validation or build failures so unrelated clean artifacts can still move forward.

#### Scenario: One candidate fails validation in an otherwise clean batch

- **WHEN** publisher validates a batch and one candidate artifact fails validation or build
- **THEN** publisher SHALL move that candidate into validation_blocked triage state
- **AND** SHALL exclude that candidate from the current batch PR
- **AND** SHALL continue creating the batch PR for remaining valid publishable artifacts if any remain

#### Scenario: All candidates fail validation

- **WHEN** no candidate artifact remains valid after candidate-level validation
- **THEN** publisher SHALL create no PR
- **AND** SHALL report the blocked candidates and their failure reasons

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
