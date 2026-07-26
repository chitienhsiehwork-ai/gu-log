# Design: Post version manifest freshness automation

## Disposition（2026-07-25）

本 design 原先選擇 post-commit follow-up commit；PR #552 後來證明 pre-commit staged
projection 能在同一個 authored commit 內完成 repair，且不需要 recursion guard、dirty
worktree auto-commit policy 或額外 commit attribution。下列設計保留為被否決方案的歷史，
不是現行 implementation。archive delta 只同步已上線的 staged projection 與 layered
freshness policy。

## Current behavior

`scripts/build-version-manifest.mjs` counts commits touching
`src/content/posts/*.mdx` and writes `src/data/post-versions.json`.

Because the count is history-sensitive, running the generator before the final
content commit exists can still leave the committed manifest stale. CI catches
this through `tests/post-version-manifest.test.ts`, which validates the committed
manifest against a full-history checkout.

`scripts/hooks/pre-push` already helps: it checks freshness, regenerates the
manifest if stale, and aborts the push. The missing step is a repo-owned repair
that creates the required manifest commit without relying on the operator to
remember it.

## Proposed flow

Install a new `post-commit` hook:

```bash
scripts/hooks/post-commit
```

The hook calls a Node helper, for example:

```bash
node scripts/refresh-post-version-manifest-after-commit.mjs
```

The helper only runs when the latest commit touched posts:

```bash
git diff-tree --no-commit-id --name-only -r HEAD -- src/content/posts
```

If no post changed, it exits 0.

If a post changed, it:

1. Ensures the clone can see full history.
2. Runs `node scripts/build-version-manifest.mjs`.
3. Checks whether `src/data/post-versions.json` changed.
4. If unchanged, exits 0.
5. If changed, stages only `src/data/post-versions.json`.
6. Creates a generated follow-up commit:

   ```bash
   git commit -m "chore: refresh post version manifest"
   ```

## Recursion guard

The generated manifest commit must not trigger itself forever. Use an env guard:

```bash
GU_LOG_POST_VERSION_AUTOCOMMIT=1
```

The `post-commit` hook exits immediately when that variable is set. The helper
sets it only around the generated commit.

The helper should also no-op when the latest commit does not touch
`src/content/posts/*.mdx`, so a manifest-only commit is naturally ignored even
without the env guard.

## Shallow clone policy

The helper may try to deepen history locally:

```bash
git fetch --unshallow --quiet origin
# fallback:
git fetch --depth=2147483647 --quiet origin
```

If it still cannot get meaningful full history, it must not write an incomplete
manifest. It should print a clear warning and exit 0 so the content commit is
not blocked locally. `pre-push` and CI remain the blocking layers.

## Dirty worktree policy

The helper should be conservative. It may auto-commit only when:

- `HEAD` exists;
- the repo is not in merge, rebase, cherry-pick, or revert state;
- the latest commit is not itself the generated manifest commit;
- there are no staged changes before the helper stages the manifest;
- there are no unstaged changes to `src/data/post-versions.json` before
  regeneration;
- after regeneration, only `src/data/post-versions.json` changed.

If unrelated dirty files exist, the first implementation should refuse to
auto-commit and print the exact repair command. This avoids attributing a
generated commit to an unclear worktree state.

## Why follow-up commit instead of amend

Follow-up commit is noisier, but safer:

- it does not rewrite the commit the user or agent just created;
- it avoids surprises with signed commits and commit metadata;
- it works even when the authored commit already passed hooks;
- it keeps the generated repair visible and easy to inspect.

`pre-push` can still keep its existing "regenerate and abort" behavior as a
fallback. A future change may add an explicit `--amend` repair command for
agents, but the default long-term guardrail should not rewrite history.

## Pre-push and CI remain final gates

Do not remove the existing checks:

- `pre-push` still catches missing or failed `post-commit` hooks.
- CI still validates the committed manifest with full history.
- `scripts/build-version-manifest.mjs --check` should update its stale message
  to mention the new hook/helper and the manual fallback.

## Tests

Add synthetic repo tests for the helper:

- latest commit touches a post and stale manifest becomes a generated follow-up
  commit;
- generated manifest commit does not recurse;
- non-post commit exits without changes;
- shallow clone that cannot deepen does not write an incomplete manifest;
- dirty unrelated worktree refuses auto-commit and leaves actionable output;
- existing CI freshness test still fails stale manifests.

Extend hook integration tests to verify:

- `setup-hooks.sh` installs `post-commit`;
- `post-commit` invokes the helper;
- `pre-push` remains a fallback when the hook is missing.

## Rollout

1. Implement helper and hook.
2. Add tests.
3. Update setup-hooks.
4. Update docs and agent playbooks.
5. Observe a few content PRs before considering CI auto-commit or amend mode.
