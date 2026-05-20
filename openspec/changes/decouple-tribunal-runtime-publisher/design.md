## Context

The current Tribunal daemon is doing too many jobs in one git worktree:

- runtime coordination: claims, quota state, lifecycle state, worker dispatch
- result ledger: article status, stage status, attempts, terminal outcomes
- publishing: copying worker artifacts into the main worktree, committing results, and trying to keep up with `origin/main`

This worked while throughput was small, but it breaks down once Tribunal runs for hours. The main runtime branch can become `ahead N, behind M` while also containing dirty post files. A daemon loop that repeatedly runs `git pull --rebase --autostash` in that state is doing a human/publisher job from an unsafe environment.

Sprin's product expectation is also batch-shaped: publishable Tribunal PASS artifacts should sync to remote/prod through PRs in small batches, roughly every 10 publishable PASS artifacts, so Clawd/Iris/humans can still rewrite phrasing on individual posts without the daemon blindly overwriting them.

## Goals / Non-Goals

**Goals:**

- Separate Tribunal runtime from production publishing.
- Make the daemon safe to run for long periods without accumulating a dirty tracked worktree.
- Persist runtime progress in ignored, restart-safe ledger files.
- Publish publishable PASS artifacts through small batch PRs, with CI and conflict checks.
- Prefer human/Iris/Clawd editorial changes over stale Tribunal rewrites when both touch the same post.
- Preserve enough state in OpenSpec so implementation can resume after context compaction.

**Non-Goals:**

- This change does not redesign judge prompts or article scoring standards.
- This change does not make every FAILED / EXHAUSTED article production-visible by default.
- This change does not require solving all historical Tribunal commits in the same PR.
- This change does not allow the daemon to direct-push main.

## Decisions

### Decision 1: Runtime ledger lives outside tracked git files

Tribunal SHALL write canonical runtime state under `.score-loop/state/tribunal-ledger/` or an equivalent ignored directory. The canonical shape should be per-article JSON files plus an append-only journal or audit stream. Every ledger record must include a schema version, stable entry ID, article slug, Tribunal version, outcome state, attempt counters, `runtime_dispatch_state`, `publish_state`, timestamps, and artifact manifest metadata. `runtime_dispatch_state` must be a closed state machine with explicit legal values and transitions so restart/recovery behavior is deterministic, and terminal entries stay immutable while retries/recoveries create successor run targets with predecessor linkage. Stable entry ID is the primary runtime identity; article slug is human-facing lookup only and must not by itself decide requeue/recovery when multiple versions or entries exist. Writes must use atomic replacement or append plus serialized locks.

Alternative considered: keep using `scores/tribunal-progress.json` as the canonical ledger. This keeps production-visible state simple, but it forces every runtime update into the git working tree and recreates the dirty-worktree problem.

### Decision 2: Publisher is the only path from ledger to PR

A new publisher command SHALL read terminal ledger entries, select a batch, create a clean worktree from `origin/main`, apply publishable artifacts, run validation, commit, push a branch, and open a PR.

Alternative considered: let `tribunal-quota-loop.sh` keep committing locally and periodically push. This is simpler but keeps runtime and publishing coupled, and still leaves daemon-local rebase conflicts.

### Decision 3: Default batch trigger is 10 publishable PASS artifacts

The default publishing threshold SHALL be 10 publishable PASS artifacts. A publishable artifact means:

- Tribunal outcome is PASS
- artifact manifest exists
- no `conflict` or `validation_blocked` triage event exists for that entry in a blocking state (`open`, `agent_review`, `awaiting_human`, or `deferred`)
- entry is not already batched, published, or abandoned

Here, `batched` means `publish_state` is one of `batch_selected`, `branch_pushed`, `pr_open`, `merged_deploy_pending`, or `deploy_failed`.

The threshold should be configurable, and a manual flush should exist for urgent publishing.

FAILED / EXHAUSTED outcomes SHALL be represented in operator-facing metadata and status views, but SHALL NOT count toward the PR threshold and SHALL NOT by themselves create production-bound artifact PRs. RUNNER_ERROR SHALL be excluded from publishable batches entirely.

