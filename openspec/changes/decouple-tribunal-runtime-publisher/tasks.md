## 1. Tests First

- [ ] 1.1 Add a regression test proving the daemon loop uses fetch-only remote drift checks and never invokes pull/rebase/push in runtime mode.
- [ ] 1.2 Add ledger migration tests covering existing PASS, FAILED, EXHAUSTED, RUNNER_ERROR, stale in-progress -> `runtime_dispatch_state=runtime_requeued`, and topLevelAttempts shapes.
- [ ] 1.3 Add publisher batching tests for default 10 publishable PASS artifacts, configurable threshold, manual flush all-eligible behavior, and bounded manual flush size.
- [ ] 1.3a Add batch-selection tests for oldest-first ordering, stable entry ID tie-breaks, up-to-threshold selection, transitive overlap-component deterministic winner selection, and auto-run rollback behavior when post-validation survivors leave fewer than the threshold.
- [ ] 1.4 Add conflict tests for manifest path/base blob changes, zh/en paired files, and open editorial PRs touching the same publishable paths.
- [ ] 1.5 Add idempotency tests for publisher crash/retry and already-batched ledger entries.
- [ ] 1.6 Add non-blocking conflict tests proving clean entries still publish when conflicted entries are triaged.
- [ ] 1.7 Add event-driven triage tests for durable event schema, concrete comparison-target identifiers, deterministic fingerprints, legal state transitions, conflict/validation event creation in `open`, separation of intermediate action paths from final `resolution`, `awaiting_human`, `agent_merge`, `keep_current`, `accept_tribunal`, `validation_fix`, `requeue`, `defer`, `no_action`, `split`, grouped-conflict split-by-version + replayGroupId behavior, crash-safe grouped-event parent/child supersession ordering, deterministic validation replayGroupId derivation, grouped validation-blocked replayGroupId behavior, and deferred blocker re-entry through forced refresh/revalidation after non-publisher PR close/merge.
- [ ] 1.8 Add migration tests proving PASS/EXHAUSTED remain non-dispatchable, FAILED stays operator-visible until explicit requeue, and RUNNER_ERROR never counts toward publishable batches.
- [ ] 1.8a Add retry/recovery surface tests for stable ledger entry ID targeting, slug disambiguation, FAILED/RUNNER_ERROR successor-run creation rules, terminal PASS triage-defined runtime requeue, and closed `runtime_dispatch_state` enum/transition enforcement.
- [ ] 1.9 Add migration reconciliation tests for contradictory legacy records, tracked-versus-ignored source precedence, and migrated-ledger-versus-legacy precedence.
- [ ] 1.10 Add lifecycle tests for `publish_state` transitions across branch_pushed, pr_open, merged_deploy_pending, deploy_failed, published, and abandoned, plus separate `runtime_dispatch_state=runtime_requeued` behavior, including close-without-merge default abandonment and deploy-status reconciliation.

## 2. Runtime Ledger

- [ ] 2.1 Introduce ignored ledger directory and schema for per-article status, stage status, attempts, schema version, stable entry IDs, artifact manifest paths/base blobs/candidate digests, terminal outcome, triage refs, `runtime_dispatch_state`, and `publish_state`.
- [ ] 2.2 Implement locked atomic ledger read/write helpers.
- [ ] 2.3 Implement migration from tracked tribunal progress JSON into the ignored ledger with timestamped backup and explicit outcome-state mapping.
- [ ] 2.4 Update unscored article selection to read from the ledger instead of tracked progress JSON.
- [ ] 2.5 Update workers to write terminal outcomes and non-terminal progress to the ledger.
- [ ] 2.5a Implement the closed `runtime_dispatch_state` enum, legal transitions, and dispatch-eligibility rules used by startup/recovery reconciliation.
- [ ] 2.6 Define source-of-truth precedence between tracked progress, ignored progress artifacts, and migrated ledger state.
- [ ] 2.7 Implement explicit runtime retry/recovery surface for FAILED/RUNNER_ERROR with stable ledger entry ID targeting, slug resolution, audit trail, and `runtime_dispatch_state` updates.

