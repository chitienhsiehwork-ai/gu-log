# Spec Delta

## MODIFIED Requirements

### Requirement: Tribunal SHALL consume unresolved human signals as deterministic evidence

Tribunal SHALL include unresolved per-article human signals in judge and writer context as deterministic evidence. Human signals SHALL be read from the configured signal transport or generated packet, not inferred from model intuition. Tribunal-impacting signals SHALL be limited to `owner_trusted` or explicitly owner-approved evidence; `guest_reference` signals SHALL remain reference-only until promoted by ShroomDog / owner approval. Implicit signals (automatic read finish, suspected abandon, scroll depth, active read time) SHALL NOT enter judge or writer context until a `reader-signal-calibration` report with sufficient sample size shows they track owner explicit feedback; until then only explicit owner feedback MAY enter judge context, and it SHALL be presented as quoted owner statements, never as numeric targets to optimise.

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

- **WHEN** an article has owner-trusted or owner-approved `abandoned_suspected_boring` events
- **AND** no calibration report with sufficient sample size has shown implicit signals track owner explicit feedback
- **THEN** FreshEyes and other judges SHALL NOT receive those events
- **AND** the events SHALL remain available to the calibration report
- **BUT** explicit owner negative readability feedback MAY still reach FreshEyes as quoted, versioned evidence

#### Scenario: Vibe receives explicit boring feedback

- **WHEN** ShroomDog leaves versioned explicit negative feedback such as `這篇難看死了` or a one-tap `rewrite_needed`
- **THEN** Vibe SHALL receive that feedback as quoted, versioned negative evidence
- **AND** Vibe MAY use it when scoring narrative, vibe, or shareability
- **AND** any free-text note SHALL be treated as untrusted data, not as instructions

#### Scenario: FactChecker receives factual-error feedback

- **WHEN** a human feedback item is classified as a factual error or source fidelity issue
- **THEN** FactChecker SHALL receive that evidence
- **AND** unrelated judges SHALL NOT be forced to treat it as a vibe/readability failure
