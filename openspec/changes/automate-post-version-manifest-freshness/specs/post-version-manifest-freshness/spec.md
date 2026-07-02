## ADDED Requirements

### Requirement: Post-changing commits SHALL leave the post version manifest fresh

When a local commit changes `src/content/posts/*.mdx`, gu-log SHALL attempt to
refresh `src/data/post-versions.json` after the commit exists in git history.

#### Scenario: Commit changes a post

- GIVEN a local commit touches `src/content/posts/*.mdx`
- WHEN the commit completes locally
- THEN automation SHALL run the post version manifest generator against the new `HEAD`
- AND `src/data/post-versions.json` SHALL be made fresh before push readiness when full history is available

#### Scenario: Manifest changes after regeneration

- GIVEN post-commit regeneration changes `src/data/post-versions.json`
- WHEN local git hooks are installed and the worktree is safe for generated commits
- THEN automation SHALL create a separate generated follow-up commit
- AND the generated commit SHALL NOT touch post MDX files

#### Scenario: Hook cannot safely regenerate

- GIVEN full git history is unavailable or the worktree is unsafe for generated commits
- WHEN the post-commit automation runs
- THEN it SHALL NOT write or commit an incomplete manifest
- AND it SHALL print an actionable fallback

### Requirement: Freshness checks SHALL remain layered

Pre-push and CI SHALL remain blocking guards even when post-commit automation
exists.

#### Scenario: Hook missing or skipped

- GIVEN a contributor does not have local hooks installed or skips local hooks
- WHEN they push stale `src/data/post-versions.json`
- THEN pre-push or CI SHALL fail with an actionable message

#### Scenario: CI validates the committed manifest

- GIVEN a pull request changes reader-visible post history
- WHEN CI runs unit tests
- THEN `tests/post-version-manifest.test.ts` SHALL validate that the committed manifest matches full git history
