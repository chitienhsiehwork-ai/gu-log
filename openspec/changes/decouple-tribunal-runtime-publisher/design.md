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

Tribunal SHALL write canonical runtime state under `.score-loop/state/tribunal-ledger/` or an equivalent ignored directory. The canonical shape should be per-article JSON files plus an append-only journal or audit stream. Every ledger record must include a schema version, stable entry ID, article slug, Tribunal version, outcome state, attempt counters, publish state, timestamps, and artifact manifest metadata. Writes must use atomic replacement or append plus serialized locks.

Alternative considered: keep using `scores/tribunal-progress.json` as the canonical ledger. This keeps production-visible state simple, but it forces every runtime update into the git working tree and recreates the dirty-worktree problem.

### Decision 2: Publisher is the only path from ledger to PR

A new publisher command SHALL read terminal ledger entries, select a batch, create a clean worktree from `origin/main`, apply publishable artifacts, run validation, commit, push a branch, and open a PR.

Alternative considered: let `tribunal-quota-loop.sh` keep committing locally and periodically push. This is simpler but keeps runtime and publishing coupled, and still leaves daemon-local rebase conflicts.

### Decision 3: Default batch trigger is 10 publishable PASS artifacts

The default publishing threshold SHALL be 10 publishable PASS artifacts. A publishable artifact means:

- Tribunal outcome is PASS
- artifact manifest exists
- no unresolved conflict or validation-blocked state exists
- entry is not already batched or published

The threshold should be configurable, and a manual flush should exist for urgent publishing.

FAILED / EXHAUSTED outcomes SHALL be represented in operator-facing metadata and status views, but SHALL NOT count toward the PR threshold and SHALL NOT by themselves create production-bound artifact PRs. RUNNER_ERROR SHALL be excluded from publishable batches entirely.

Batch selection SHALL be oldest-first by terminal PASS timestamp. Auto publisher runs SHALL scan the eligible publishable pool in order and select up to the configured threshold. Conflicted or validation-blocked candidates are excluded before counting. Auto runs SHALL create a PR only when the filtered batch reaches the configured threshold; manual flush MAY publish fewer.

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

Publisher-owned PRs SHALL identify themselves with both a reserved branch prefix and a dedicated label, so editorial PR detection is rule-based instead of guesswork.

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

Each triage event should have a dedup key, closed event kind enum, closed processing-state enum, owner, timestamps, retry semantics, and explicit resolution outcome so OpenClaw can be event-driven instead of relying on chat memory.

Alternative considered: stop the whole publisher batch on first conflict. That preserves safety but wastes throughput and makes Tribunal feel broken whenever one article needs judgment.

### Decision 6: Validation failures are isolated per candidate

Publisher validation should fail closed per candidate, not per whole batch. Validation happens in two layers:

- candidate preflight: per-article and pair-level checks before a candidate enters the batch
- batch integration gate: whole-site build and integration checks after the candidate set is assembled

If a whole-site gate fails, publisher SHALL isolate the failing candidate set by deterministic replay over the selected candidates until it can move the failing candidate or minimal failing subset into validation-blocked state. The remaining valid candidates may continue, as long as at least one valid publishable artifact remains.

Alternative considered: cancel the whole batch on the first validation failure. That is simpler, but it recreates the same throughput problem as conflict-wide blocking.

### Decision 7: Publish lifecycle is explicit end-to-end

Publisher and ledger entries SHALL move through explicit lifecycle states from ready_for_batch to batch_selected, branch_pushed, pr_open, merged_deploy_pending, published, deploy_failed, abandoned, or requeued. Failed transitions such as branch push success but PR creation failure, closed-without-merge, or merge-with-deploy-failure must be observable and recoverable without duplicate publication.

### Decision 8: Runtime update checks are fetch-only

The long-running runtime MAY run `git fetch origin main` to observe remote drift and sync worker worktrees before dispatch, but SHALL NOT run `git pull`, `git rebase`, or `git push` in the runtime main worktree.

If code updates are needed, the operator should drain/restart the daemon. This is less hot-reload friendly, but it is much safer and easier to reason about.

## Risks / Trade-offs

- Migration bug could lose or misclassify progress -> write a migration test using real current status shapes and keep a backup snapshot.
- Publisher queue may lag behind runtime -> expose queue counts and oldest terminal entry age.
- Batch PRs can conflict with human/Iris/Clawd edits -> detect by manifest path/base blob and skip conflicted articles rather than overwriting.
- Conflict events can annoy Sprin if too noisy -> dedup events by conflict fingerprint and only escalate to human when deterministic agentic merge rules do not apply.
- Production will see results later than daemon completion -> default 10-PASS threshold plus manual flush balances latency and reviewability.
- One invalid candidate could stall a batch -> isolate it into validation-blocked state and continue with remaining clean entries.
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
