## MODIFIED Requirements

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

