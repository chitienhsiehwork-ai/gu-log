## ADDED Requirements

### Requirement: OAuth login is sufficient for normal Reader Tracker sync

Reader Tracker SHALL allow a GitHub-authenticated gu-log user to sync reading records without manually pasting a GitHub private token.

#### Scenario: Signed-in user opens Reader Tracker

- **GIVEN** the user has completed gu-log GitHub OAuth login
- **WHEN** the user opens Reader Tracker
- **THEN** the primary sync path SHALL use the gu-log authenticated session
- **AND** the UI SHALL NOT ask the user to paste a GitHub private token as the normal path

### Requirement: Backend-mediated GitHub storage

Reader Tracker sync SHALL use gu-log backend mediation for GitHub-backed storage instead of requiring the browser to directly own a raw GitHub credential.

#### Scenario: Syncing reading records

- **GIVEN** the user is signed in to gu-log
- **WHEN** the tracker syncs local reading records with remote storage
- **THEN** the frontend SHALL call gu-log sync endpoints with the gu-log session
- **AND** the backend SHALL perform GitHub storage operations using the user's OAuth authorization

### Requirement: Missing permission is a reauthorization problem

The system SHALL treat missing GitHub storage permission as a reauthorization flow, not as a request for manual token paste.

#### Scenario: OAuth token lacks storage permission

- **GIVEN** the user is signed in
- **AND** their GitHub authorization lacks permission needed for reader sync
- **WHEN** the user attempts to sync
- **THEN** the UI SHALL offer a GitHub reauthorization action for reader sync
- **AND** the UI SHALL explain that sync permission is missing

### Requirement: Legacy token fallback is not the primary path

Manual GitHub token sync MAY remain as a temporary legacy or diagnostic fallback, but it SHALL NOT be presented as the default flow for signed-in users.

#### Scenario: Legacy token exists locally

- **GIVEN** a browser has an existing manually pasted GitHub token
- **WHEN** the user completes OAuth-based reader sync
- **THEN** the system SHALL provide a safe path to stop relying on the legacy token
- **AND** it SHALL NOT silently prefer the legacy token over the authenticated session
