# human-finishability-signals Specification

## Purpose

定義可查詢的人類閱讀與分享訊號，包括文章版本、active read time、scroll depth、finishability、transport 與 reader trust tier，讓產品洞察與 Tribunal automation 能區分可靠證據和僅供參考的行為。

## Requirements

### Requirement: Reading engagement events SHALL include article identity and version

Gu-log SHALL record human reading engagement as explicit events that include stable article identity and the version snapshot visible to the reader at event time.

Each engagement event SHALL include at least:

- `eventSchemaVersion`
- `eventId`
- `kind`
- `postId`
- `ticketId` when available
- `lang`
- `pathname`
- `postVersion` as an integer (UI MAY render it as `vN`)
- `occurredAt`
- `reader` when known

#### Scenario: Auto read finish records the visible version

- **WHEN** ShroomDog reaches the end of a gu-log article and the system emits `read_finish`
- **THEN** the event SHALL include the current article `postVersion`
- **AND** the event SHALL include the article `postId`, `lang`, and `pathname`
- **AND** the event SHALL distinguish this from a manual or imported read marker

#### Scenario: Manual mark-read does not masquerade as high-confidence finishability

- **WHEN** a reader manually marks an article as read
- **THEN** the event MAY update read-tracker state
- **BUT** the event SHALL use `method="manual_mark_read"`
- **AND** the event SHALL NOT be treated as the same confidence level as an active scroll/read completion

#### Scenario: Existing v1 read tracker data is migrated without loss

- **WHEN** existing localStorage or Gist data has shape `{ version: 1, slugs, lastUpdated }`
- **THEN** the system SHALL preserve those read slugs during migration
- **AND** migrated records SHALL be marked as imported or legacy confidence, not active read completions

---

### Requirement: Active read time SHALL be measured separately from dwell time

Gu-log SHALL distinguish active reading time from wall-clock time on page. Active time SHALL accumulate only while the page is visible and the reader has recent scroll, pointer, keyboard, or touch activity.

#### Scenario: Reader leaves tab open while idle

- **WHEN** the article tab remains open but the document is hidden or the reader is idle past the configured idle threshold
- **THEN** active read time SHALL pause
- **AND** wall-clock dwell time SHALL NOT be used alone to infer finishability

#### Scenario: Reader actively scrolls and reads

- **WHEN** the article page is visible and the reader continues interacting with the page
- **THEN** active read time SHALL accumulate
- **AND** the final event SHALL report accumulated active read time

---

### Requirement: Scroll depth SHALL store max observed article-relative depth

Gu-log SHALL store maximum observed scroll depth relative to article content, not only the current progress bar width or whole-page scroll position.

#### Scenario: Reader reaches 75% then leaves

- **WHEN** the reader reaches 75% of the article content and then scrolls back up or leaves
- **THEN** the recorded event SHALL preserve `maxScrollPercent >= 75`
- **AND** the system SHALL NOT lose that maximum because current scroll position changed

#### Scenario: Reader reaches article end

- **WHEN** the reader reaches the article end sentinel
- **THEN** the system SHALL be able to emit `read_finish`
- **AND** the event SHALL include max scroll depth and finish method

---

### Requirement: Finishability SHALL distinguish finished, abandoned, and unknown

Gu-log SHALL model human finishability as more than a boolean read/unread state. The system SHALL distinguish at least:

- `finished`
- `in_progress`
- `abandoned_suspected_boring`
- `abandoned_unknown`
- `manually_marked_read`

#### Scenario: Single quick bounce remains unknown

- **WHEN** a reader opens an article and leaves quickly with low active read time
- **THEN** the system SHALL classify the outcome as `abandoned_unknown` or equivalent low-confidence state
- **AND** SHALL NOT automatically mark the article as boring based on one quick bounce

#### Scenario: Meaningful partial read without finish is suspected boring

- **WHEN** ShroomDog spends meaningful active read time on an article
- **AND** reaches only a partial scroll depth
- **AND** does not later finish, share, or leave positive feedback
- **THEN** the system MAY classify the article as `abandoned_suspected_boring`
- **AND** the event SHALL include confidence and evidence fields

---

### Requirement: Share intent SHALL be treated as strong positive feedback

