## ADDED Requirements

### Requirement: Session-gated human signal viewer

The system SHALL provide a session-gated viewer for locally captured human signals.

For the existing static `/reading-tracker` route, session-gated means the UI SHALL require the same local `gu-log-jwt` gate as the reader dashboard before revealing signal contents. This requirement does not claim server-side confidentiality for a static route. If a dedicated backend route is added later, it MAY enforce stronger server-side authentication.

#### Scenario: User opens the viewer after reading articles

- **GIVEN** the browser has a `gu-log-human-signals` store
- **WHEN** the user opens the session-gated reader dashboard or signal viewer
- **THEN** the system SHALL show total signal count and counts by signal kind
- **AND** it SHALL show pending, synced, and sync-failed counts
- **AND** it SHALL not require DevTools to inspect the signal store

#### Scenario: Local signal store is empty or corrupted

- **GIVEN** the browser has no `gu-log-human-signals` store or the stored JSON cannot be parsed
- **WHEN** the user opens the signal viewer
- **THEN** the viewer SHALL render a safe empty/error state instead of crashing
- **AND** it SHALL NOT delete or overwrite the corrupted store merely by rendering
- **AND** any reset/import action SHALL require an explicit user action

### Requirement: Event identity and version visibility

The viewer SHALL expose article and version identity for each visible event.

#### Scenario: Recent events are shown

- **GIVEN** a human signal event has `postId`, `pathname`, `postVersion`, and `occurredAt`
- **WHEN** the event appears in the viewer
- **THEN** the viewer SHALL display a human-readable article row
- **AND** the raw `postId`, `pathname`, `postVersion`, and `occurredAt` values SHALL be visible directly or through an expandable/details affordance
- **AND** `lang`, `ticketId`, and `contentVersion` SHALL be visible or included in event details when available

### Requirement: Signal semantics are not overstated

The viewer SHALL distinguish raw events from editorial conclusions.

#### Scenario: Share and abandon signals are displayed

- **GIVEN** a `share_intent` event has `reactionStrength: strong` and `polarity: unknown`
- **WHEN** the viewer displays it
- **THEN** it SHALL not label the share as positive unless polarity was explicitly classified
- **AND** a `read_abandon_candidate` SHALL be labeled as low-confidence suspected evidence, not a final boring verdict

### Requirement: Read-only by default

The viewer SHALL not mutate event semantics during inspection.

#### Scenario: User views local signals

- **WHEN** the viewer renders existing events
- **THEN** it SHALL NOT change event kind, article identity, metrics, confidence, polarity, or trust tier
- **AND** any sync-status mutation SHALL require an explicit sync/export/import action

### Requirement: Exportable pending packet

The viewer SHALL support copying or exporting locally stored signals for debugging and handoff.

#### Scenario: User wants to send pending evidence to an agent

- **GIVEN** local events have `syncStatus` of `local_only` or `sync_failed`
- **WHEN** the user chooses export or copy pending packet
- **THEN** the system SHALL produce valid JSON containing those events
- **AND** the exported packet SHALL preserve `eventSchemaVersion`, `eventId`, `kind`, article/version identity, `occurredAt`, `readerTrustTier`, `transport`, and `syncStatus`
- **AND** it SHALL preserve kind-specific semantic fields such as `method`, `confidence`, `finishability`, `reactionStrength`, `polarity`, `source`, and `commentId` when present
- **AND** copying/exporting SHALL NOT mark events as `synced`

#### Scenario: Pending event includes comment text

- **GIVEN** a pending `feedback_comment` event includes `commentText`
- **WHEN** the viewer displays or exports the event
- **THEN** the UI SHALL clearly distinguish public/source-managed comment text from private/operator-only text when that provenance is known
- **AND** raw private comment text SHALL be hidden or redacted by default unless the user explicitly chooses to reveal/copy raw details
- **AND** if provenance is unknown, the viewer SHALL avoid implying the text is safe for public or automation use

### Requirement: Reader dashboard mark-read behavior is explicit

The viewer/instrumentation change SHALL make reader-dashboard manual read actions unambiguous with respect to human signal generation.

#### Scenario: User manually marks one article read from the reader dashboard

- **WHEN** the user marks an article read from `/reading-tracker`
- **THEN** the implementation SHALL either create a `read_finish` human signal with `method="manual_mark_read"` and complete article/version identity
- **OR** it SHALL treat the action as tracker-only and clearly label it as not creating human-signal evidence
- **AND** it SHALL NOT create a human signal from only a slug/current reader revision without `postId`, `lang`, `pathname`, and `postVersion`

#### Scenario: User bulk marks a group read

- **WHEN** the user uses a bulk mark-read control
- **THEN** the implementation SHALL default to tracker-only behavior unless each generated signal can preserve complete article/version identity
- **AND** any generated signals SHALL use `method="manual_mark_read"` and `confidence="legacy_or_manual"`
- **AND** bulk-generated signals SHALL NOT be displayed or exported as high-confidence active finishes
