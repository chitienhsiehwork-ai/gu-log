## ADDED Requirements

### Requirement: Tribunal runtime SHALL persist canonical progress outside tracked git files

The long-running Tribunal runtime SHALL store canonical article progress, stage progress, attempts, terminal outcomes, and publishing eligibility in ignored runtime ledger files rather than tracked repo files.

#### Scenario: Runtime records a terminal PASS

- **WHEN** a worker completes all required Tribunal stages and final validation for an article
- **THEN** runtime SHALL write a terminal PASS ledger entry to ignored runtime state
- **AND** the write SHALL be restart-safe through locking and atomic replacement or append
- **AND** the write SHALL NOT require modifying tracked git files in the daemon worktree
- **AND** the ledger entry SHALL include a schema version, stable entry ID, Tribunal version, `runtime_dispatch_state`, `publish_state`, timestamps, and artifact manifest metadata

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
- **AND** SHALL preserve retry semantics for non-terminal or explicitly `runtime_requeued` articles
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
- **AND** the entry SHALL remain `runtime_recovery_pending` until an explicit recovery action creates a successor run target for another attempt

#### Scenario: Stale in-progress state migrates without false exhaustion

- **WHEN** migration finds stale in-progress state with no active claim or no valid score artifact
- **THEN** it SHALL migrate the article into `runtime_dispatch_state=runtime_requeued` so it becomes runnable again without being misclassified as terminal
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

#### Scenario: Migrated ledger already exists and disagrees with legacy sources

- **WHEN** migration or reconciliation sees an existing migrated ledger entry and older tracked or ignored legacy records disagree with it
- **THEN** the migrated ledger entry SHALL remain the source of truth for runtime behavior
- **AND** tracked or ignored legacy records MAY only add missing audit detail that does not change the migrated outcome, `runtime_dispatch_state`, or `publish_state`
- **AND** any contradictory legacy details SHALL be recorded as reconciliation evidence rather than overwriting the migrated ledger entry

### Requirement: FAILED and RUNNER_ERROR re-dispatch SHALL require explicit policy

FAILED and RUNNER_ERROR entries SHALL NOT become runnable merely because the daemon restarted.

#### Scenario: FAILED entry after daemon restart

- **WHEN** runtime restarts with a FAILED entry in the ledger
- **THEN** that article SHALL remain non-runnable
- **AND** it SHALL become runnable again only after an explicit requeue decision or policy marks it eligible

#### Scenario: RUNNER_ERROR entry after runtime remediation

- **WHEN** the underlying runtime problem has been fixed
- **AND** no explicit recovery or requeue action has been taken
- **THEN** RUNNER_ERROR entries SHALL remain `runtime_recovery_pending` and non-runnable
- **AND** runtime SHALL NOT auto-dispatch them just because the environment is healthy again

### Requirement: Requeue and recovery policy SHALL be explicit and auditable

The system SHALL provide explicit actions or policies for making FAILED and RUNNER_ERROR entries runnable again.

#### Scenario: Runtime dispatch states are enumerated and closed

- **WHEN** `runtime_dispatch_state` is recorded in the ledger
- **THEN** its legal values SHALL be exactly `pending`, `in_progress`, `runtime_requeued`, `runtime_recovery_pending`, or `terminal`
- **AND** implementation SHALL NOT invent additional dispatch states without changing this spec

#### Scenario: Runtime dispatch state transitions are deterministic

- **WHEN** runtime mutates `runtime_dispatch_state`
- **THEN** legal transitions SHALL be exactly `pending -> in_progress|terminal`, `in_progress -> terminal|runtime_requeued|runtime_recovery_pending`, and `runtime_requeued -> in_progress|terminal|runtime_recovery_pending`
- **AND** `terminal` SHALL be immutable for that ledger entry
- **AND** terminal PASS requeue SHALL create a successor ledger entry rather than move an existing `terminal` entry back to a runnable state

#### Scenario: Runtime dispatch eligibility is derived from dispatch state

- **WHEN** runtime decides whether an entry is dispatchable after startup or reconciliation
- **THEN** only `pending` and `runtime_requeued` entries SHALL be dispatchable
- **AND** `in_progress`, `runtime_recovery_pending`, and `terminal` entries SHALL be non-dispatchable on that same entry
- **AND** `runtime_recovery_pending` work may resume only through explicit recovery that creates a successor `runtime_requeued` entry

For clarity, runtime retry and publisher requeue are distinct surfaces:

- runtime retry/recovery = rerun eligibility for FAILED or RUNNER_ERROR Tribunal outcomes
- publisher requeue = publish-queue re-entry for terminal PASS entries that were blocked by triage and now have a refreshed candidate/manifests or an explicit triage decision

