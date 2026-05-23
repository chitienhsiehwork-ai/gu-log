## Context

The missing piece is not content validation or merge safety. Those already exist.

The real gap is orchestration:

- runtime ledger knows which articles are publishable,
- publisher knows how to materialize a clean batch PR,
- GitHub guard knows how to merge safe PRs,
- but no runtime actor loops over those states and pushes them forward.

So the design goal is simple: add one boring state pusher that keeps nudging batches from ready_for_batch to published, without inventing a second workflow engine.

## Design

### 1. New runtime helper: publisher autopilot

Add scripts/tribunal-publisher-autopilot.sh as a thin coordinator around existing primitives.

It has four responsibilities:

1. Reconcile merged batches
   - scan known publisher batches from .score-loop/state/tribunal-publisher.json
   - if a batch branch already has a merged PR into main, mark every batch entry published
   - record merge metadata (prNumber, mergeCommit, mergedAt, updatedAt)

2. Recover missing PRs
   - if a batch is branch_pushed but no PR exists yet, create the PR from the pushed branch
   - label it tribunal-publisher

3. Advance open publisher PRs
   - if a publisher PR is still draft, mark it ready for review
   - then invoke gu-log-auto-merge-guard.sh --pr <n>
   - guard remains the sole authority for CI/path/ruleset safety

4. Materialize new publishable PASS batches
   - call tribunal-publisher.sh --apply --push-pr
   - let publisher validation/build/conflict logic decide what is batchable

### 2. Loop wiring

The long-running supervisor should call autopilot once per loop iteration on a best-effort basis.

That placement matters:

- if scoring is active, publishing progresses alongside scoring
- if scoring is parked in weekly_debt or five_hour_debt, publishing still progresses
- if there are no unscored articles left, publish reconciliation still happens during idle loops

Autopilot failures must not kill scoring workers. They should log a warning and let the next iteration retry.

### 3. State model

Existing entry states:

- ready_for_batch
- batch_selected
- branch_pushed
- pr_open
- published

This change makes published real instead of dead vocabulary.

Transition rules:

- ready_for_batch -> batch_selected during apply
- batch_selected -> branch_pushed after push
- branch_pushed -> pr_open after PR creation or PR recovery
- pr_open -> published after merged PR reconciliation

### 4. Why not merge directly from the publisher script?

Because the publisher script owns batch materialization, not long-running GitHub polling/reconciliation.

Keeping merge/reconcile logic in autopilot gives two concrete benefits:

- publisher stays a bounded, testable batch materializer
- runtime supervisor gets one retryable hook that can keep nudging old batches forward

That boundary is cleaner than stuffing CI wait loops into tribunal-publisher.sh.

## Failure Handling

- If publisher apply fails validation/build/conflict checks, autopilot leaves scoring alone and retries next loop.
- If PR creation fails after branch push, the next autopilot run must recover it.
- If auto-merge guard denies a PR because checks are still pending, autopilot logs and retries next loop.
- If a PR was merged outside autopilot, reconciliation still marks the batch published on the next run.
