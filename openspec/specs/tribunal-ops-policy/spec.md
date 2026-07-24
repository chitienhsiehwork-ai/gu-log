# tribunal-ops-policy Specification

## Purpose

定義 Tribunal 的 pause、rollback review 與 bounded restart 操作政策，讓結構性失敗進入人工複核，並把文章品質置於表面分數合規之前。

## Requirements

### Requirement: Tribunal MUST have a human-invokable pause policy

Gu-log tribunal automation SHALL be governed by an operational policy that allows a human operator to pause the running tribunal process whenever the operator judges that rewrite behavior is drifting away from article-quality goals.

Valid pause triggers SHALL include both objective and subjective conditions.

Objective examples include:

- repeated rewrite loops across multiple posts
- broad unreviewed body rewrites rather than targeted fixes
- score improvement without corresponding reading-quality improvement
- repeated attempts against structurally weak drafts without a change in rewrite mode

Subjective examples include:

- the operator concludes the loop is "drifting"
- the operator no longer trusts the direction of the rewrites
- the operator believes the system is optimizing for pass-bar compliance over article quality

#### Scenario: operator trust loss is sufficient to pause

- **WHEN** a human operator observes tribunal output and concludes that the rewrite direction is drifting
- **THEN** the operator SHALL be permitted to stop the tribunal loop immediately
- **AND** the policy SHALL treat that stop as valid even if no code error or hard failure is present

#### Scenario: repeated broad rewrites trigger pause eligibility

- **WHEN** tribunal is rewriting multiple posts with broad body changes rather than local fixes
- **AND** the rewrite pattern is no longer clearly bounded
- **THEN** the system SHALL be considered pause-eligible
- **AND** a human operator MAY stop it without waiting for the current batch to finish

---

### Requirement: Pause MUST move tribunal into review-required state

Once tribunal is paused due to drift concerns, all in-flight or recently produced tribunal rewrites SHALL be treated as review-required artifacts rather than implicitly trusted outputs.

This review-required state SHALL apply until a human explicitly decides which changes are acceptable, which changes should be discarded, and whether automation may resume.

#### Scenario: paused rewrites are not implicitly accepted

- **WHEN** tribunal is stopped because of drift concerns
- **THEN** changed post files produced by the active tribunal run SHALL be treated as suspect until reviewed
- **AND** the existence of passing or improved tribunal scores SHALL NOT be sufficient to auto-accept those rewrites

#### Scenario: progress metadata is also review-scoped

- **WHEN** tribunal is paused mid-run
- **THEN** operational metadata such as tribunal progress files SHALL be treated as part of the review context
- **AND** humans reviewing the pause SHALL be able to inspect both article changes and tribunal state together

---

### Requirement: Restart MUST require explicit boundedness

Tribunal SHALL NOT be restarted after a drift-driven pause unless the human operator can state a bounded restart scope.

A bounded restart scope SHALL include all of the following:

- what subset of posts may be touched
- what rewrite mode is allowed
- what kinds of changes are allowed
- how the loop can be stopped again quickly if drift recurs

#### Scenario: unbounded restart is rejected

- **WHEN** a restart proposal would resume the same broad autonomous loop without narrowing scope
- **THEN** the restart SHALL be considered invalid under policy
- **AND** tribunal SHALL remain paused

#### Scenario: bounded restart is policy-compliant

- **WHEN** a restart proposal limits tribunal to a small post set, a narrower rewrite mode, and a visible pause path
- **THEN** the restart MAY proceed
- **AND** the bounded scope SHALL be recorded in the restart decision or accompanying change artifact

---

### Requirement: Structural-fail drafts MUST NOT be retried with surface-only rewrite strategy

If the cause of tribunal drift is repeated attempts to fix structurally weak drafts using the same surface-oriented rewrite strategy, the operational policy SHALL forbid restarting tribunal in that same mode.

Instead, restart SHALL require either:

- a narrower `polish`-only scope on drafts already judged structurally sound, or
- a revised editorial pipeline capable of `restructure` / `rebuild` behavior