#### Scenario: Operator requeues a FAILED article

- **WHEN** an operator or triage workflow decides a FAILED article should be retried
- **THEN** the system SHALL record who requeued it, when, and why
- **AND** the FAILED entry SHALL keep its original terminal outcome immutable
- **AND** implementation SHALL create a successor run target with a new stable entry ID and explicit predecessor linkage that enters `runtime_dispatch_state=runtime_requeued`

#### Scenario: Operator recovers a RUNNER_ERROR article

- **WHEN** an operator or recovery workflow decides a RUNNER_ERROR article should be retried after remediation
- **THEN** the system SHALL record who recovered it, when, and why
- **AND** the RUNNER_ERROR entry SHALL keep its recorded infrastructure outcome immutable
- **AND** implementation SHALL create a successor run target with a new stable entry ID and explicit predecessor linkage that enters `runtime_dispatch_state=runtime_requeued`

#### Scenario: Recovery and requeue surface contract

- **WHEN** an operator, API client, or triage workflow requests a retry
- **THEN** the system SHALL expose an explicit action surface that distinguishes FAILED requeue from RUNNER_ERROR recovery
- **AND** the request SHALL target stable ledger entry IDs as the canonical mutation key, with article slug accepted only as a selector that must resolve uniquely before mutation
- **AND** the runtime retry/recovery surface SHALL reject PASS, EXHAUSTED, published, abandoned, or currently batched entries
- **AND** terminal PASS entries MAY request another Tribunal pass only through the triage-defined requeue path, which SHALL create a successor run target instead of mutating the existing terminal PASS entry back to runnable

#### Scenario: Bulk retry is requested

- **WHEN** an operator requests a bulk requeue or recovery action
- **THEN** the system SHALL require an explicit target set resolved before mutation
- **AND** it SHALL record per-entry success or rejection outcomes in the audit trail

#### Scenario: Article slug selector is canonicalized before retry

- **WHEN** a retry or recovery request is expressed as an article slug rather than a stable ledger entry ID
- **THEN** the system SHALL treat the slug as a read-only selector and resolve it to exactly one eligible ledger entry before mutation
- **AND** if more than one ledger entry exists for that slug, the caller SHALL provide an additional Tribunal version or exact ledger entry ID
- **AND** if resolution is still ambiguous, the system SHALL reject the request without mutating any entry

### Requirement: Tribunal publisher SHALL create batch PRs from publishable PASS artifacts

Tribunal SHALL provide a publisher that reads ledger entries and creates reviewable batch PRs from a clean checkout based on current `origin/main`.

#### Scenario: Auto publisher selects a batch

