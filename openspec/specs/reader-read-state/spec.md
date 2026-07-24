# reader-read-state Specification

## Purpose

定義版本感知的閱讀狀態、過期閱讀標記、統計口徑與 legacy 資料遷移契約，避免文章更新後仍把舊版閱讀紀錄誤判為目前版本已讀。

## Requirements

### Requirement: Read records include article revision

Reader Tracker SHALL persist read records with the article identity and the revision that was current when the read was recorded.

#### Scenario: User marks an article read

- **GIVEN** an article has a current reader-facing revision
- **WHEN** the user marks the article as read
- **THEN** the read record SHALL store the article identity
- **AND** it SHALL store the revision that was current at read time
- **AND** it SHALL store when the read happened

### Requirement: Stale reads are distinct from unread

Reader Tracker SHALL distinguish an article that was read at an older revision from an article that was never read.

#### Scenario: Article has changed since read

- **GIVEN** the user read an article at revision `A`
- **AND** the current reader-facing revision is `B`
- **WHEN** `A` and `B` differ
- **THEN** the tracker SHALL mark the article as stale read
- **AND** it SHALL NOT treat the article as never read

### Requirement: Progress counts current reads separately

Reader Tracker progress SHALL count only current reads as fully read.

#### Scenario: Progress includes stale reads

- **GIVEN** a series contains current reads, stale reads, and unread articles
- **WHEN** the tracker calculates progress
- **THEN** current reads SHALL count as completed
- **AND** stale reads SHALL be reported separately from completed reads

### Requirement: Legacy slug lists migrate without data loss

Reader Tracker SHALL migrate legacy slug-only read data without deleting known read history.

#### Scenario: Existing v1 local data is loaded

- **GIVEN** local reading data contains a v1 slug list
- **WHEN** the tracker loads the data
- **THEN** each slug SHALL become a read record
- **AND** the migration SHALL preserve that the user previously read the article
- **AND** the migration SHALL set unknown legacy revision to `null`
- **AND** the migrated record SHALL be displayed as known read with unknown revision, not silently current

### Requirement: Sync merge preserves per-post revision

Reader Tracker SHALL merge local and remote records per article while preserving read timestamp and read revision.

#### Scenario: Same article has different revisions across devices

- **GIVEN** one device read an article at revision `A`
- **AND** another device read the same article later at revision `B`
- **WHEN** the records are synced
- **THEN** the merged record SHALL preserve the latest read timestamp
- **AND** it SHALL preserve the read revision associated with that latest read
