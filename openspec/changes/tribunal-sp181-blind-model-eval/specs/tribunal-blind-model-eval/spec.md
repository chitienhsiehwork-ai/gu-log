## ADDED Requirements

### Requirement: SP-181 blind model evaluation SHALL use neutral candidate labels

The experiment SHALL identify the three review candidates as Apple, Banana, and Camera in all reviewer-visible surfaces before model mapping is revealed.

#### Scenario: Branches use blind labels

- **WHEN** experiment branches are created
- **THEN** the branch names SHALL be `experiment/tribunal-apple-sp181`, `experiment/tribunal-banana-sp181`, and `experiment/tribunal-camera-sp181`
- **AND** the branch names SHALL NOT include model provider or model family names

#### Scenario: PRs use blind labels

- **WHEN** Draft PRs are opened for the experiment
- **THEN** each PR title SHALL include exactly one of `[Apple]`, `[Banana]`, or `[Camera]`
- **AND** PR title/body text SHALL NOT reveal which model suite produced the candidate

#### Scenario: Preview article titles are easy to reference

- **WHEN** a candidate branch renders SP-181 in Vercel Preview
- **THEN** the article title MAY be prefixed with the candidate label such as `[Apple]`
- **AND** the prefix SHALL be removed before any candidate is merged to `main`

---

### Requirement: The experiment SHALL compare exactly three Tribunal model suites

The experiment SHALL produce one candidate from each approved model suite: current Opus Tribunal, all Opus 4.7 Tribunal, and all GPT-5.5 Tribunal.

#### Scenario: Current Opus baseline candidate exists

- **WHEN** the experiment candidates are generated
- **THEN** one candidate SHALL use the current production Tribunal model configuration
- **AND** it SHALL start from the same base article commit as the other candidates

#### Scenario: All Opus 4.7 candidate exists

- **WHEN** the experiment candidates are generated
- **THEN** one candidate SHALL use Opus 4.7 for all judge and writer stages where an Opus 4.7 equivalent is available
- **AND** it SHALL start from the same base article commit as the other candidates

#### Scenario: All GPT-5.5 candidate exists

- **WHEN** the experiment candidates are generated
- **THEN** one candidate SHALL use GPT-5.5 for all judge and writer stages through the Codex/OpenAI runner path
- **AND** it SHALL start from the same base article commit as the other candidates

---

### Requirement: Model mapping SHALL remain hidden until after human ranking

The Apple/Banana/Camera to model-suite mapping SHALL remain private until Sprin finishes the blind review ranking.

#### Scenario: Preview URLs are sent without mapping

- **WHEN** Iris sends the Vercel Preview URLs to Sprin
- **THEN** Iris SHALL send only the Apple, Banana, and Camera URLs
- **AND** Iris SHALL NOT include model names, provider names, score model metadata, or hints about which candidate is baseline

#### Scenario: Mapping is revealed only after ranking

- **WHEN** Sprin provides first/second/third ranking or explicitly ends the blind review
- **THEN** Iris MAY reveal the Apple/Banana/Camera to model-suite mapping
- **AND** Iris SHALL include the mapping in the experiment report or follow-up summary

---

### Requirement: GPT-5.5/Codex setup SHALL pass smoke verification before full experiment generation

The all-GPT-5.5 candidate SHALL NOT be generated until the GPT-5.5/Codex runner path proves it can satisfy Tribunal artifact requirements.

#### Scenario: GPT-5.5 judge smoke succeeds

- **WHEN** GPT-5.5 judge smoke verification runs
- **THEN** the runner SHALL produce valid Tribunal JSON for the required judge schema
- **AND** validation SHALL not depend on trusting the model's self-reported model name

#### Scenario: GPT-5.5 writer smoke succeeds

- **WHEN** GPT-5.5 writer smoke verification runs
- **THEN** the runner SHALL produce an in-place edit or equivalent patch for a disposable zh-tw article copy
- **AND** it SHALL also handle an EN counterpart when present

#### Scenario: GPT-5.5 smoke artifact builds

- **WHEN** the GPT-5.5 smoke edit has been applied
- **THEN** post validation and `pnpm run build` SHALL pass before the full SP-181 candidate is generated

---

### Requirement: Candidate PR artifacts SHALL be merge-safe after cleanup

Each candidate SHALL be generated in a way that can be reviewed through Vercel Preview but cannot accidentally ship blind-test labels or losing versions to production.

#### Scenario: Candidate branches are isolated

- **WHEN** each candidate branch is created
- **THEN** it SHALL modify only the SP-181 zh-tw article, the SP-181 EN counterpart, and necessary Tribunal score/progress artifacts
- **AND** unrelated pipeline or content changes SHALL NOT be mixed into the candidate branch

#### Scenario: Winning candidate cleanup removes blind labels

- **WHEN** Sprin approves a winning candidate for merge
- **THEN** all `[Apple]`, `[Banana]`, or `[Camera]` title prefixes SHALL be removed before merge
- **AND** validation and build SHALL be re-run after cleanup

#### Scenario: Losing candidates do not ship

- **WHEN** Sprin chooses a winner or ends the experiment
- **THEN** losing candidate PRs SHALL remain unmerged
- **AND** they SHOULD be closed unless Sprin explicitly wants to keep them open for comparison