- **WHEN** auto publisher scans publishable PASS artifacts
- **THEN** it SHALL exclude entries that currently have `conflict` or `validation_blocked` triage events in blocking states (`open`, `agent_review`, `awaiting_human`, or `deferred`), plus entries whose `publish_state` is one of `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, `deploy_failed`, `published`, or `abandoned`, before counting
- **AND** it SHALL collapse the remaining pool to one deterministic winner per transitive manifest-overlap connected component before applying the batch threshold
- **AND** it SHALL order that collapsed winner pool by oldest terminal PASS timestamp first
- **AND** it SHALL break equal timestamps in that collapsed winner pool by stable entry ID ascending
- **AND** it SHALL select up to the configured threshold from that collapsed winner pool

#### Scenario: Eligible pool contains overlapping publish paths

- **WHEN** two or more currently eligible entries have candidate manifests that overlap on one or more publish paths
- **THEN** publisher SHALL treat the full transitive connected component of the manifest-overlap graph as one overlapping set before threshold counting, where an edge exists whenever two entries overlap on one or more publish paths
- **AND** at most one candidate from that connected component SHALL be selectable in the current scan
- **AND** the deterministic winner SHALL be the entry with the newest terminal PASS timestamp, with stable entry ID descending as the required tie-break when timestamps match
- **AND** non-winning overlapping entries SHALL remain in their current `publish_state` but SHALL be excluded from that scan's threshold count and batch selection
- **AND** those non-winning entries MAY only be reconsidered on a later scan after the winning entry resolves or later triage changes their eligibility

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

#### Scenario: Manual flush omits batch size

- **WHEN** an operator requests manual flush without an explicit batch size
- **THEN** publisher SHALL include all currently eligible publishable PASS artifacts in that flush

#### Scenario: Manual flush requests a bounded batch size

- **WHEN** an operator requests manual flush with an explicit batch size smaller than the eligible pool
- **THEN** publisher SHALL select that many eligible artifacts in normal batch order
- **AND** SHALL leave the remaining eligible artifacts in ready_for_batch

#### Scenario: Auto publisher finds only six clean artifacts after filtering

- **WHEN** the configured auto threshold is ten
- **AND** only six publishable PASS artifacts remain after conflict and validation filtering
- **THEN** auto publisher SHALL create no PR
- **AND** implementation SHALL clear any provisional batch binding recorded for those six artifacts and restore their `publish_state` to `ready_for_batch`
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
- **THEN** publisher SHALL create or update a `conflict` triage event for that article
- **AND** SHALL NOT apply the stale Tribunal artifact to the batch PR
- **AND** SHALL report the skipped article and conflicting paths

#### Scenario: Post did not change after Tribunal artifact base

- **WHEN** a terminal PASS entry includes manifest paths whose current `origin/main` blobs still match the recorded base blobs
- **THEN** publisher MAY apply the artifact to the batch PR
- **AND** SHALL include validation evidence in the PR body or batch metadata

#### Scenario: Open editorial PR already touches the same manifest path

- **WHEN** a non-publisher open PR already touches one or more manifest paths for a publishable PASS artifact
- **THEN** publisher SHALL create or update a `conflict` triage event for that artifact
- **AND** SHALL avoid racing a second PR against the same paths

#### Scenario: English counterpart exists for a zh post

- **WHEN** the repository already contains an English counterpart for a zh canonical post
- **THEN** a publishable PASS artifact SHALL include both zh and en paths in its manifest
- **AND** missing the required counterpart SHALL create or update a `validation_blocked` triage event for that candidate and keep it outside batch selection

#### Scenario: Publisher-owned PR identification

- **WHEN** publisher opens or updates a PR
- **THEN** its branch name SHALL use the reserved prefix `publisher/tribunal-batch-`
- **AND** the PR SHALL carry the label `tribunal-publisher`
- **AND** any open PR missing either marker SHALL be treated as a non-publisher PR for conflict detection

### Requirement: Conflicted posts SHALL trigger event-driven triage without blocking clean posts

Publisher SHALL separate conflicted entries from unambiguous publishable entries. Clean entries SHALL continue into batch PRs, while conflicted entries SHALL create a triage event for OpenClaw or another designated agent.

#### Scenario: Batch contains both clean and conflicted entries

- **WHEN** publisher selects a batch containing clean PASS artifacts and conflicted PASS artifacts
- **THEN** publisher SHALL include the clean artifacts in the batch PR
- **AND** SHALL exclude conflicted artifacts from that PR
- **AND** SHALL create or update a triage event for the conflicted artifacts
- **AND** any excluded artifact that had already entered the current batch selection SHALL have its batch binding cleared and its `publish_state` restored to `ready_for_batch` while the blocking event remains active
- **AND** SHALL NOT block clean artifacts from reaching CI/prod because unrelated posts need judgment

#### Scenario: Multi-article conflict event grouping is stable

- **WHEN** publisher identifies conflicts for multiple ledger entries in one scan against the same ordered comparison target set
- **THEN** it SHALL create exactly one `conflict` event for that exact ordered `ledgerEntryIds` set and exact ordered comparison target set
- **AND** a later retry SHALL update the same event rather than create a second one if ordered `ledgerEntryIds`, artifact base digest, conflict fingerprint, and comparison target set are unchanged

#### Scenario: Mixed-version conflict set is split before grouped conflict creation

- **WHEN** publisher identifies one conflict set whose entries do not all share the same `tribunalVersions` value
- **THEN** implementation SHALL split that conflict set by `tribunalVersions` before creating grouped `conflict` events
- **AND** each grouped conflict event SHALL then satisfy the single-version event schema contract
- **AND** all version-split conflict events derived from that one publisher scan SHALL share a common `replayGroupId` so the original mixed-version conflict set still has one canonical audit identity

#### Scenario: Grouped conflict is split before mixed outcomes are applied

- **WHEN** a grouped `conflict` event contains multiple ledger entries but triage determines they require different outcomes
- **THEN** implementation SHALL split that grouped event into smaller conflict events whose member entries each share one intended resolution path
- **AND** each split event SHALL receive its own dedup identity and `parentEventId` link before any entry-level mutation happens
- **AND** each split child event SHALL be durably recorded in an active blocking state before the original grouped event may close
- **AND** only after those child events are durable MAY the original grouped event record `supersededByEventIds`, move to `closed` with `resolution=split`, and stop contributing any blocking state

### Requirement: Triage events SHALL use a durable schema and state machine

Every conflict or validation-blocked triage event SHALL be durably recorded with a stable schema.

Blocked conditions are derived from triage events whose state is one of `open`, `agent_review`, `awaiting_human`, or `deferred`, and are not additional entry publish lifecycle states.

#### Scenario: Triage event is created

- **WHEN** publisher or a triage agent creates a new event
- **THEN** the event SHALL be durably created in `open` state before any later legal transition may promote it to `agent_review`, `awaiting_human`, or `deferred`
- **AND** the event SHALL include at least event ID, schema version, a non-empty ordered `ledgerEntryIds` array, a non-empty ordered `articleSlugs` array, an ordered `tribunalVersions` array aligned with `ledgerEntryIds`, event kind, owner, state, an ordered `candidateManifests` array aligned with `ledgerEntryIds`, decision options, artifact base digest, createdAt, and updatedAt
- **AND** event kind SHALL be exactly one of `conflict` or `validation_blocked`
- **AND** conflict events SHALL include a conflict fingerprint
- **AND** validation-blocked events SHALL include a validation fingerprint
- **AND** the dedup key SHALL prevent duplicate events for the same ordered `ledgerEntryIds`, event kind, artifact base digest, and event fingerprint
- **AND** ordered `ledgerEntryIds` SHALL be sorted ascending by stable ledger entry ID
- **AND** ordered `articleSlugs` SHALL follow the same order as `ledgerEntryIds`
- **AND** grouped events MAY span multiple `tribunalVersions` only when they are represented as per-version events linked by a shared `replayGroupId`; a single event record itself SHALL contain entries from only one `tribunalVersions` value
- **AND** a split child event SHALL record its `parentEventId`, while a split parent event SHALL record its ordered `supersededByEventIds`
- **AND** a newly created event SHALL leave final `resolution` unset until it actually reaches `resolved`, `requeued`, or `closed`
- **AND** canonical dedup SHALL use ordered `ledgerEntryIds`; `articleSlugs` are human-facing only

#### Scenario: Artifact base digest is computed concretely

- **WHEN** publisher creates or updates a triage event
- **THEN** the event SHALL include an artifact base digest derived from the ordered set of manifest tuples `{ path, baseCommitSha, baseBlobSha }` across all participating ledger entries
- **AND** equivalent manifest bases SHALL produce the same artifact base digest across retries

#### Scenario: Comparison targets are represented concretely

- **WHEN** publisher creates or updates a conflict or validation-blocked event
- **THEN** the event SHALL include an ordered comparison target set whose members are concrete identifiers of the form `main:<path>:<currentBlobSha>`, `main:<path>:missing`, `pr:<prNumber>:<path>:<blobSha>`, or `pr:<prNumber>:<path>:missing`
- **AND** equivalent comparison targets SHALL produce the same ordered comparison target set across retries

#### Scenario: Grouped conflict records carry replay identity when split by version

- **WHEN** grouped conflict creation was split by `tribunalVersions` from one publisher scan
- **THEN** each resulting conflict event SHALL record the shared `replayGroupId`
- **AND** dedup and update behavior SHALL continue to operate per resulting single-version event record rather than across the original mixed-version set

#### Scenario: Conflict fingerprint is computed deterministically

- **WHEN** publisher creates or updates a conflict event
- **THEN** the conflict fingerprint SHALL be derived from the sorted set of manifest paths, recorded base blobs, candidate digests, and comparison target identifiers
- **AND** equivalent conflict inputs SHALL produce the same fingerprint across retries
- **AND** ordered `ledgerEntryIds` SHALL be part of the fingerprint input

#### Scenario: Validation fingerprint is computed deterministically

- **WHEN** publisher creates or updates a validation-blocked event
- **THEN** the validation fingerprint SHALL be derived from the ordered `ledgerEntryIds`, validator identity, and normalized failure class
- **AND** equivalent validation failures SHALL produce the same fingerprint across retries
- **AND** ordered `ledgerEntryIds` SHALL be part of the fingerprint input

#### Scenario: Multi-article validation event grouping is stable

- **WHEN** deterministic replay identifies a minimal failing subset containing multiple ledger entries
- **THEN** publisher SHALL create grouped `validation_blocked` event records that together cover that exact ordered `ledgerEntryIds` set discovered in that replay pass
- **AND** if the failing subset has one `tribunalVersions` value, that coverage MAY be one single event record
- **AND** a later retry SHALL update the same event record set rather than create a second one if ordered `ledgerEntryIds`, artifact base digest, and validation fingerprint are unchanged
- **AND** `replayGroupId` for that grouped validation event set SHALL be derived deterministically from the original cross-version failing subset's ordered `ledgerEntryIds`, artifact base digest, validator identity, and normalized failure class

#### Scenario: Mixed-version failing subset is split before grouped validation-blocked creation

- **WHEN** deterministic replay identifies a minimal failing subset whose entries do not all share the same `tribunalVersions` value
- **THEN** implementation SHALL split that subset by `tribunalVersions` before creating grouped `validation_blocked` events
- **AND** each grouped validation-blocked event SHALL then satisfy the single-version event schema contract
- **AND** all version-split events derived from the same replay result SHALL share a common `replayGroupId` so the original cross-version failing subset still has one canonical audit identity
- **AND** that shared `replayGroupId` SHALL be computed deterministically from the original cross-version failing subset's ordered `ledgerEntryIds`, artifact base digest, validator identity, and normalized failure class so retries and crash recovery reproduce the same value before any event is durably written

#### Scenario: Grouped validation-blocked event is split before mixed outcomes are applied

- **WHEN** a grouped `validation_blocked` event contains multiple ledger entries but remediation determines they require different outcomes
- **THEN** implementation SHALL split that grouped event into smaller validation-blocked events whose member entries each share one intended resolution path
- **AND** each split event SHALL receive its own dedup identity and `parentEventId` link before any entry-level mutation happens
- **AND** each split child event SHALL be durably recorded in an active blocking state before the original grouped event may close
- **AND** only after those child events are durable MAY the original grouped event record `supersededByEventIds`, move to `closed` with `resolution=split`, and stop contributing any blocking state

#### Scenario: Triage event moves through state machine

- **WHEN** an event is processed
- **THEN** its state SHALL be one of `open`, `agent_review`, `awaiting_human`, `resolved`, `requeued`, `deferred`, or `closed`
- **AND** legal transitions SHALL be exactly `open -> agent_review|awaiting_human|deferred|closed(split only)`, `agent_review -> open|awaiting_human|resolved|deferred|closed(split only)`, `awaiting_human -> agent_review|resolved|deferred|closed(split only)`, `deferred -> agent_review|awaiting_human|closed(split only)`, `resolved -> requeued|closed`, and `requeued -> closed`
- **AND** `closed(split only)` means the direct close is legal only for the grouped-parent `resolution=split` path defined below
- **AND** when an event reaches `resolved`, `requeued`, or `closed`, its final `resolution` SHALL be one of `keep_current`, `accept_tribunal`, `agent_merge`, `validation_fix`, `requeue`, `no_action`, or `split`
- **AND** that final resolution SHALL record who resolved it and what changed

#### Scenario: Resolution outcome `split` closes a grouped parent event in favor of child events

- **WHEN** a grouped `conflict` or grouped `validation_blocked` event must be split because its member entries no longer share one intended resolution path
- **THEN** the parent event SHALL remain blocking until all child events are durably created in active blocking states
- **AND** only after those child events are durable SHALL the parent event move to `closed` with `resolution=split`
- **AND** the parent event SHALL record ordered `supersededByEventIds` for the child events that now carry active blocking semantics
- **AND** only those child events SHALL remain eligible to block publisher selection or receive subsequent entry-level mutations

#### Scenario: Resolution outcome `keep_current` closes the current candidate

- **WHEN** a triage event resolves as `keep_current`
- **THEN** the event SHALL move through `resolved` to `closed`
- **AND** the affected ledger entries SHALL move to `abandoned` for the current candidate/manifests represented by that event
- **AND** publisher SHALL NOT return those entries to `ready_for_batch` unless a later explicit requeue or refreshed candidate is created

#### Scenario: Resolution outcome `no_action` closes without re-entry

- **WHEN** a triage event resolves as `no_action`
- **THEN** the event SHALL move through `resolved` to `closed`
- **AND** the affected ledger entries SHALL move to `abandoned` for the current candidate/manifests represented by that event

#### Scenario: Action path `accept_tribunal` refreshes the candidate for publication

- **WHEN** a triage workflow chooses action path `accept_tribunal` for an active event
- **THEN** the event SHALL remain in `agent_review` while implementation writes a refreshed candidate artifact and refreshed manifest against the current comparison targets
- **AND** the affected ledger entries SHALL remain excluded from batch selection and keep their pre-resolution publish state until refresh work completes
- **AND** after that refreshed artifact passes required validation, the event SHALL set final `resolution=accept_tribunal`, move `agent_review -> resolved -> closed`, and return the affected ledger entries to `ready_for_batch` only when no open non-publisher PR blocker remains
- **AND** if the refreshed candidate fails validation or refresh work aborts, the event SHALL move `agent_review -> open` with updated failure context, leave final `resolution` unset, and keep the affected entries outside `ready_for_batch`
- **AND** if the refreshed candidate passes validation but the current comparison target is still an open non-publisher PR, the event SHALL move `agent_review -> deferred` and the affected entries SHALL remain blocked until that PR is no longer blocking

#### Scenario: Action path `agent_merge` refreshes the merged candidate for publication

- **WHEN** a triage workflow chooses action path `agent_merge` for an active event
- **THEN** the event SHALL remain in `agent_review` while implementation writes a merged candidate artifact and refreshed manifest against the current comparison targets
- **AND** the affected ledger entries SHALL remain excluded from batch selection and keep their pre-resolution publish state until refresh work completes
- **AND** after that refreshed artifact passes required validation, the event SHALL set final `resolution=agent_merge`, move `agent_review -> resolved -> closed`, and return the affected ledger entries to `ready_for_batch` only when no open non-publisher PR blocker remains
- **AND** if the refreshed candidate fails validation or refresh work aborts, the event SHALL move `agent_review -> open` with updated failure context, leave final `resolution` unset, and keep the affected entries outside `ready_for_batch`
- **AND** if the refreshed candidate passes validation but the current comparison target is still an open non-publisher PR, the event SHALL move `agent_review -> deferred` and the affected entries SHALL remain blocked until that PR is no longer blocking

#### Scenario: Action path `validation_fix` returns a fixed candidate to the queue

- **WHEN** a triage workflow chooses action path `validation_fix` for an active event
- **THEN** the event SHALL remain in `agent_review` while implementation writes the fixed candidate artifact and refreshed manifest for the affected entries
- **AND** the affected ledger entries SHALL remain excluded from batch selection and keep their pre-resolution publish state until refresh work completes
- **AND** after the fix passes required validation, the event SHALL set final `resolution=validation_fix`, move `agent_review -> resolved -> closed`, and return the affected ledger entries to `ready_for_batch` only when no open non-publisher PR blocker remains
- **AND** if the fixed candidate still fails validation, the event SHALL move `agent_review -> open` with updated failure context, leave final `resolution` unset, and keep the affected entries outside `ready_for_batch`
- **AND** if the refreshed candidate passes validation but the current comparison target is still an open non-publisher PR, the event SHALL move `agent_review -> deferred` and the affected entries SHALL remain blocked until that PR is no longer blocking

#### Scenario: Resolution outcome `requeue` marks entries runnable again

- **WHEN** a triage event resolves as `requeue`
- **THEN** the affected terminal PASS entries SHALL keep their original terminal outcome immutable and move their current publish candidate to `publish_state=abandoned`
- **AND** implementation SHALL create a successor run target with a new stable entry ID and explicit predecessor linkage that enters `runtime_dispatch_state=runtime_requeued` for the next Tribunal pass
- **AND** the event SHALL move from `resolved` to `requeued` and then `closed` after that successor run target is durably recorded

#### Scenario: Action path `defer` preserves the block without final resolution

- **WHEN** a triage workflow chooses action path `defer` for an active event
- **THEN** the event SHALL move to `deferred` with final `resolution` still unset
- **AND** the affected ledger entries SHALL keep their current `publish_state`, typically `ready_for_batch` or `abandoned`
- **AND** those entries SHALL remain excluded from publisher selection only because the deferred triage event is still in a blocking state

#### Scenario: Deferred blocker closes or merges before publication can resume

- **WHEN** a triage event is in `deferred` because an open non-publisher PR remained a comparison-target blocker after candidate refresh
- **AND** that blocking PR later closes or merges
- **THEN** the event SHALL move `deferred -> agent_review` before any affected entry returns to `ready_for_batch`
- **AND** implementation SHALL refresh the candidate artifact and manifest against the now-current comparison targets and rerun required validation
- **AND** only a successful refresh and validation pass with no remaining open non-publisher PR blocker may move the event through `resolved -> closed` and return affected entries to `ready_for_batch`
- **AND** refresh or validation failure at that stage SHALL move the event back to `open` with updated failure context

#### Scenario: Whole-site failure blocks multiple articles together

- **WHEN** deterministic replay identifies a minimal failing subset containing more than one article
- **THEN** publisher SHALL create or update grouped `validation_blocked` events that cover the full failing subset
- **AND** if all entries share one `tribunalVersions` value, that coverage MAY be one single grouped event
- **AND** if the subset spans multiple `tribunalVersions` values, implementation SHALL split it into per-version grouped events linked by a shared `replayGroupId`
- **AND** those grouped events SHALL remain durable until the represented entries are revalidated, runtime-requeued, or closed

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
- **AND** it SHALL exclude the candidate before threshold counting for auto publisher runs while that event remains open

#### Scenario: One candidate fails validation in an otherwise clean batch

- **WHEN** publisher validates a batch and one candidate artifact fails validation or build
- **THEN** publisher SHALL create or update a `validation_blocked` event in `open` state for that candidate
- **AND** SHALL exclude that candidate from the current batch PR
- **AND** if that candidate had already been placed in the current batch selection, implementation SHALL clear its batch binding and restore its `publish_state` to `ready_for_batch` while the blocking event remains active
- **AND** SHALL continue creating the batch PR for remaining valid publishable artifacts only if the surviving set still satisfies the active run mode batch policy

#### Scenario: Whole-site build fails after batch assembly

- **WHEN** whole-site validation fails for an assembled batch
- **THEN** publisher SHALL deterministically replay the selected candidates to identify the minimal failing candidate set
- **AND** it SHALL create or update `validation_blocked` events in `open` state for that failing candidate set
- **AND** it SHALL retry the batch with the remaining candidates only if the surviving set still satisfies the active run mode batch policy before giving up on the whole batch
- **AND** replay SHALL continue iteratively until the surviving batch actually passes whole-site validation or no survivor set can legally continue under the active run mode

#### Scenario: Deterministic replay chooses one canonical failing subset

- **WHEN** more than one failing subset could explain a whole-site validation failure
- **THEN** implementation SHALL search candidate subsets in deterministic order: smallest subset size first, then lexicographic order of the selected batch's ordered `ledgerEntryIds`
- **AND** the first subset that still reproduces the failure under that search order SHALL be the canonical minimal failing subset for event creation and `replayGroupId` assignment

#### Scenario: Whole-site replay rollback restores entries when no batch will proceed

- **WHEN** whole-site replay leaves no surviving candidate set that can legally continue for the active run mode
- **THEN** implementation SHALL clear the current batch binding for every entry that had been selected into that batch
- **AND** implementation SHALL restore each selected entry's `publish_state` to `ready_for_batch`
- **AND** entries that belong to failing subsets SHALL remain excluded from future selection only through their blocking `validation_blocked` triage events

#### Scenario: All candidates fail validation

- **WHEN** no candidate artifact remains valid after candidate-level validation
- **THEN** publisher SHALL create no PR
- **AND** SHALL report the blocked candidates and their failure reasons

### Requirement: Publisher SHALL be idempotent

Publisher SHALL avoid publishing the same terminal ledger entry more than once, even after process restarts or repeated manual runs.

#### Scenario: Batch PR is created successfully

- **WHEN** publisher creates a PR for a set of ledger entry IDs
- **THEN** publisher SHALL mark those entries as assigned to that batch
- **AND** a later publisher run SHALL NOT create a second PR for the same entries unless the first batch is explicitly abandoned or explicitly returned to `ready_for_batch`
- **AND** entries count as `batched` while their `publish_state` is one of `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, or `deploy_failed`

