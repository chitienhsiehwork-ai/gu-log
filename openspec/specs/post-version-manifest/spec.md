# post-version-manifest Specification

## Purpose
Define how gu-log exposes reader-facing article revisions so Reader Tracker and article pages can compare stored read records against the currently visible article version without treating metadata-only churn as reread-relevant content change.

## Requirements
### Requirement: Articles expose reader-facing revisions

The site SHALL expose a reader-facing revision for each published article that Reader Tracker can compare against stored read records. This revision SHALL be derived from reader-visible content, not from raw file commit count alone.

#### Scenario: Tracker renders article rows

- **GIVEN** Reader Tracker renders a published article
- **WHEN** the article row is created
- **THEN** the row SHALL have access to the article's current reader-facing revision

### Requirement: Revision source is shared

Article pages and Reader Tracker SHALL use a shared source for current article revision.

#### Scenario: Article page and tracker compare versions

- **GIVEN** an article has a current revision
- **WHEN** the article page records a read
- **AND** Reader Tracker later displays that article
- **THEN** both SHALL use the same revision source

### Requirement: Read-relevant revision shall avoid metadata-only churn

The reader-facing revision SHALL represent changes that matter to a reader's need to reread the article, and SHALL avoid changing solely because backend-only metadata changed.

#### Scenario: Only backend scoring metadata changes

- **GIVEN** an article's reader-visible body is unchanged
- **AND** only backend scoring metadata changes
- **WHEN** the site computes read-relevant revision
- **THEN** the revision SHALL NOT change solely because of that metadata update
