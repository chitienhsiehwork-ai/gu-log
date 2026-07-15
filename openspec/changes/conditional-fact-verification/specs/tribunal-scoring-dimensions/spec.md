## MODIFIED Requirements

### Requirement: Per-judge composite SHALL be the floored mean of that judge's owned dimensions, version-aware

Each judge's composite SHALL be computed as `floor(sum(owned dimensions) / count(owned dimensions))`, where the owned dimension set is resolved by `tribunalVersion`. A dimension that a claim-scope classification renders inapplicable (e.g. `accuracy` on a claim-free post per `tribunal-verification-scope`) SHALL still contribute a real numeric score to its judge's composite — it SHALL NOT be dropped from the mean or treated as absent. This keeps every judge's composite computed over the same dimension count for both claim-bearing and claim-free posts, so the pass bar means the same thing for both.

Note: the Fact Checker's **pass gate** is the 3-dimension fact-core `floor(avg(accuracy, fidelity, consistency))` (plus the `sourceBoundary ≥ 8` and `commentarySeparation ≥ 8` side gates), not a 5-dimension owned composite. The claim-free accuracy value feeds that 3-dimension fact-core; the two side-gate dimensions are evaluated independently and are unaffected by claim scope.

#### Scenario: Vibe composite over four dimensions at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Vibe dims persona/clawdNote/vibe/narrative
- **THEN** the Vibe composite SHALL equal `floor((persona + clawdNote + vibe + narrative) / 4)`

#### Scenario: Fresh Eyes composite over five dimensions at version 9+

- **WHEN** a `tribunalVersion >= 9` post has Fresh Eyes dims readability/firstImpression/payoffDensity/lengthFit/clarity
- **THEN** the Fresh Eyes composite SHALL equal `floor((readability + firstImpression + payoffDensity + lengthFit + clarity) / 5)`

#### Scenario: Legacy composites unchanged at version 8 and below

- **WHEN** a `tribunalVersion <= 8` post is read
- **THEN** the Vibe composite SHALL equal `floor(sum(5 vibe dims) / 5)`
- **AND** the Fresh Eyes composite SHALL equal `floor(sum(4 fresh eyes dims) / 4)`

#### Scenario: Claim-free accuracy feeds the Fact-core composite as a normal score

- **WHEN** a claim-free post is scored and its `accuracy` is set via the claim-free fast-path
- **THEN** the Fact-core composite SHALL equal `floor((accuracy + fidelity + consistency) / 3)` using that accuracy value
- **AND** the accuracy value SHALL NOT be dropped from the average or replaced with N/A