## 3. Runtime Git Hygiene

- [ ] 3.1 Replace daemon-loop `git pull --rebase --autostash origin main` with fetch-only drift detection.
- [ ] 3.2 Emit ahead/behind/code-drift state without attempting automatic rebase recovery.
- [ ] 3.3 Ensure worker worktree sync remains safe and does not depend on a dirty daemon worktree.
- [ ] 3.4 Add operator guidance for drain/restart when new runtime code should take effect.

## 4. Publisher

- [ ] 4.1 Add publisher dry-run that lists publishable PASS artifacts, FAILED/EXHAUSTED metadata entries, conflicted entries, batched entries, validation-blocked entries, and already-published entries.
- [ ] 4.2 Add publisher apply mode that creates a clean worktree from `origin/main`.
- [ ] 4.2a Implement deterministic overlap-component collapse so publisher computes one winner per transitive manifest-overlap component before threshold sorting/selection.
- [ ] 4.3 Apply PASS article artifacts and batch metadata into the publisher worktree.
- [ ] 4.4 Detect conflicts by comparing stored artifact manifest base blobs with current `origin/main` and open non-publisher PRs touching the same paths.
- [ ] 4.5 Run candidate-level validation before commit and PR creation, isolating invalid candidates without blocking the whole batch.
- [ ] 4.5a Implement deterministic replay for whole-site build failures so failing candidates or minimal failing subsets create or update `validation_blocked` triage events rather than a separate publish state, including split-by-version behavior for mixed-version failing subsets and full batch-binding rollback when no survivor set can proceed.
- [ ] 4.6 Push a batch branch and open a PR with batch summary and validation proof.
- [ ] 4.7 Persist batch_selected identity and selected ledger entry IDs before external side effects, then durably add branch ref and PR identifiers as each step succeeds.
- [ ] 4.8 Split conflicted entries out of otherwise clean publisher batches.
- [ ] 4.9 Emit triage events for conflicted or validation-blocked entries with durable schema, ordered ledger entry IDs, aligned tribunalVersions/candidateManifests, concrete artifact-base digest, concrete comparison-target identifiers, deterministically derived replayGroupId where needed, dedup key, owner, and concise decision context.
- [ ] 4.10 Implement triage outcomes and legal transitions: keep_current, accept_tribunal, agent_merge, validation_fix, requeue, defer, no_action, and split, including event creation in `open`, separation of intermediate action paths from final `resolution`, their resulting ledger/publish-state transitions, crash-safe grouped-event parent/child supersession ordering, deferred blocker re-entry after non-publisher PR close/merge, and refresh-or-validation failure behavior while `agent_review` is in flight.
- [ ] 4.11 Reserve publisher branch prefix and label, and use them in open-PR conflict detection.
- [ ] 4.12 Reconcile publisher lifecycle after branch push, PR create/update, merge, deploy success, deploy failure, abandonment, and requeue, using merge commit SHA as the canonical deploy-binding key.
- [ ] 4.12a Mirror batch lifecycle transitions onto bound entry `publish_state` values at the same durable reconciliation steps.
- [ ] 4.13 Implement explicit republish action for `abandoned` entries with stable ledger entry ID targeting, audit trail, and candidate refresh/reuse rules before returning to `ready_for_batch`.

## 5. Operations

- [ ] 5.1 Add status command/report separating daemon health, ledger counts, publisher queue, conflicts, open PRs, and production merge state.
- [ ] 5.2 Add cron or timer policy for publisher runs, plus manual flush command.
- [ ] 5.3 Drain current Tribunal service, apply migration, restart, and observe one daemon cycle without dirty-worktree rebase noise.
- [ ] 5.4 Observe one publisher cycle and verify the PR/CI/prod path, including branch_pushed recovery and deploy-to-batch reconciliation by merge commit SHA.
- [ ] 5.5 Document rollback: disable publisher, stop runtime, restore backup progress, and restart previous code path.
