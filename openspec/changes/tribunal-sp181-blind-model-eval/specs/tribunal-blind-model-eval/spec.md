## ADDED Requirements

### Requirement: The urgent burn experiment SHALL compare exactly three Claude Opus models

The experiment SHALL compare Opus 4.7, Opus 4.6, and Opus 4.5 during the April 30 quota-burn window.

#### Scenario: Three Opus candidates run for the same URL

- **WHEN** a URL trial starts
- **THEN** the runner SHALL invoke `claude-opus-4-7`, `claude-opus-4-6`, and `claude-opus-4-5`
- **AND** each invocation SHALL receive the same URL seed and task prompt
- **AND** GPT-5.5/Codex SHALL NOT be required for this run

#### Scenario: Normal reserve floor is disabled for this explicit burn run

- **WHEN** the burn runner decides whether to continue before midnight Asia/Taipei
- **THEN** it SHALL treat Sprin's instruction as authorization to spend the remaining Claude weekly quota
- **AND** it SHALL stop only at the deadline, quota exhaustion, repeated Claude quota errors, or manual operator stop

---

### Requirement: URL-only trials SHALL use gu-log post source URLs

Each model trial SHALL start from a single URL selected from existing gu-log post metadata.

#### Scenario: Candidate URLs are extracted from posts

- **WHEN** the runner builds its candidate pool
- **THEN** it SHALL scan `src/content/posts/*.mdx` for `sourceUrl` frontmatter
- **AND** it SHOULD prefer recent SP/CP posts related to AI agents, Claude Code, Codex, model behavior, evaluation, infrastructure, or product strategy

#### Scenario: Existing article body is not used as model source context

- **WHEN** the runner prompts a model for a URL trial
- **THEN** the prompt SHALL include the selected URL and task instructions
- **AND** it SHALL NOT paste the existing gu-log article body as source material

---

### Requirement: Blind labels SHALL hide model names in reviewer-facing artifacts

The experiment SHALL use Apple, Banana, and Camera labels for each trial before model mapping is revealed.

#### Scenario: Per-trial mapping is randomized and saved locally

- **WHEN** a trial starts
- **THEN** the runner SHALL assign Apple, Banana, and Camera to the three Opus models in randomized order
- **AND** it SHALL save the mapping to a local artifact file under `.score-loop/opus-url-burn/`

#### Scenario: Reviewer-facing summaries omit model names by default

- **WHEN** Iris summarizes blind candidates before reveal
- **THEN** the summary SHALL identify outputs by Apple, Banana, and Camera only
- **AND** it SHALL NOT reveal the model mapping until Sprin asks for reveal or ends the blind review

---

### Requirement: Burn artifacts SHALL be local and production-safe

The burn runner SHALL save useful outputs without modifying published posts or production branches.

#### Scenario: Raw and extracted outputs are persisted

- **WHEN** a model invocation finishes or fails
- **THEN** the runner SHALL save raw Claude JSON or error text
- **AND** it SHALL save extracted markdown when available
- **AND** it SHALL append a manifest entry with model, label, URL, task, timing, exit status, and cost when available

#### Scenario: Production content is not patched by default

- **WHEN** burn outputs are generated
- **THEN** the runner SHALL write them under `.score-loop/opus-url-burn/`
- **AND** it SHALL NOT modify `src/content/posts/` unless Sprin later explicitly asks to promote a candidate

---

### Requirement: The burn runner SHALL stop safely

The runner SHALL avoid becoming an uncontrolled infinite job after the quota-burn window.

#### Scenario: Midnight deadline stops dispatch

- **WHEN** the Asia/Taipei midnight deadline has passed
- **THEN** the runner SHALL stop launching new trials
- **AND** it SHALL let already-started Claude calls finish or time out

#### Scenario: Quota errors stop dispatch

- **WHEN** repeated Claude CLI results indicate quota exhaustion or subscription access failure
- **THEN** the runner SHALL stop launching new trials
- **AND** it SHALL record the stop reason in the run summary
