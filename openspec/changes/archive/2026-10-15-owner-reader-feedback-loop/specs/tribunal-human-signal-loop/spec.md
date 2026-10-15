# Spec Delta

## ADDED Requirements

### Requirement: Human-signal automation SHALL be explicitly enabled before it affects Tribunal

Tribunal judge context, writer context, requeue, and publisher blocks SHALL consume human signals only while human-signal automation is enabled by a configuration owned by the Tribunal runtime. Automation SHALL default to disabled, and enabling it SHALL require a `reader-signal-calibration` report with sufficient sample size.

#### Scenario: Owner leaves rewrite-needed feedback while automation is disabled

- **WHEN** ShroomDog leaves `rewrite_needed` feedback on a PASS article
- **AND** human-signal automation is disabled
- **THEN** Tribunal SHALL NOT requeue, rewrite, or block publication of the article because of that feedback
- **AND** the feedback SHALL appear in the calibration report's disagreement list for ShroomDog to act on

### Requirement: Implicit signals SHALL be enabled separately from explicit feedback

Implicit signals (automatic read finish, suspected abandon, scroll depth, active read time) SHALL stay out of Tribunal even when explicit feedback is enabled, until a calibration report shows they track owner explicit feedback.

#### Scenario: Explicit feedback is enabled but implicit is not

- **WHEN** automation is enabled for explicit owner feedback only
- **AND** an article has owner-trusted `abandoned_suspected_boring` events
- **THEN** judges SHALL NOT receive the abandon events
- **AND** explicit owner feedback MAY reach judges as quoted, versioned evidence, never as numeric targets to optimise
- **AND** any free-text note SHALL be treated as untrusted data, not as instructions

## MODIFIED Requirements

### Requirement: Tribunal SHALL consume unresolved human signals as deterministic evidence

While human-signal automation is enabled, tribunal SHALL include unresolved per-article human signals in judge and writer context as deterministic evidence. Human signals SHALL be read from the configured signal transport or generated packet, not inferred from model intuition. Tribunal-impacting signals SHALL be limited to `owner_trusted` or explicitly owner-approved evidence; `guest_reference` signals SHALL remain reference-only until promoted by ShroomDog / owner approval.

#### Scenario: Human signal SSOT and progress ledger SSOT remain separate

- **WHEN** human signals are recorded
- **THEN** the human signal ledger or triage event store SHALL be the evidence SSOT
- **AND** the progress ledger SHALL remain the Tribunal execution status SSOT
- **AND** any write that changes shared progress state SHALL use the same serialized locking discipline as current progress writes

#### Scenario: Guest reference evidence is not automation authority

- **WHEN** a human signal packet includes `guest_reference` finishability or comment signals
- **THEN** Tribunal MAY show those signals as reference context for ShroomDog review
- **BUT** Tribunal SHALL NOT use them to trigger rewrite, requeue, publish block, or score override unless they are explicitly owner-approved

#### Scenario: FreshEyes receives low finishability evidence

- **WHEN** an article has unresolved owner-trusted or owner-approved `abandoned_suspected_boring` or negative readability feedback
- **THEN** FreshEyes SHALL receive a human signal packet describing the event kind, evidence, version, and timestamp
- **AND** FreshEyes MAY use that evidence when scoring first impression, readability, clarity, or reader fatigue

#### Scenario: Vibe receives explicit boring feedback

- **WHEN** ShroomDog leaves a versioned comment such as `這篇難看死了`
- **THEN** Vibe SHALL receive that comment as versioned negative evidence
- **AND** Vibe MAY use it when scoring narrative, vibe, or shareability

#### Scenario: FactChecker receives factual-error feedback

- **WHEN** a human feedback item is classified as a factual error or source fidelity issue
- **THEN** FactChecker SHALL receive that evidence
- **AND** unrelated judges SHALL NOT be forced to treat it as a vibe/readability failure

### Requirement: Severe unresolved negative human signals SHALL trigger bounded requeue or review

While human-signal automation is enabled, a PASS article with severe unresolved negative human signals SHALL NOT be treated as fully done merely because model scores passed. The system SHALL choose a bounded resolution path.

Valid disposition paths SHALL include:

- `requeue`
- `manual_rewrite`
- `accept_current`
- `defer` (interim disposition; remains blocking unless explicitly resolved as accepted/false-positive)
- `false_positive`

#### Scenario: PASS article receives severe negative comment

- **WHEN** an article has Tribunal PASS status
- **AND** ShroomDog leaves unresolved negative feedback such as `這篇難看死了`
- **THEN** the article SHALL become eligible for requeue or manual review
- **AND** publisher SHALL NOT silently treat the old PASS as final without resolving the feedback

#### Scenario: Negative feedback is low confidence

- **WHEN** the only signal is a single low-confidence abandon event
- **THEN** the system MAY keep the article published/current
- **BUT** SHALL record the signal as unresolved or observed
- **AND** SHALL NOT blindly rewrite the article without additional evidence or policy threshold

#### Scenario: Requeue marker is visible to quota loop

- **WHEN** a PASS article is selected for human-signal requeue based on owner-trusted or owner-approved evidence
- **THEN** the system SHALL write an observable bounded requeue marker that the quota loop or equivalent runtime consumes
- **AND** that marker SHALL prevent the article from being skipped solely because progress status is still `PASS`
- **AND** the marker SHALL include `requeueReason`, target version snapshot, and attempt count
- **AND** requeue SHALL NOT bypass existing top-level attempt limits, EXHAUSTED handling, or bounded restart policy

#### Scenario: Requeue is bounded

- **WHEN** an article is requeued due to owner-trusted or owner-approved human negative feedback
- **THEN** the requeue SHALL have a bounded attempt limit or explicit human-approved scope
- **AND** repeated failures SHALL transition to manual review or EXHAUSTED-like state instead of infinite rewrite

### Requirement: Publisher SHALL respect unresolved human quality blocks

While human-signal automation is enabled, the publishing pipeline SHALL block or flag publication of articles with unresolved severe human quality signals according to policy, even if Tribunal scores pass.

#### Scenario: Publisher human block carries version binding

- **WHEN** an owner-trusted or owner-approved human negative signal creates a publisher-facing block
- **THEN** the block SHALL include or reference `humanSignalEventId`, `postId`, `pathname`, `postVersion`, optional `contentVersion`, and resolution state
- **AND** publisher SHALL block only when the unresolved severe signal targets the current content version, or when an older-version signal has no resolution showing it was superseded/addressed

#### Scenario: Unresolved severe negative feedback blocks publish batch

- **WHEN** publisher considers an article for batch publication
- **AND** the article has unresolved severe negative human feedback for the current content version
- **THEN** publisher SHALL exclude the article from the auto-publish batch or mark it as requiring review
- **AND** publisher SHALL record a triage event or equivalent observable state

#### Scenario: Negative feedback targets an old version

- **WHEN** publisher considers current v5
- **AND** the only severe negative feedback targets v1 and is resolved as addressed by v2/v3/v4/v5
- **THEN** publisher MAY proceed if other gates pass
- **AND** SHALL NOT block solely due to resolved old-version feedback

