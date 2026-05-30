## ADDED Requirements

### Requirement: Long-running runtime SHALL NOT integrate git history in its daemon worktree

The long-running Tribunal runtime SHALL NOT run pull, rebase, merge, or push operations that mutate the daemon worktree's tracked history while the daemon loop is active.

#### Scenario: Runtime observes remote drift

- **WHEN** the daemon needs to know whether `origin/main` has changed
- **THEN** it MAY run `git fetch origin main`
- **AND** it SHALL report ahead / behind status in logs or state
- **AND** it SHALL NOT run `git pull`, `git rebase`, `git merge`, or `git push` from the daemon worktree

#### Scenario: Daemon worktree has local runtime artifacts

- **WHEN** the daemon worktree contains local commits or modified files
- **AND** `origin/main` has advanced
- **THEN** runtime SHALL continue safe operation using existing code and ledger state
- **AND** SHALL mark code drift as an operator/publisher concern
- **AND** SHALL NOT attempt automatic rebase recovery

#### Scenario: Runtime code update is required

- **WHEN** a merged Tribunal code change must reach the long-running daemon
- **THEN** operators SHALL drain or stop the daemon at an article boundary
- **AND** update/restart from a clean code snapshot
- **AND** runtime SHALL resume from ignored ledger state after restart
