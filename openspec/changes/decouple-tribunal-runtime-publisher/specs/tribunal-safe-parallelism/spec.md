## MODIFIED Requirements

### Requirement: Shared sync side effects SHALL be serialized

Even though workers use isolated worktrees, shared git integration side effects SHALL be serialized and SHALL be owned by the publisher path, not by concurrent workers or the long-running supervisor loop.

Workers MAY write runtime ledger entries and publishable artifacts into ignored runtime state using the shared locking rules. The supervisor MAY fetch remote refs for observation. Workers and supervisor SHALL NOT directly pull, rebase, merge, push, or create production-facing commits from the daemon worktree.

#### Scenario: Two workers finish near the same time

- **WHEN** worker A and worker B finish their respective articles near the same time
- **THEN** each worker SHALL serialize writes to the runtime ledger
- **AND** neither worker SHALL push or rebase a shared branch
- **AND** publisher SHALL later serialize integration of eligible terminal results into a batch PR

#### Scenario: Publisher integrates multiple worker outputs

- **WHEN** publisher selects terminal entries from multiple workers
- **THEN** publisher SHALL integrate them from a clean checkout
- **AND** SHALL create at most one branch/PR for that batch
- **AND** SHALL record batch membership so repeated publisher runs remain idempotent
