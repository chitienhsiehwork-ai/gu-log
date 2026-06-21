## MODIFIED Requirements

### Requirement: Tribunal SHALL consume unresolved human signals as deterministic evidence

Tribunal SHALL include unresolved per-article human signals in judge and writer context as deterministic evidence. Human signals SHALL be read from the configured signal transport or generated packet, not inferred from model intuition. Tribunal-impacting signals SHALL be limited to `owner_trusted` or explicitly owner-approved evidence; `guest_reference` signals SHALL remain reference-only until promoted by ShroomDog / owner approval.

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

### Requirement: Human signal routing SHALL map feedback kinds to Tribunal dimensions

Gu-log SHALL define a routing policy from human signal kinds to Tribunal stages/dimensions so feedback affects the relevant judge instead of becoming generic prompt noise.

#### Scenario: Boring or bad-read feedback routes to FreshEyes and Vibe

- **WHEN** feedbackType is `boring_or_bad_read`
- **THEN** the signal SHALL route to FreshEyes and Vibe
- **AND** it SHOULD NOT route to FactChecker unless the comment also alleges factual errors

#### Scenario: Confusion feedback routes to readability and clarity

- **WHEN** feedbackType is `confusing` or `context_missing`
- **THEN** the signal SHALL route to FreshEyes readability and FreshEyes clarity
- **AND** MAY route to Librarian if glossary or cross-reference gaps are implicated

#### Scenario: Duplicate/seen-before feedback routes to Librarian or dedup capability

- **WHEN** feedbackType is `duplicate_attention` or equivalent
- **THEN** the signal SHALL route to Librarian / cross-reference / dedup review
- **AND** SHALL NOT be treated as a generic style complaint only

#### Scenario: Share signal routes as positive preserve evidence

- **WHEN** an article has a versioned `share_intent` signal
- **THEN** Tribunal SHALL treat it as positive evidence for the version that was shared
- **AND** writer SHOULD preserve the elements likely responsible unless other evidence shows they are harmful
