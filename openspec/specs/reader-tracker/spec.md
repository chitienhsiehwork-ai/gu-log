# reader-tracker Specification

## Purpose

定義 Reader Tracker 的 OAuth 優先同步、legacy PAT fallback 與文章 revision 可見性契約，讓閱讀狀態能安全跨裝置同步，並清楚揭露目前紀錄對應的內容版本。

## Requirements

### Requirement: OAuth-backed Reader Tracker sync UI

The Reader Tracker UI SHALL use the authenticated gu-log session to sync through the backend when a gu-log JWT is available.

#### Scenario: Signed-in user syncs without pasted GitHub token

- **GIVEN** a user has a gu-log JWT in browser storage
- **WHEN** they open the Reader Tracker page or click sync controls
- **THEN** the UI SHALL call the gu-log API Reader Tracker sync endpoint with the gu-log JWT
- **AND** the UI SHALL NOT require a manually pasted GitHub PAT for the primary sync path

#### Scenario: Backend asks for GitHub reauthorization

- **GIVEN** the backend returns `GITHUB_SCOPE_MISSING` for Reader Tracker sync
- **WHEN** the UI handles the error
- **THEN** the UI SHALL show a GitHub reauthorization action
- **AND** the UI SHALL use the backend-provided reauthorization URL when present

### Requirement: Legacy PAT fallback remains secondary

The Reader Tracker UI SHALL keep manually pasted GitHub PAT sync only as a secondary compatibility path.

#### Scenario: No gu-log session but legacy token exists

- **GIVEN** no gu-log JWT is available
- **AND** a legacy GitHub PAT is stored locally
- **WHEN** sync runs
- **THEN** the UI MAY use the legacy direct Gist flow
- **AND** this path SHALL not be presented as the primary signed-in experience

### Requirement: Reader revision visibility

The Reader Tracker UI SHALL distinguish posts read at the current version from posts read before their latest reader revision.

#### Scenario: Tribunal rewrite changes a post revision

- **GIVEN** a post has a current reader revision
- **AND** the user's read record has an older read revision
- **WHEN** the Reading Tracker renders that post
- **THEN** the post SHALL be shown as stale read rather than current read
- **AND** the row SHALL use the stale/greyed visual state
