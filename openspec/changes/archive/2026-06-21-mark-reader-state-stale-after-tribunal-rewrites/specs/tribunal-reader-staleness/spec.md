## ADDED Requirements

### Requirement: Tribunal rewrites invalidate current-read status

When tribunal changes reader-visible article content, the article's reader-facing revision SHALL change so existing read records for older revisions become stale reads.

#### Scenario: Tribunal rewrites article body

- **GIVEN** a user read an article at revision `A`
- **AND** tribunal rewrites reader-visible content
- **WHEN** the rewritten article is published with revision `B`
- **THEN** `B` SHALL differ from `A`
- **AND** the user's old read record SHALL be displayed as stale read

### Requirement: Score-only updates shall not stale reader reads

Tribunal score or metadata updates SHALL NOT change reader-facing revision when reader-visible article content is unchanged.

#### Scenario: Tribunal writes judge scores only

- **GIVEN** an article's reader-visible content is unchanged
- **WHEN** tribunal updates judge scores or runtime metadata
- **THEN** the reader-facing revision SHALL remain unchanged
- **AND** existing current read records SHALL remain current

#### Scenario: Tribunal updates judge metadata in MDX frontmatter

- **GIVEN** an article's reader-visible reread content is unchanged
- **WHEN** tribunal updates judge score, model name, score date, or runtime metadata
- **THEN** the reader-facing revision SHALL remain unchanged
- **AND** Reader Tracker SHALL NOT mark current reads stale solely because of that metadata update

### Requirement: Tribunal runtime version is not article revision

The system SHALL NOT use tribunal runtime version as the article revision for Reader Tracker stale-read decisions.

#### Scenario: Tribunal runtime version changes

- **GIVEN** tribunal runtime changes from one version to another
- **WHEN** no reader-visible article content changes
- **THEN** Reader Tracker SHALL NOT mark read records stale solely because of the runtime version change

### Requirement: Staleness depends on version-aware read records

Tribunal reader staleness SHALL depend on stored read revision and current reader-facing revision.

#### Scenario: Reader Tracker evaluates a rewritten article

- **GIVEN** a read record stores the revision that was current when the article was read
- **AND** the current reader-facing revision differs
- **WHEN** Reader Tracker renders the article
- **THEN** it SHALL show the article as previously read but updated since read
