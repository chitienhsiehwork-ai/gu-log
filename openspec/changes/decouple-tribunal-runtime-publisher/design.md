## Context

The current Tribunal daemon is doing too many jobs in one git worktree:

- runtime coordination: claims, quota state, lifecycle state, worker dispatch
- result ledger: article status, stage status, attempts, terminal outcomes
- publishing: copying worker artifacts into the main worktree, committing results, and trying to keep up with `origin/main`

This worked while throughput was small, but it breaks down once Tribunal runs for hours. The main runtime branch can become `ahead N, behind M` while also containing dirty post files. A daemon loop that repeatedly runs `git pull --rebase --autostash` in that state is doing a human/publisher job from an unsafe environment.

Sprin's product expectation is also batch-shaped: Tribunal results should sync to remote/prod through PRs, roughly every 10 terminal runs, so Clawd/Iris/humans can still rewrite phrasing on individual posts without the daemon blindly overwriting them.

## Goals / Non-Goals

**Goals:**

- Separate Tribunal runtime from production publishing.
- Make the daemon safe to run for long periods without accumulating a dirty tracked worktree.
- Persist runtime progress in ignored, restart-safe ledger files.
- Publish terminal results through small batch PRs, with CI and conflict checks.
- Prefer human/Iris/Clawd editorial changes over stale Tribunal rewrites when both touch the same post.
- Preserve enough state in OpenSpec so implementation can resume after context compaction.

**Non-Goals:**

- This change does not redesign judge prompts or article scoring standards.
- This change does not make every FAILED / EXHAUSTED article production-visible by default.
- This change does not require solving all historical Tribunal commits in the same PR.
- This change does not allow the daemon to direct-push main.

## Decisions

### Decision 1: Runtime ledger lives outside tracked git files

Tribunal SHALL write canonical runtime state under `.score-loop/state/tribunal-ledger/` or an equivalent ignored directory. The ledger should be JSONL or per-article JSON files written with atomic rename and serialized locks.

Alternative considered: keep using `scores/tribunal-progress.json` as the canonical ledger. This keeps production-visible state simple, but it forces every runtime update into the git working tree and recreates the dirty-worktree problem.

### Decision 2: Publisher is the only path from ledger to PR

A new publisher command SHALL read terminal ledger entries, select a batch, create a clean worktree from `origin/main`, apply publishable artifacts, run validation, commit, push a branch, and open a PR.

Alternative considered: let `tribunal-quota-loop.sh` keep committing locally and periodically push. This is simpler but keeps runtime and publishing coupled, and still leaves daemon-local rebase conflicts.

### Decision 3: Default batch trigger is 10 terminal article results

The default publishing threshold SHALL be 10 terminal results, where terminal means PASS, FAILED, or EXHAUSTED. The threshold should be configurable, and a manual flush should exist for urgent publishing.

The batch PR SHOULD include PASS article artifacts. FAILED / EXHAUSTED outcomes SHALL be represented in operator-facing batch metadata; whether they become production UI is a separate product decision.

Alternative considered: publish every article. That reduces latency but creates review noise and more CI churn. One giant commit after the backlog finishes is also rejected because it is too large to review and too risky to conflict with editorial edits.

### Decision 4: Conflict policy is base-SHA based and human-friendly

Each ledger terminal entry SHALL record the post artifact base SHA used when the worker started or when the publishable artifact was produced. The publisher SHALL compare that base SHA to current `origin/main`.

If current `origin/main` changed the same post after that base, the publisher SHALL mark that article as conflicted/requeue-needed and SHALL NOT overwrite it automatically. This protects Sprin, Iris, or Clawd editorial edits.

Alternative considered: last-writer-wins. That is unacceptable for editorial content because phrasing edits are often the valuable human judgment, not noise.

### Decision 5: Runtime update checks are fetch-only

The long-running runtime MAY run `git fetch origin main` to observe remote drift and sync worker worktrees before dispatch, but SHALL NOT run `git pull`, `git rebase`, or `git push` in the runtime main worktree.

If code updates are needed, the operator should drain/restart the daemon. This is less hot-reload friendly, but it is much safer and easier to reason about.

## Risks / Trade-offs

- Migration bug could lose or misclassify progress -> write a migration test using real current status shapes and keep a backup snapshot.
- Publisher queue may lag behind runtime -> expose queue counts and oldest terminal entry age.
- Batch PRs can conflict with human/Iris/Clawd edits -> detect by base SHA and skip conflicted articles rather than overwriting.
- Production will see results later than daemon completion -> default 10-result threshold plus manual flush balances latency and reviewability.
- More moving parts -> keep interfaces boring: ledger writer, publisher, migration, status command, tests.
- Existing service may still have dirty state during migration -> implement and verify in a clean worktree, then drain/restart runtime when applying.

## Migration Plan

1. Add tests and ledger writer/reader while keeping current behavior intact.
2. Migrate existing `scores/tribunal-progress.json` into the ignored ledger and keep a timestamped backup.
3. Change runtime writes to ledger files and stop treating tracked progress JSON as canonical.
4. Replace daemon `git pull --rebase` with fetch-only drift detection.
5. Add publisher dry-run and conflict detection.
6. Enable publisher batch PR creation after validation passes.
7. Drain/restart the existing service and observe at least one publish cycle.

Rollback: disable publisher, stop runtime, restore the backed-up tracked progress file, and restart the previous daemon code path from the pre-change commit.

## Open Questions

- Should FAILED / EXHAUSTED results ever appear on production pages, or remain operator-only?
- Should the default batch trigger be exactly 10 terminal entries, or 10 PASS artifacts with FAILED / EXHAUSTED attached as metadata?
- Should publisher PRs auto-merge when only Tribunal PASS artifacts are included and CI is green?
