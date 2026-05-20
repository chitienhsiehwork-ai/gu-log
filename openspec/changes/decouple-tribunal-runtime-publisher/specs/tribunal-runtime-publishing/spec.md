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
- **AND** the entry SHALL remain recovery_pending until an explicit recovery or requeue action marks it runnable again

#### Scenario: Stale in-progress state migrates without false exhaustion

- **WHEN** migration finds stale in-progress state with no active claim or no valid score artifact
- **THEN** it SHALL migrate the article into a retryable non-terminal recovery state
- **AND** it SHALL NOT convert process interruption alone into EXHAUSTED

#### Scenario: Legacy tracked and ignored progress records disagree

- **WHEN** migration sees both `scores/tribunal-progress.json` and legacy ignored progress artifacts for the same article
- **THEN** it SHALL treat tracked progress as the primary source of outcome semantics
- **AND** it MAY import missing timestamps or audit detail from ignored progress artifacts
- **AND** it SHALL record that reconciliation happened

#### Scenario: Legacy record contains contradictory terminal and stage data

- **WHEN** migration sees a terminal status that conflicts with stale stage or attempt metadata
- **THEN** the terminal status SHALL win for dispatch behavior
- **AND** contradictory legacy metadata SHALL be preserved as audit detail rather than changing the migrated outcome

### Requirement: FAILED and RUNNER_ERROR re-dispatch SHALL require explicit policy

FAILED and RUNNER_ERROR entries SHALL NOT become runnable merely because the daemon restarted.

#### Scenario: FAILED entry after daemon restart

- **WHEN** runtime restarts with a FAILED entry in the ledger
- **THEN** that article SHALL remain non-runnable
- **AND** it SHALL become runnable again only after an explicit requeue decision or policy marks it eligible

#### Scenario: RUNNER_ERROR entry after runtime remediation

- **WHEN** the underlying runtime problem has been fixed
- **AND** no explicit recovery or requeue action has been taken
- **THEN** RUNNER_ERROR entries SHALL remain recovery_pending and non-runnable
- **AND** runtime SHALL NOT auto-dispatch them just because the environment is healthy again

### Requirement: Requeue and recovery policy SHALL be explicit and auditable

The system SHALL provide explicit actions or policies for making FAILED and RUNNER_ERROR entries runnable again.

#### Scenario: Operator requeues a FAILED article

- **WHEN** an operator or triage workflow decides a FAILED article should be retried
- **THEN** the system SHALL record who requeued it, when, and why
- **AND** the article SHALL move from FAILED into a runnable requeued state

#### Scenario: Operator recovers a RUNNER_ERROR article

- **WHEN** an operator or recovery workflow decides a RUNNER_ERROR article should be retried after remediation
- **THEN** the system SHALL record who recovered it, when, and why
- **AND** the article SHALL move from recovery_pending into a runnable requeued state

### Requirement: Tribunal publisher SHALL create batch PRs from publishable PASS artifacts

Tribunal SHALL provide a publisher that reads ledger entries and creates reviewable batch PRs from a clean checkout based on current `origin/main`.

#### Scenario: Auto publisher selects a batch

- **WHEN** auto publisher scans publishable PASS artifacts
- **THEN** it SHALL order candidates by oldest terminal PASS timestamp first
- **AND** it SHALL exclude conflicted, validation-blocked, batched, and published candidates before counting
- **AND** it SHALL select up to the configured threshold from the remaining ordered pool

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

#### Scenario: Auto publisher finds only six clean artifacts after filtering

- **WHEN** the configured auto threshold is ten
- **AND** only six publishable PASS artifacts remain after conflict and validation filtering
- **THEN** auto publisher SHALL create no PR
- **AND** those six artifacts SHALL remain eligible for the next auto cycle or manual flush

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

#### Scenario: English counterpart exists for a zh post

- **WHEN** the repository already contains an English counterpart for a zh canonical post
- **THEN** a publishable PASS artifact SHALL include both zh and en paths in its manifest
- **AND** missing the required counterpart SHALL move the candidate into validation_blocked state

#### Scenario: Publisher-owned PR identification

