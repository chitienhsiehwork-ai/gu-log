## 1. Tests First

- [ ] 1.1 Add a regression test proving the daemon loop uses fetch-only remote drift checks and never invokes pull/rebase/push in runtime mode.
- [ ] 1.2 Add ledger migration tests covering existing PASS, FAILED, EXHAUSTED, RUNNER_ERROR, stale in-progress, and topLevelAttempts shapes.
- [ ] 1.3 Add publisher batching tests for default 10 terminal results, configurable threshold, and manual flush.
- [ ] 1.4 Add conflict tests where a post changed on origin/main after Tribunal artifact base SHA.
- [ ] 1.5 Add idempotency tests for publisher crash/retry and already-batched ledger entries.
- [ ] 1.6 Add non-blocking conflict tests proving clean entries still publish when conflicted entries are triaged.
- [ ] 1.7 Add event-driven triage tests for ask-Sprin, agentic-merge, keep-current, accept-Tribunal, and requeue decisions.

## 2. Runtime Ledger

- [ ] 2.1 Introduce ignored ledger directory and schema for per-article status, stage status, attempts, base SHA, artifact paths, terminal outcome, and publish state.
- [ ] 2.2 Implement locked atomic ledger read/write helpers.
- [ ] 2.3 Implement migration from tracked tribunal progress JSON into the ignored ledger with timestamped backup.
- [ ] 2.4 Update unscored article selection to read from the ledger instead of tracked progress JSON.
- [ ] 2.5 Update workers to write terminal outcomes and non-terminal progress to the ledger.

## 3. Runtime Git Hygiene

- [ ] 3.1 Replace daemon-loop `git pull --rebase --autostash origin main` with fetch-only drift detection.
- [ ] 3.2 Emit ahead/behind/code-drift state without attempting automatic rebase recovery.
- [ ] 3.3 Ensure worker worktree sync remains safe and does not depend on a dirty daemon worktree.
- [ ] 3.4 Add operator guidance for drain/restart when new runtime code should take effect.

## 4. Publisher

- [ ] 4.1 Add publisher dry-run that lists publishable, conflicted, batched, and already-published ledger entries.
- [ ] 4.2 Add publisher apply mode that creates a clean worktree from `origin/main`.
- [ ] 4.3 Apply PASS article artifacts and batch metadata into the publisher worktree.
- [ ] 4.4 Detect post conflicts by comparing stored artifact base SHA with current `origin/main` path history.
- [ ] 4.5 Run required validation before commit and PR creation.
- [ ] 4.6 Push a batch branch and open a PR with batch summary and validation proof.
- [ ] 4.7 Mark ledger entries with batch/PR identifiers only after branch/PR creation succeeds.
- [ ] 4.8 Split conflicted entries out of otherwise clean publisher batches.
- [ ] 4.9 Emit triage events for conflicted entries with concise decision context.
- [ ] 4.10 Implement triage outcomes: keep current, accept Tribunal, agentic merge, requeue, and defer.

## 5. Operations

- [ ] 5.1 Add status command/report separating daemon health, ledger counts, publisher queue, conflicts, open PRs, and production merge state.
- [ ] 5.2 Add cron or timer policy for publisher runs, plus manual flush command.
- [ ] 5.3 Drain current Tribunal service, apply migration, restart, and observe one daemon cycle without dirty-worktree rebase noise.
- [ ] 5.4 Observe one publisher cycle and verify the PR/CI/prod path.
- [ ] 5.5 Document rollback: disable publisher, stop runtime, restore backup progress, and restart previous code path.
