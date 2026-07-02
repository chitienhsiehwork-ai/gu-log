## Context

The progress-only PASS incident happened because Phase 2 parallelism moved judge/writer execution into worker worktrees while `commit_progress()` performed git commits from the main repo. Shared `PROGRESS_FILE` correctly updated main progress state, but post rewrites and score frontmatter were local to the worker checkout. A PASS commit could therefore contain only progress JSON.

The key design rule is now:

> Tribunal progress is not sufficient evidence of production quality. A PASS commit must publish the target article artifacts.

## Guard Layers

### 1. Production postcondition

Before `commit_progress()` creates a final PASS commit, it must inspect the staged diff and fail if required target artifacts are missing.

Required artifacts:

- `src/content/posts/$POST_FILE`
- `src/content/posts/en-$POST_FILE` when that counterpart exists
- `scores.tribunalVersion: 3` in the published target frontmatter

This check runs after the worker artifact publish helper and after `git add`, but before `git commit`.

### 2. Historical audit

A standalone audit scans Tribunal PASS commits by subject and verifies that each commit contains the target post artifacts. This is intentionally separate from the runtime postcondition so it can detect regressions caused by future refactors, manual commits, or bypassed hooks.

### 3. Pre-push enforcement

The audit runs in pre-push for pushed main/master ranges. It should not scan all history by default because intentionally invalidated historical progress-only PASS commits exist before the fix; it only blocks new bad commits.

### 4. Daily production audit

A user systemd timer on the production VM runs the audit daily against the safe post-fix range `2b1bc361..origin/main`. This catches any bypass that reaches the remote outside normal local hooks.

## Trade-offs

- Requiring EN artifact only when an EN counterpart exists preserves zh-tw-first workflow for posts that legitimately do not have English yet.
- The postcondition checks `scores.tribunalVersion: 3` using textual frontmatter grep. This is simple and robust enough for shell runtime; schema-level validation remains covered by existing post validation/build gates.
- Historical audit relies on commit subject convention. Tribunal automation controls these commit messages, and tests cover the expected pattern.

## Failure Handling

If the postcondition fails, Tribunal must not commit PASS. It should fail loudly in logs and leave the article unpassed rather than pretending progress is OK.

If the daily audit fails, the service exits nonzero. Operators should inspect the named commit(s), invalidate bad progress entries if needed, and fix publishing before resuming trust in new PASS metadata.