- **WHEN** publisher opens or updates a PR
- **THEN** its branch name SHALL use the reserved prefix `publisher/tribunal-batch-`
- **AND** the PR SHALL carry the label `tribunal-publisher`
- **AND** open PRs lacking both markers SHALL be treated as non-publisher PRs for conflict detection

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
- **THEN** the event SHALL include at least event ID, schema version, article slug, Tribunal version, event kind, owner, state, candidate manifest, decision options, createdAt, and updatedAt
- **AND** event kind SHALL be exactly one of `conflict` or `validation_blocked`
- **AND** conflict events SHALL include a conflict fingerprint
- **AND** validation-blocked events SHALL include a validation fingerprint
- **AND** the dedup key SHALL prevent duplicate events for the same article slug, event kind, artifact base, and event fingerprint

#### Scenario: Triage event moves through state machine

- **WHEN** an event is processed
- **THEN** its state SHALL be one of `open`, `agent_review`, `awaiting_human`, `resolved`, `requeued`, `deferred`, or `closed`
- **AND** its resolution SHALL be one of `keep_current`, `accept_tribunal`, `agent_merge`, `validation_fix`, `requeue`, `defer`, or `no_action`
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

#### Scenario: Candidate preflight fails before batch assembly

- **WHEN** a candidate fails per-candidate or pair-level validation before batch assembly
- **THEN** publisher SHALL create or update a `validation_blocked` event in `open` state for that candidate
- **AND** it SHALL exclude the candidate before threshold counting for auto publisher runs

#### Scenario: One candidate fails validation in an otherwise clean batch

- **WHEN** publisher validates a batch and one candidate artifact fails validation or build
- **THEN** publisher SHALL create or update a `validation_blocked` event in `open` state for that candidate
- **AND** SHALL exclude that candidate from the current batch PR
- **AND** SHALL continue creating the batch PR for remaining valid publishable artifacts if any remain

#### Scenario: Whole-site build fails after batch assembly

- **WHEN** whole-site validation fails for an assembled batch
- **THEN** publisher SHALL deterministically replay the selected candidates to identify the minimal failing candidate set
- **AND** it SHALL create or update `validation_blocked` events in `open` state for that failing candidate set
- **AND** it SHALL retry the batch with the remaining candidates before giving up on the whole batch

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

### Requirement: Publisher and deploy lifecycle SHALL be explicit and recoverable

Batch and entry publish state SHALL move through explicit lifecycle transitions that survive retries and partial failure.

#### Scenario: Publisher lifecycle states are enumerated

- **WHEN** batch or entry publish state is recorded
- **THEN** batch or entry state SHALL be one of `ready_for_batch`, `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, `published`, `deploy_failed`, `abandoned`, or `requeued`
- **AND** implementation SHALL NOT invent additional lifecycle states without changing this spec

#### Scenario: Branch push succeeds but PR creation fails

- **WHEN** publisher has pushed a batch branch but failed to create a PR
- **THEN** the batch SHALL remain in `branch_pushed` state
- **AND** a later reconciliation run SHALL retry PR creation instead of creating a new batch branch

#### Scenario: PR closes without merge

- **WHEN** a publisher PR is closed without merge
- **THEN** the affected batch and entries SHALL move to `abandoned` or `requeued` according to operator policy
- **AND** they SHALL NOT remain indefinitely in `pr_open`

#### Scenario: PR merges but deploy fails

- **WHEN** a publisher PR merges
- **AND** production deploy does not succeed
- **THEN** the batch SHALL move to `merged_deploy_pending` or `deploy_failed`
- **AND** entries SHALL NOT be marked `published` until deploy success is observed

#### Scenario: Deploy succeeds

- **WHEN** publisher observes successful deployment for a merged batch
- **THEN** the batch SHALL move to `published`
- **AND** the entries in that batch SHALL also move to `published`

### Requirement: Publisher SHALL expose operator status

Tribunal SHALL provide a status view that separates daemon health, ledger backlog, publisher queue, conflicted entries, open batch PRs, and production merge state.

#### Scenario: Operator checks status

- **WHEN** an operator requests Tribunal status
- **THEN** the system SHALL report daemon lifecycle state separately from publisher queue state
- **AND** SHALL include counts for pending, in-progress, PASS, FAILED, EXHAUSTED, RUNNER_ERROR, publishable, batched, conflicted, and published entries
- **AND** SHALL include batch/entry lifecycle counts such as branch_pushed, pr_open, merged_deploy_pending, deploy_failed, abandoned, and requeued
- **AND** SHALL identify the oldest unpublished terminal entry age