Batch selection SHALL be oldest-first by terminal PASS timestamp, with stable entry ID ascending as the required tie-break. Auto publisher runs SHALL first exclude entries with `conflict` or `validation_blocked` triage events in blocking states (`open`, `agent_review`, `awaiting_human`, or `deferred`); those blocked conditions are derived from triage events, not separate publish lifecycle states. It SHALL then partition the remaining eligible entries by the full transitive connected components of the candidate-manifest-overlap graph, where an edge exists whenever two entries overlap on one or more publish paths. At most one candidate per connected component is selectable in a given scan. The deterministic winner for each component is the newest terminal PASS timestamp; stable entry ID descending is the required tie-break when timestamps match. Non-winning overlapping entries stay in their current publish state, are excluded from that scan's threshold count and batch selection, and may only be reconsidered on later scans after the winning candidate resolves or a later triage decision changes eligibility. Only after this collapse step does publisher sort the winner set by oldest terminal PASS timestamp plus stable entry ID ascending and tentatively select up to the configured threshold. If post-validation survivors fall below the configured threshold, the auto run SHALL create no PR, clear any provisional batch binding for those survivors, and restore their `publish_state` to `ready_for_batch`. Manual flush MAY publish fewer than the threshold, and when manual flush omits an explicit size it SHALL publish all currently eligible artifacts.

Alternative considered: publish every article. That reduces latency but creates review noise and more CI churn. One giant commit after the backlog finishes is also rejected because it is too large to review and too risky to conflict with editorial edits.

### Decision 4: Conflict policy is manifest-and-base aware

Each publishable ledger entry SHALL record an artifact manifest for every path it wants to publish, including at least:

- path
- base commit SHA
- base blob SHA
- candidate blob digest

The publisher SHALL compare that manifest to current `origin/main` and to open non-publisher PRs that touch the same manifest paths.

If any manifest path changed after the base, was renamed/deleted, or is already under active editorial review in another PR, the publisher SHALL mark that article as conflicted/requeue-needed and SHALL NOT overwrite it automatically. This protects Sprin, Iris, or Clawd editorial edits across zh/en paired files and shared publishable metadata.

For gu-log article publishing, a publishable PASS artifact should include the zh canonical post plus the English counterpart whenever that counterpart exists in the repo. Missing required pair files are validation failures, not silent zh-only publishes.

Publisher-owned PRs SHALL identify themselves with both a reserved branch prefix and a dedicated label. A PR missing either marker SHALL be treated as non-publisher for conflict detection, even if it appears to be publisher-related, so editorial PR detection is rule-based instead of guesswork.

Alternative considered: last-writer-wins. That is unacceptable for editorial content because phrasing edits are often the valuable human judgment, not noise.

### Decision 5: Conflicts are event-driven, durable, and non-blocking

Conflict handling SHALL behave like an airport customs lane:

- green lane: unambiguous PASS artifacts go into a batch PR and keep moving toward prod
- red lane: conflicted posts stop for inspection and trigger a decision event
- officer: OpenClaw / Clawd / Iris can summarize the conflict, propose options, and ask Sprin only when judgment is needed

The key rule is that one ambiguous post SHALL NOT block unrelated clean posts. The publisher should split the batch into publishable and blocked subsets, then send a durable triage event for the blocked subset with enough context to decide:

- keep current main wording
- accept Tribunal rewrite
- ask an agent to merge both
- requeue Tribunal after human/Iris/Clawd edits

Resolution outcomes also need canonical state effects. `keep_current` and `no_action` close the event and abandon the current candidate for this ledger entry version. `accept_tribunal`, `agent_merge`, and `validation_fix` require writing a refreshed candidate artifact plus refreshed manifest against current comparison targets before the entry may return to `ready_for_batch`. If the current comparison target is still an open non-publisher PR after refresh succeeds, the event MUST move to `deferred` rather than `closed`, and the entry stays blocked until that PR closes/merges or the work is applied into that PR through a separate editorial flow. `requeue` does not mutate the existing terminal PASS entry back to runnable; it creates a successor run target with its own stable entry ID and predecessor linkage for another Tribunal pass while the current publish candidate is abandoned. `defer` preserves the current `publish_state` and relies on the deferred triage event itself to keep the entry blocked from selection.

Each triage event should have ordered ledger entry IDs, ordered article slugs, a dedup key, a concrete artifact-base digest, content-stable comparison-target identifiers, closed event kind enum, closed processing-state enum, owner, timestamps, retry semantics, explicit resolution outcome, a legal transition map, and optional parent/child linkage fields so OpenClaw can be event-driven instead of relying on chat memory. Blocking is derived from triage event states `open`, `agent_review`, `awaiting_human`, and `deferred`; `resolved`, `requeued`, and `closed` are non-blocking. Conflict events group by exact ordered ledger entry IDs plus exact ordered comparison targets from one publisher scan; mixed-version grouped conflicts are represented as per-version events linked by a shared `replayGroupId`. Validation-blocked events group by exact ordered ledger entry IDs from one deterministic replay result. When a grouped event is split into child events, those child events must be durably recorded in active blocking states before the parent event closes as a non-blocking audit shell linked to them.

Alternative considered: stop the whole publisher batch on first conflict. That preserves safety but wastes throughput and makes Tribunal feel broken whenever one article needs judgment.