Gu-log SHALL record share intent as a positive human signal. Share events SHALL include article identity, version snapshot, share target, and result confidence.

#### Scenario: Native share attempted

- **WHEN** a reader uses the Web Share API from a gu-log article
- **THEN** the system SHALL record a `share_intent` event with `target="native"`
- **AND** the event SHALL include the article `postVersion`
- **AND** the event SHOULD record whether the native share promise completed or was cancelled when the platform exposes that distinction

#### Scenario: External share link clicked

- **WHEN** a reader clicks X, Facebook, LINE, or copy-link share UI
- **THEN** the system SHALL record a `share_intent` event with the selected target
- **AND** the event SHALL mark result confidence as attempted unless completion can be verified

---

### Requirement: Human signal transport SHALL be explicit and queryable

Gu-log SHALL define where human engagement events are stored and how Tribunal or operators can query them. The storage MAY be first-party API/DB, Gist, repo JSONL, GitHub Discussions derived index, or another explicit transport, but it SHALL NOT rely on unqueryable browser-only state for Tribunal decisions.

#### Scenario: Existing Vercel Analytics pageviews are telemetry, not Tribunal evidence

- **WHEN** gu-log only has the current `@vercel/analytics` injection from `BaseLayout.astro`
- **AND** no custom event payload with article identity/version is emitted
- **AND** no deterministic export/query path is available to Tribunal
- **THEN** Vercel Analytics pageviews SHALL NOT be treated as the configured human-signal transport
- **AND** they SHALL NOT drive requeue/block/preserve decisions by themselves

#### Scenario: Tribunal requests signals for a post

- **WHEN** Tribunal prepares to score or rewrite an article
- **THEN** it SHALL be able to query a deterministic packet of human signals for that article
- **AND** the packet SHALL include event kinds, versions, timestamps, and unresolved/resolved state

#### Scenario: Browser-only local state has not synced

- **WHEN** engagement state exists only in a browser localStorage and has not synced to the configured transport
- **THEN** Tribunal SHALL NOT assume that state exists
- **AND** the UI SHOULD expose sync status or otherwise avoid implying unsynced events are already part of automation

---

### Requirement: Reader identity and trust tier SHALL gate automation impact

Gu-log SHALL classify human engagement events by reader trust tier before those events can affect Tribunal or publisher decisions. GitHub OAuth identity MAY be used to classify a reader as ShroomDog / owner-trusted when the authenticated account email matches a configured trusted-owner allowlist. The actual trusted email values SHALL NOT be hardcoded in OpenSpec text.

Reader trust tiers SHALL include at least:

- `owner_trusted` — ShroomDog / gu-log owner identity verified through trusted GitHub OAuth email allowlist or equivalent owner-approved identity source
- `guest_reference` — random or unauthenticated guest signals useful for reference but not authorized to drive Tribunal
- `unknown` — identity unavailable or not yet classified

#### Scenario: Trusted OAuth email classifies ShroomDog signal

- **WHEN** a reader is authenticated through GitHub OAuth
- **AND** the account email matches the configured trusted-owner allowlist
- **THEN** the event MAY be classified as `readerTrustTier="owner_trusted"`
- **AND** the event MAY be eligible for Tribunal evidence, requeue, or publish-block policy according to the human-signal rules

#### Scenario: Random guest action remains reference-only

- **WHEN** an unauthenticated or non-owner reader finishes, abandons, comments, or shares an article
- **THEN** the event MAY be recorded as `readerTrustTier="guest_reference"`
- **AND** the event MAY appear in ShroomDog review dashboards or signal summaries
- **BUT** it SHALL NOT trigger Tribunal rewrite, requeue, publish block, or score override by itself

#### Scenario: ShroomDog approves a guest-derived signal

- **WHEN** guest reference signals reveal a useful pattern
- **AND** ShroomDog / owner explicitly approves the pattern or a specific signal as actionable
- **THEN** the approved signal MAY be promoted into owner-approved evidence
- **AND** the promoted record SHALL retain provenance showing it originated from guest data

#### Scenario: Guest signals are aggregated for reference

- **WHEN** multiple random guests show similar finishability or share patterns
- **THEN** the system MAY aggregate those signals for product insight
- **AND** the aggregate SHALL remain reference-only until ShroomDog / owner approval makes it actionable
