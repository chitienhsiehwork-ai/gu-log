## ADDED Requirements

### Requirement: Tribunal SHALL defer full-site build to a final gate

Tribunal SHALL NOT run full `pnpm run build` after every `tribunal-writer` rewrite. It SHALL run full-site build only after all article judge stages have passed and before the article is marked PASS.

#### Scenario: Writer rewrite does not trigger full build immediately

- **WHEN** a judge stage fails and `tribunal-writer` rewrites the target post
- **THEN** the worker SHALL run cheap validation for the changed post files
- **AND** the worker SHALL NOT run full `pnpm run build` solely because the rewrite completed
- **AND** the worker SHALL continue the judge retry loop if cheap validation passes

#### Scenario: Article cannot pass without final full build

- **WHEN** all judge stages have passed for an article
- **THEN** the worker SHALL enter the final build gate before marking the article PASS
- **AND** the article SHALL NOT be marked PASS unless the final full `pnpm run build` succeeds after the final content changes

### Requirement: Tribunal SHALL run cheap validation after writer rewrites

Tribunal SHALL perform low-cost validation after each writer rewrite to catch common local errors before spending more judge tokens.

#### Scenario: Cheap validation passes

- **WHEN** `tribunal-writer` rewrites a post and cheap validation succeeds
- **THEN** the worker SHALL continue to re-score the current judge stage
- **AND** the worker SHALL preserve the writer's changes for the next judge attempt

#### Scenario: Cheap validation fails

- **WHEN** `tribunal-writer` rewrites a post and cheap validation fails
- **THEN** the worker SHALL log the validation failure
- **AND** the worker SHALL revert or repair the writer changes before continuing
- **AND** the worker SHALL NOT mark the article PASS based on unvalidated changes

### Requirement: Tribunal SHALL serialize full builds with a shared build lock

Tribunal SHALL use a blocking exclusive file lock for full-site builds so that, on one VM, at most one worker runs `pnpm run build` at a time.

#### Scenario: Multiple workers reach final build gate

- **WHEN** two or more workers reach the final build gate concurrently
- **THEN** exactly one worker SHALL hold the shared build lock and run `pnpm run build`
- **AND** the other workers SHALL wait for the same shared lock instead of starting concurrent builds
- **AND** after the first build releases the lock, the next waiting worker MAY acquire the lock and run its build

#### Scenario: Workers run in separate worktrees

- **WHEN** workers execute from separate worktree directories
- **THEN** all workers SHALL resolve the build lock to the same stable shared path rooted in the main repo runtime state
- **AND** the lock path SHALL NOT be relative to each worker worktree
- **AND** the lock path SHALL NOT include a date or other value that could diverge across workers during one daemon lifetime

### Requirement: Build timeout SHALL apply to build execution, not lock wait

Tribunal SHALL distinguish waiting for the build lock from executing the build.

#### Scenario: Worker waits behind another build

- **WHEN** a worker is waiting for the shared build lock
- **THEN** the worker SHALL log that it is waiting and the resolved lock path
- **AND** the build execution timeout SHALL NOT start until after the lock is acquired

#### Scenario: Build execution hangs or exceeds timeout

- **WHEN** a worker has acquired the build lock and `pnpm run build` exceeds the configured timeout
- **THEN** the build command SHALL be terminated
- **AND** the termination SHOULD include a kill-after grace period so child Astro/Vite processes that ignore SIGTERM are reaped
- **AND** the worker SHALL treat the final build as failed
- **AND** the lock SHALL be released when the build subprocess exits

### Requirement: Final build failures SHALL enter bounded repair, not PASS

If final full build fails, Tribunal SHALL treat it as a final gate failure and SHALL NOT mark the article PASS.

#### Scenario: Final build fails with content-actionable evidence

- **WHEN** final `pnpm run build` returns a non-zero exit code and the build log indicates syntax, schema, MDX, component render, or target-post validation failure
- **THEN** the worker SHALL log the exit code and build log tail
- **AND** the worker SHALL invoke a build repair path with the target post and build failure evidence
- **AND** the worker SHALL retry final build only up to a configured maximum attempt count
- **AND** if repair attempts are exhausted, the article SHALL be marked FAILED or EXHAUSTED rather than PASS

#### Scenario: Final build fails with operational/resource evidence

- **WHEN** final `pnpm run build` returns a non-zero exit code and the evidence indicates timeout, exit 137, OOM-kill, Node/V8 fatal error, or infrastructure interruption
- **THEN** the worker SHALL log the failure as operational/resource-related
- **AND** the worker SHALL NOT blindly invoke writer repair as if the target post were broken
- **AND** the article SHALL NOT be marked PASS

### Requirement: Final build gate SHALL be observable

Tribunal SHALL emit enough structured log lines for operators to distinguish build lock waiting, build execution, build success, build failure, timeout, and likely OOM.

#### Scenario: Operator inspects Tribunal logs

- **WHEN** an operator reads the quota loop or article log
- **THEN** the log SHALL show when a worker begins waiting for the build lock
- **AND** when it acquires the lock
- **AND** how long the build ran
- **AND** whether the build passed or failed with its exit code
