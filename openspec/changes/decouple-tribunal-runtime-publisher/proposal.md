## Why

Tribunal currently uses the same git worktree as long-running runtime state, shared progress ledger, and publishing surface. That coupling makes the daemon accumulate local commits, dirty post files, and remote drift while still trying to `git pull --rebase`, which creates repeated runtime noise and can block safe updates.

We want the more correct architecture: Tribunal may run continuously, but publishing to remote/prod must happen through small, reviewable batch PRs instead of daemon-local rebases or one huge final commit.

## What Changes

- **BREAKING**: The long-running Tribunal daemon will no longer treat tracked repo files as its primary runtime ledger.
- Move Tribunal runtime progress, claims, terminal result records, and batch queue state into ignored `.score-loop/state/` artifacts.
- Add a publisher that materializes publishable Tribunal PASS artifacts into batch PRs, defaulting to about 10 publishable PASS artifacts per PR.
- Require publisher PRs to be built from a clean worktree based on `origin/main`, not from the daemon's dirty runtime worktree.
- Require conflict detection when a human, Iris, Clawd, or another branch changes the same post after Tribunal evaluated it.
- Add event-driven conflict triage: ambiguous/conflicted posts create a human-facing decision event, while unambiguous publishable posts continue into batch PRs.
- Require runtime update checks to use fetch/observability only; daemon loops must not pull, rebase, or push the main worktree while workers are active.
- Preserve TDD coverage for migration, ledger idempotency, batching thresholds, conflict handling, and no-runtime-rebase behavior.

## Capabilities

### New Capabilities

- `tribunal-runtime-publishing`: Defines the decoupled runtime ledger, publisher queue, batch PR policy, and conflict handling between Tribunal output and human/agent edits.

### Modified Capabilities

- `tribunal-run-control`: Long-running runtime must not mutate its own tracked worktree through pull/rebase/push during daemon operation.
- `tribunal-safe-parallelism`: Shared git integration side effects move from workers/supervisor into the serialized publisher path.

## Impact

- Affected scripts likely include `scripts/tribunal.sh`, `scripts/tribunal-quota-loop.sh`, `scripts/tribunal-publish-worker-changes.sh`, and new publisher/migration scripts.
- Runtime state moves from tracked `scores/tribunal-progress.json` semantics toward ignored ledger files under `.score-loop/state/`.
- CI and production deploy become driven by publisher PRs instead of daemon-local commits.
- Existing Tribunal progress must be migrated without losing PASS / FAILED / EXHAUSTED / RUNNER_ERROR history.
- Migration SHALL preserve outcome semantics: PASS and EXHAUSTED remain non-dispatchable terminal outcomes, FAILED remains operator-visible and requeueable only by explicit policy, and RUNNER_ERROR remains non-publishable infrastructure failure.
- Operators gain clearer separation: daemon health, ledger state, publisher queue, PR status, and production status can be observed independently.
