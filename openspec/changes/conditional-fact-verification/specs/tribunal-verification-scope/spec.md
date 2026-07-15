## ADDED Requirements

### Requirement: The Fact Checker SHALL classify each post's claim scope from within its own run

The Fact Checker SHALL determine, by reading the full post, whether the post is **claim-bearing** (contains at least one decision-critical technical, numeric, or factual claim a reader could act on) or **claim-free** (pure opinion / reflection / motivation / mental-model prose with no such claim). This classification SHALL be produced inside the Fact Checker's own zero-context run and SHALL NOT be read from a frontmatter field, an orchestrator-supplied flag, or any signal an outer agent controls.

#### Scenario: Reflection post with no verifiable claims is classified claim-free

- **WHEN** the Fact Checker scores a translated reflection essay that makes no version, benchmark, architecture, quantity, or "X does Y" technical claim
- **THEN** it SHALL classify the post as claim-free
- **AND** it SHALL record that classification in its report

#### Scenario: A single embedded factual claim keeps the clause claim-bearing

- **WHEN** an otherwise reflective post contains one concrete factual claim (e.g. a named product capability, a real benchmark figure)
- **THEN** the Fact Checker SHALL treat that claim as claim-bearing and verify it
- **AND** SHALL NOT use the post's overall reflective tone to skip verifying the embedded claim

#### Scenario: Classification is not delegated to the orchestrator

- **WHEN** any runtime (CCC `Agent`, shell `tribunal.sh`, Codex on VM) invokes the Fact Checker
- **THEN** the claim-scope decision SHALL be made by the Fact Checker, not by the invoking orchestrator
- **AND** no `--skip-factcheck` flag or frontmatter skip field SHALL exist to bypass the stage

### Requirement: The Fact Checker's non-verification checks SHALL be unconditional

Regardless of claim-scope classification, the Fact Checker SHALL always score `fidelity`, `sourceBoundary`, and `commentarySeparation`. Claim-scope classification SHALL only affect how the `accuracy` dimension's *verification effort* is applied — never whether the Fact Checker stage runs and never whether the other dimensions are scored.

#### Scenario: Claim-free post still gets fidelity and commentary-separation scored

- **WHEN** the Fact Checker classifies a post as claim-free
- **THEN** it SHALL still score fidelity (hedge preservation, no added claims), sourceBoundary, and commentarySeparation
- **AND** the Fact Checker stage SHALL run to completion like any other post

#### Scenario: MoguNote POV bleed is caught on a claim-free post

- **WHEN** a claim-free reflection post has a MoguNote whose opinion leaks into the translated body without attribution
- **THEN** the Fact Checker SHALL flag it under commentarySeparation
- **AND** the claim-free classification SHALL NOT suppress that finding

### Requirement: The accuracy dimension SHALL use a documented claim-free fast-path

On a claim-free post, the Fact Checker SHALL score `accuracy` by a documented rule: accuracy reflects source-argument faithfulness only (misattributed quotes or a garbled source argument are still accuracy faults), and SHALL NOT be penalized for the absence of verifiable claims nor padded with N/A scaffolding. The judge's report SHALL state the claim-free basis in one line rather than improvising a deduction.

#### Scenario: Claim-free post with a faithful argument is not penalized for un-verifiability

- **WHEN** a claim-free post faithfully carries its source's argument and misattributes nothing
- **THEN** the Fact Checker SHALL NOT lower accuracy on the grounds that claims could not be verified
- **AND** the report SHALL note "no verifiable technical/numeric claims; accuracy reflects source-argument faithfulness only"

#### Scenario: Claim-free post that garbles the source argument still loses accuracy

- **WHEN** a claim-free post misattributes a quote or inverts the source's argument
- **THEN** the Fact Checker SHALL lower accuracy accordingly
- **AND** the claim-free classification SHALL NOT be used to award a default high accuracy
