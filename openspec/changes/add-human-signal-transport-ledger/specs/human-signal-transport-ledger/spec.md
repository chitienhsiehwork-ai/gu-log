## ADDED Requirements

### Requirement: Agent-observable human signal ledger

The system SHALL provide a durable remote ledger for synced human signal events.

#### Scenario: Browser syncs a pending event

- **GIVEN** a browser has a `local_only` human signal event
- **WHEN** the event is successfully synced
- **THEN** the event SHALL be durably queryable without that browser or Mac remaining open
- **AND** the local event SHALL be marked `synced` only after durable acknowledgement

### Requirement: First-party sync API contract

Normal human-signal sync SHALL use a first-party authenticated sync contract rather than exposing storage implementation details to the browser.

#### Scenario: Client uploads pending events

- **GIVEN** a logged-in browser has pending human signal events
- **WHEN** the frontend uploads those events
- **THEN** it SHALL call a first-party gu-log sync endpoint authenticated by gu-log session or backend-approved credential flow
- **AND** the request SHALL include a client batch id, client store version, and event array
- **AND** the response SHALL identify accepted event ids, rejected events with machine-readable error codes, server-assigned trust by event id, and a durable watermark or storage revision
- **AND** the client SHALL mark an event `synced` only when its `eventId` appears in the accepted event ids

### Requirement: Human-signal sync SHALL NOT reuse browser-owned Reader Tracker GitHub credentials

Human-signal sync SHALL be independent of the legacy browser-side Reader Tracker Gist implementation.

#### Scenario: Existing browser has a Reader Tracker PAT or cached Gist id

- **GIVEN** a browser has `gu-log-github-pat`, `gu-log-gist-id`, or a JWT payload containing GitHub token-like fields
- **WHEN** human-signal sync runs
- **THEN** the human-signal sync path SHALL NOT call GitHub APIs directly from the browser
- **AND** it SHALL NOT write human signals into `gu-log-reading-tracker.json`
- **AND** it SHALL use the first-party backend-mediated sync contract

### Requirement: Idempotent append-only merge

The transport SHALL preserve existing remote events and dedupe retries.

#### Scenario: The same event is uploaded twice

- **GIVEN** two upload attempts contain the same `eventId`
- **WHEN** the remote ledger merges them
- **THEN** the ledger SHALL keep one logical event for that `eventId`
- **AND** it SHALL NOT drop unrelated existing remote events

### Requirement: Deterministic agent query packet

The transport SHALL expose storage-backend-independent per-post human signal packets for agent and Tribunal review.

#### Scenario: Iris queries a post version

- **GIVEN** synced events exist for multiple posts, pathnames, file-touch versions, and content versions
- **WHEN** an agent queries by `postId`, canonical `pathname`, `postVersion`, and optional `contentVersion`
- **THEN** the system SHALL return only events matching the requested identity fields
- **AND** when `contentVersion` is supplied, the system SHALL filter by that content version rather than treating all matching `postVersion` events as content-equivalent
- **AND** the response SHALL include `postVersion` semantics, such as `postVersionKind="file_touch"`
- **AND** the response SHALL include `contentVersion`, `contentHash`, or explicit `contentVersionUnavailable=true` when content binding is unavailable
- **AND** the response SHALL sort events deterministically, for example by `occurredAt` then `eventId`
- **AND** the response SHALL include server-assigned trust and automation authority fields

### Requirement: Server-side trust assignment

Automation-authoritative trust SHALL be assigned by the backend or ledger processor, not by browser-provided fields.

#### Scenario: Client uploads a claimed owner-trusted event

- **GIVEN** an uploaded event contains `readerTrustTier="owner_trusted"` or equivalent client-side trust fields
- **WHEN** the backend persists the event
- **THEN** the backend SHALL treat client-provided trust as advisory input only
- **AND** it SHALL compute and store `serverTrustTier`
- **AND** it SHALL compute `automationAuthoritative` from `serverTrustTier` and explicit owner approval only
- **AND** the stored event SHALL preserve enough provenance to audit the assignment without exposing secret allowlist values

#### Scenario: A client uploads an unknown or guest signal

- **WHEN** the transport stores the event
- **THEN** the server or ledger process SHALL preserve it as reference evidence
- **AND** it SHALL NOT mark it automation-authoritative unless verified owner identity or explicit owner approval exists

### Requirement: Sync failure visibility

The system SHALL make unsynced and failed signals visible.

#### Scenario: Remote upload fails

- **WHEN** a pending event cannot be persisted remotely
- **THEN** the local store SHALL retain the event
- **AND** it SHALL mark or expose `sync_failed` so the viewer and agents can distinguish missing remote evidence from no evidence

### Requirement: Privacy boundary for comments and feedback

The transport SHALL preserve visibility/provenance boundaries for public and private feedback.

#### Scenario: A feedback comment includes text

- **WHEN** the event is synced remotely
- **THEN** the ledger SHALL record whether it came from public Giscus, first-party feedback, or private editorial input
- **AND** raw private comment text SHALL be redacted by default and included only with explicit owner/operator opt-in for that query or storage policy

#### Scenario: Agent queries private or editorial feedback

- **GIVEN** a synced event contains private first-party or editorial feedback text
- **WHEN** an agent queries the human-signal packet without explicit owner/operator permission to include private bodies
- **THEN** the response SHALL include provenance, visibility, sentiment/classification, and redaction status
- **AND** it SHALL NOT include raw private comment text
- **AND** it SHALL include a field such as `bodyRedaction="private_default"` or `bodyIncluded=false`