#### Scenario: same failing strategy cannot be resumed unchanged

- **WHEN** tribunal repeatedly rewrites a draft whose underlying skeleton remains weak
- **AND** the rewrite strategy has not changed
- **THEN** policy SHALL forbid a simple restart of the same loop
- **AND** the operator SHALL first narrow the scope or change the editorial strategy

#### Scenario: restart after editorial guardrail is allowed

- **WHEN** a drift pause is followed by a new editorial guardrail such as structural-fail triage or explicit rebuild mode
- **AND** restart scope is bounded
- **THEN** tribunal MAY be restarted under the new operating conditions

---

### Requirement: Rollback-review phase MUST exist between pause and restart

Between a drift-driven pause and any future restart, tribunal operations SHALL enter a rollback-review phase.

In this phase, a human operator SHALL determine:

- which changed posts remain acceptable
- which changed posts should be reverted or discarded
- whether tribunal progress metadata should be retained, edited, or reset
- whether the root cause of drift has been understood well enough to justify restart

#### Scenario: rollback-review can keep some changes and reject others

- **WHEN** tribunal has touched multiple posts before pause
- **THEN** the rollback-review phase SHALL allow humans to keep acceptable rewrites on some posts
- **AND** discard or revert unacceptable rewrites on others
- **AND** SHALL NOT require all-or-nothing acceptance

#### Scenario: restart blocked until rollback-review finishes

- **WHEN** rollback-review has not yet determined the disposition of affected posts
- **THEN** tribunal SHALL NOT be restarted
- **AND** the operational state SHALL remain paused

---

### Requirement: Operational policy MUST prefer article quality over score compliance

The tribunal operating policy SHALL define article quality as the higher-order goal and score compliance as a proxy, not the final authority.

If observed behavior suggests that the loop is improving scores while degrading reading quality, voice, trustworthiness, or human finishability, the policy SHALL prefer stopping, requeueing, or reviewing the loop over continuing score optimization.

Human quality signals SHALL be valid operational evidence, including:

- ShroomDog cannot finish the article after meaningful active reading
- ShroomDog leaves versioned negative gu-log feedback such as `這篇難看死了`
- a rewritten version loses positive human signals that an earlier version had
- shareability or reader pull degrades despite improved AI judge scores

#### Scenario: score gain with quality loss justifies stop

- **WHEN** tribunal output improves pass-bar alignment
- **BUT** human review or versioned human signals show the rewritten article is less readable, less alive, less finishable, or more overworked
- **THEN** the policy SHALL treat this as a valid reason to stop or requeue tribunal
- **AND** SHALL NOT require the operator to wait for a hard failure condition

#### Scenario: quality remains the final arbiter

- **WHEN** tribunal scores and human judgment disagree
- **THEN** the operational policy SHALL allow the human operator or versioned human feedback policy to overrule continued automation
- **AND** that overrule SHALL be considered policy-compliant

#### Scenario: negative gu-log comment is valid quality evidence

- **WHEN** ShroomDog leaves a versioned gu-log comment saying `這篇難看死了`
- **THEN** the policy SHALL treat that comment as valid negative quality evidence for the version it targets
- **AND** the system MAY block publish, requeue, or require manual review according to the human-signal policy

#### Scenario: old-version feedback does not permanently poison later versions

- **WHEN** negative human feedback targets an older article version
- **AND** a later version has resolved or superseded that feedback
- **THEN** the operational policy SHALL NOT treat the old feedback as an unresolved complaint against the current version
- **AND** resolution state SHALL be visible in the review context

#### Scenario: human-signal requeue does not bypass pause policy

- **WHEN** human negative signals indicate systemic score-over-quality drift across multiple posts
- **THEN** the policy SHALL prefer pause/review over blind autonomous requeue
- **AND** any requeue SHALL be bounded
- **AND** human-signal requeue SHALL NOT bypass drift pause, rollback-review, or bounded restart requirements