#### Scenario: Batch identity is recorded before side effects

- **WHEN** publisher selects ledger entries for a new batch
- **THEN** it SHALL durably record the batch identity, selected ledger entry IDs, and `batch_selected` state before branch creation or branch push begins
- **AND** a later recovery run SHALL use that durable binding to resume or reconcile the same batch rather than silently reselecting different entries

#### Scenario: Publisher crashes before PR creation

- **WHEN** publisher applies artifacts in a temporary worktree but exits before recording a batch PR
- **THEN** a later publisher run SHALL reuse the same batch identity and branch intent
- **AND** SHALL NOT mark entries as published without a branch or PR reference
- **AND** a successful branch push SHALL be durably recorded with the remote branch ref before PR creation is attempted

### Requirement: Publisher and deploy lifecycle SHALL be explicit and recoverable

Batch and entry `publish_state` SHALL move through explicit lifecycle transitions that survive retries and partial failure.

#### Scenario: Publisher lifecycle states are enumerated

- **WHEN** batch or entry `publish_state` is recorded
- **THEN** batch or entry `publish_state` SHALL be one of `ready_for_batch`, `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, `published`, `deploy_failed`, or `abandoned`
- **AND** implementation SHALL NOT invent additional lifecycle states without changing this spec

#### Scenario: Bound entry states mirror batch lifecycle deterministically

- **WHEN** a batch lifecycle transition is durably recorded for a bound publisher batch
- **THEN** every ledger entry bound to that batch SHALL move to the same lifecycle value at the same durable step, except entries that were explicitly removed from the batch earlier by rollback or blocking triage
- **AND** this mirroring rule SHALL apply for `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, `deploy_failed`, `published`, and `abandoned`

