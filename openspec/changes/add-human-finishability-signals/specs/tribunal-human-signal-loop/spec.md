## ADDED Requirements

### Requirement: Tribunal SHALL consume unresolved human signals as deterministic evidence

Tribunal SHALL include unresolved per-article human signals in judge and writer context as deterministic evidence. Human signals SHALL be read from the configured signal transport or generated packet, not inferred from model intuition.

#### Scenario: FreshEyes receives low finishability evidence

- **WHEN** an article has unresolved `abandoned_suspected_boring` or negative readability feedback
- **THEN** FreshEyes SHALL receive a human signal packet describing the event kind, evidence, version, and timestamp
- **AND** FreshEyes MAY use that evidence when scoring first impression, readability, or reader fatigue

#### Scenario: Vibe receives explicit boring feedback

- **WHEN** ShroomDog leaves a versioned comment such as `這篇難看死了`
- **THEN** Vibe SHALL receive that comment as versioned negative evidence
- **AND** Vibe MAY use it when scoring narrative, clarity, vibe, or shareability

#### Scenario: FactChecker receives factual-error feedback

- **WHEN** a human feedback item is classified as a factual error or source fidelity issue
- **THEN** FactChecker SHALL receive that evidence
- **AND** unrelated judges SHALL NOT be forced to treat it as a vibe/readability failure

---

### Requirement: Human signal routing SHALL map feedback kinds to Tribunal dimensions

Gu-log SHALL define a routing policy from human signal kinds to Tribunal stages/dimensions so feedback affects the relevant judge instead of becoming generic prompt noise.

#### Scenario: Boring or bad-read feedback routes to FreshEyes and Vibe

- **WHEN** feedbackType is `boring_or_bad_read`
- **THEN** the signal SHALL route to FreshEyes and Vibe
- **AND** it SHOULD NOT route to FactChecker unless the comment also alleges factual errors

#### Scenario: Confusion feedback routes to readability and clarity

- **WHEN** feedbackType is `confusing` or `context_missing`
- **THEN** the signal SHALL route to FreshEyes readability and Vibe clarity
- **AND** MAY route to Librarian if glossary or cross-reference gaps are implicated

#### Scenario: Duplicate/seen-before feedback routes to Librarian or dedup capability

- **WHEN** feedbackType is `duplicate_attention` or equivalent
- **THEN** the signal SHALL route to Librarian / cross-reference / dedup review
- **AND** SHALL NOT be treated as a generic style complaint only

#### Scenario: Share signal routes as positive preserve evidence

- **WHEN** an article has a versioned `share_intent` signal
- **THEN** Tribunal SHALL treat it as positive evidence for the version that was shared
- **AND** writer SHOULD preserve the elements likely responsible unless other evidence shows they are harmful

---

### Requirement: Severe unresolved negative human signals SHALL trigger bounded requeue or review

A PASS article with severe unresolved negative human signals SHALL NOT be treated as fully done merely because model scores passed. The system SHALL choose a bounded resolution path.

Valid resolution paths SHALL include:

- `requeue`
- `manual_rewrite`
- `accept_current`
- `defer`
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

#### Scenario: Requeue is bounded

- **WHEN** an article is requeued due to human negative feedback
- **THEN** the requeue SHALL have a bounded attempt limit or explicit human-approved scope
- **AND** repeated failures SHALL transition to manual review or EXHAUSTED-like state instead of infinite rewrite

---

### Requirement: Tribunal writer SHALL know which version failed and which version it is producing

When human feedback triggers a rewrite, Tribunal writer SHALL receive the failed version context and SHALL produce a new version candidate rather than editing as if the feedback applies timelessly.

#### Scenario: Writer fixes v1 feedback into v2

- **WHEN** v1 has negative human feedback
- **AND** writer is asked to rewrite the article
- **THEN** writer SHALL receive the v1 feedback packet
- **AND** writer SHALL understand the goal is to produce a new candidate version addressing that feedback
- **AND** the feedback record SHALL be resolvable against the new version after rewrite

#### Scenario: Writer sees old negative feedback already addressed

- **WHEN** a negative feedback item is resolved as `addressed_by_rewrite`
- **THEN** writer SHALL NOT treat it as an open complaint against the current version
- **AND** MAY use it only as historical context if needed

---

### Requirement: Publisher SHALL respect unresolved human quality blocks

The publishing pipeline SHALL block or flag publication of articles with unresolved severe human quality signals according to policy, even if Tribunal scores pass.

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

---

### Requirement: Positive human signals SHALL be preserved and studied

Positive human signals such as finish, share, or positive comment SHALL be preserved as evidence of effective article patterns. Tribunal SHALL NOT automatically rewrite away positively signaled versions without noting the risk.

#### Scenario: Shared version is proposed for rewrite

- **WHEN** a versioned article has a share signal
- **AND** Tribunal proposes a rewrite for unrelated score reasons
- **THEN** the rewrite evidence packet SHALL include the share signal
- **AND** writer SHOULD preserve the hook, framing, or passage likely responsible for shareability unless there is a stronger reason to change it

#### Scenario: Rewrite degrades human-positive version

- **WHEN** a rewritten version scores higher by AI judges
- **BUT** it loses human finish/share/comment-positive signals compared with the previous version
- **THEN** the system SHALL surface this as quality regression risk
- **AND** human review MAY overrule score-based automation