### Decision 6: Validation failures are isolated per candidate

Publisher validation should fail closed per candidate, not per whole batch. Validation happens in two layers:

- candidate preflight: per-article and pair-level checks before a candidate enters the batch
- batch integration gate: whole-site build and integration checks after the candidate set is assembled

If a whole-site gate fails, publisher SHALL isolate the failing candidate set by deterministic replay over the selected candidates until it can create or update `validation_blocked` triage events for the failing candidate or minimal failing subset. Replay continues iteratively until either a surviving batch actually passes whole-site validation under the active run mode, or no surviving batch can continue. The remaining valid candidates may continue only if the surviving set still satisfies the active run mode policy: at least the configured threshold for auto runs, or at least one eligible artifact for manual flush. If the surviving set cannot continue, implementation SHALL clear batch bindings for all selected entries and restore their `publish_state` to `ready_for_batch`, with failing entries remaining blocked only through their triage events.

Alternative considered: cancel the whole batch on the first validation failure. That is simpler, but it recreates the same throughput problem as conflict-wide blocking.

### Decision 7: Publish lifecycle is explicit end-to-end

Publisher and ledger entries SHALL move through explicit `publish_state` lifecycle states from ready_for_batch to batch_selected, branch_pushed, pr_open, merged_deploy_pending, published, deploy_failed, or abandoned. Entry-level `publish_state` SHALL mirror the bound batch lifecycle once a batch identity is recorded, so eligibility/idempotency/status logic sees the same durable state on both the batch and its member entries. Failed transitions such as branch push success but PR creation failure, closed-without-merge, or merge-with-deploy-failure must be observable and recoverable without duplicate publication. Recovery rules are fixed: publisher SHALL durably record batch_selected identity and selected entry IDs before external side effects, branch push success but PR creation failure SHALL reuse that same batch identity and branch, close-without-merge defaults to abandoned until an explicit action returns the entry to `ready_for_batch`, and merged_deploy_pending is keyed by the batch merge commit SHA plus observed deployment IDs. Only production deploy observations can advance publish state; previews are audit-only. For a given merge commit, the newest terminal production deploy observation wins, and a newer in-progress production redeploy may move a batch from deploy_failed back to merged_deploy_pending.

### Decision 8: Runtime update checks are fetch-only

The long-running runtime MAY run `git fetch origin main` to observe remote drift and sync worker worktrees before dispatch, but SHALL NOT run `git pull`, `git rebase`, or `git push` in the runtime main worktree.

If code updates are needed, the operator should drain/restart the daemon. This is less hot-reload friendly, but it is much safer and easier to reason about.

## Risks / Trade-offs

- Migration bug could lose or misclassify progress -> write a migration test using real current status shapes and keep a backup snapshot.
- Publisher queue may lag behind runtime -> expose queue counts and oldest terminal entry age.
- Batch PRs can conflict with human/Iris/Clawd edits -> detect by manifest path/base blob and skip conflicted articles rather than overwriting.
- Conflict events can annoy Sprin if too noisy -> dedup events by conflict fingerprint and only escalate to human when deterministic agentic merge rules do not apply.
- Production will see results later than daemon completion -> default 10-PASS threshold plus manual flush balances latency and reviewability.
- One invalid candidate could stall a batch -> create or update `validation_blocked` triage events and continue with remaining clean entries.
- Whole-site failures can still be combinatorial -> require deterministic replay policy and surface unresolved minimal failing subsets as blocked instead of guessing.
- More moving parts -> keep interfaces boring: ledger writer, publisher, migration, status command, tests.
- Existing service may still have dirty state during migration -> implement and verify in a clean worktree, then drain/restart runtime when applying.

## Migration Plan

1. Add tests and ledger writer/reader while keeping current behavior intact.
2. Migrate existing `scores/tribunal-progress.json` into the ignored ledger and keep a timestamped backup.
3. Change runtime writes to ledger files and stop treating tracked progress JSON as canonical.
4. Replace daemon `git pull --rebase` with fetch-only drift detection.
5. Add publisher dry-run and conflict detection.
6. Enable publisher batch PR creation after candidate-level validation passes.
7. Add explicit lifecycle reconciliation for branch/PR/merge/deploy state.
8. Drain/restart the existing service and observe at least one publish cycle.

Rollback: disable publisher, stop runtime, restore the backed-up tracked progress file, and restart the previous daemon code path from the pre-change commit.

## Open Questions

- Should FAILED / EXHAUSTED results ever appear on production pages, or remain operator-only?
- Should publisher PRs auto-merge when only Tribunal PASS artifacts are included and CI is green?
- What additional signals beyond disjoint hunks and metadata-only overlap should permit deterministic agentic merge without asking Sprin?