#### Scenario: Branch push succeeds but PR creation fails

- **WHEN** publisher has pushed a batch branch but failed to create a PR
- **THEN** the batch SHALL remain in `branch_pushed` state
- **AND** the bound entries for that batch SHALL also remain in `branch_pushed`
- **AND** a later reconciliation run SHALL retry PR creation instead of creating a new batch branch
- **AND** it SHALL reuse the same batch identity and recorded remote branch ref

#### Scenario: PR closes without merge

- **WHEN** a publisher PR is closed without merge
- **THEN** the affected batch and entries SHALL move to `abandoned` by default
- **AND** they SHALL return to `ready_for_batch` only after an explicit republish action refreshes or reselects the candidate for publisher use
- **AND** they SHALL NOT remain indefinitely in `pr_open`

#### Scenario: Explicit republish action returns abandoned entries to the publish queue

- **WHEN** an operator or triage workflow requests republish for an `abandoned` entry
- **THEN** the system SHALL expose an explicit republish action surface that targets stable ledger entry IDs as the canonical mutation key, with article slug accepted only as a uniquely resolving selector
- **AND** the action SHALL record who requested republish, when, and why
- **AND** it SHALL either refresh the candidate/manifests first or explicitly confirm reuse of the existing candidate before returning the entry to `ready_for_batch`

#### Scenario: PR merges while deploy status is still unresolved

- **WHEN** a publisher PR merges
- **AND** production deploy status is still unknown or actively running
- **THEN** the batch SHALL remain `merged_deploy_pending`
- **AND** the bound entries SHALL also move to `merged_deploy_pending`
- **AND** entries SHALL NOT be marked `published`

#### Scenario: Preview deploy observations do not change publish state

- **WHEN** deployment reconciliation sees preview or non-production deploy observations for the batch merge commit SHA
- **THEN** those observations SHALL be recorded only as audit detail
- **AND** they SHALL NOT move the batch out of `merged_deploy_pending`, `deploy_failed`, or `published`

#### Scenario: PR merges and deploy later fails terminally

- **WHEN** a publisher PR has merged
- **AND** deployment later reaches a terminal failed state
- **THEN** the batch SHALL move from `merged_deploy_pending` to `deploy_failed`
- **AND** the bound entries SHALL also move from `merged_deploy_pending` to `deploy_failed`
- **AND** entries SHALL NOT be marked `published` until deploy success is observed

#### Scenario: Newest terminal production deploy wins for the same merge commit

- **WHEN** deployment reconciliation sees multiple terminal production deploy observations for the same recorded merge commit SHA
- **THEN** the newest terminal production deploy observation by provider timestamp SHALL be the one that determines whether the batch is `published` or `deploy_failed`

#### Scenario: Failed deploy can return to pending on explicit redeploy observation

- **WHEN** a batch is in `deploy_failed` state
- **AND** deployment reconciliation later sees a newer in-progress production redeploy for the same merge commit SHA
- **THEN** the batch SHALL move back to `merged_deploy_pending` until that newer production deploy reaches a terminal result

#### Scenario: Deploy is bound to a specific batch deterministically

- **WHEN** a publisher PR merges
- **THEN** the batch SHALL record the merge commit SHA as the canonical deploy-binding key
- **AND** deployment reconciliation SHALL associate deploy observations to that batch by matching deployment source commit SHA to the recorded merge commit SHA
- **AND** observed deployment IDs MAY be stored as audit detail but SHALL NOT replace merge commit SHA as the canonical binding key

#### Scenario: Deploy succeeds

- **WHEN** publisher observes successful deployment for a merged batch
- **THEN** the batch SHALL move to `published`
- **AND** the entries in that batch SHALL also move to `published`

### Requirement: Publisher SHALL expose operator status

Tribunal SHALL provide a status view that separates daemon health, ledger backlog, publisher queue, conflicted entries, open batch PRs, and production merge state.

#### Scenario: Operator checks status

- **WHEN** an operator requests Tribunal status
- **THEN** the system SHALL report daemon lifecycle state separately from publisher queue state
- **AND** SHALL include counts for pending, in-progress, PASS, FAILED, EXHAUSTED, RUNNER_ERROR, `runtime_recovery_pending`, `runtime_requeued`, publishable, `batched` (meaning `publish_state` in `batch_selected|branch_pushed|pr_open|merged_deploy_pending|deploy_failed`), conflicted, and published entries
- **AND** SHALL include batch/entry `publish_state` counts such as branch_pushed, pr_open, merged_deploy_pending, deploy_failed, and abandoned
- **AND** SHALL identify the oldest unpublished terminal entry age
