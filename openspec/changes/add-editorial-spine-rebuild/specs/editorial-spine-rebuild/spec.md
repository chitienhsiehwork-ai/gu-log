## ADDED Requirements

### Requirement: Editorial triage MUST distinguish surface fail from structural fail

Any editorial judge used in gu-log's tribunal or post-tribunal rewrite loop SHALL classify a failing draft into one of two primary failure families before recommending a rewrite strategy:

- `surface-fail`
- `structural-fail`

A `surface-fail` draft is one whose core thesis and article shape remain usable, but which fails on local execution issues such as clarity, glossary / identity linking, source-fidelity drift, or phrase-level AI wording.

A `structural-fail` draft is one whose underlying article shape remains weak even if local sentences are cleaned up. This includes drafts whose stripped skeleton is still a listicle, reference doc, linear report, or other low-tension form that does not sustain reader momentum.

#### Scenario: pronoun and linking issues are triaged as surface fail

- **WHEN** a draft has a strong opening, a coherent middle, and a usable conclusion
- **AND** the main issues are pronoun clarity violations, missing glossary links, or identity-link omissions
- **THEN** the editorial judge SHALL classify it as `surface-fail`
- **AND** SHALL NOT escalate it to `structural-fail` solely because of those local issues

#### Scenario: listicle skeleton is triaged as structural fail

- **WHEN** a draft has a hook and callback
- **AND** removing analogies, ClawdNotes, and stylistic garnish reveals a sequential “tips / features / sections” report skeleton
- **THEN** the editorial judge SHALL classify it as `structural-fail`
- **AND** SHALL explain that the weakness is in article shape rather than sentence polish

---

### Requirement: Rewrite strategy MUST expose three modes

The editorial rewrite system SHALL expose exactly three rewrite modes:

- `polish`
- `restructure`
- `rebuild`

These modes SHALL mean:

- `polish`: keep the existing article skeleton; fix local execution issues only
- `restructure`: preserve the thesis and most evidence, but allow section reordering, consolidation, and deletion of non-essential sections
- `rebuild`: preserve only source truth, thesis, and necessary evidence; allow the article to be rebuilt around a new skeleton

#### Scenario: surface fail routes to polish

- **WHEN** a draft is classified as `surface-fail`
- **THEN** the recommended rewrite mode SHALL default to `polish`
- **AND** the system SHALL keep the original section order unless a specific local change requires otherwise

#### Scenario: structural fail routes to restructure or rebuild

- **WHEN** a draft is classified as `structural-fail`
- **THEN** the editorial judge SHALL recommend either `restructure` or `rebuild`
- **AND** SHALL NOT recommend `polish` as the primary fix
- **AND** SHALL state whether the original skeleton is still salvageable

#### Scenario: rebuild permits large-scale surgery

- **WHEN** the recommended mode is `rebuild`
- **THEN** the writer MAY reorder sections, merge sections, rename sections, remove 30–50% of the original body, and rewrite transitions
- **AND** the writer SHALL preserve factual correctness, frontmatter truth, and source-thesis fidelity

---

### Requirement: Editorial judge MUST emit core spark and spine candidate

For any draft classified as `structural-fail`, the editorial judge SHALL emit the following fields in its guidance output:

- `coreSpark`
- `spineCandidate`
- `recommendedForm`
- `cutMercilessly`

These fields SHALL mean:

- `coreSpark`: the most amplifiable idea, conflict, observation, or punchline in the draft
- `spineCandidate`: the image, metaphor, character relationship, or structural turn most suitable to organize the article
- `recommendedForm`: the article form that best fits this draft, such as `argument`, `explainer-with-arc`, `translation-with-thesis`, `journey`, or `case-study`
- `cutMercilessly`: the sections or section-types that should be removed because they dilute the main line

#### Scenario: structural fail output includes spine candidate

- **WHEN** a draft is classified as `structural-fail`
- **THEN** the editorial judge output SHALL include non-empty values for `coreSpark`, `spineCandidate`, and `recommendedForm`
- **AND** SHALL identify at least one section or section pattern under `cutMercilessly`

#### Scenario: surface fail output may omit spine fields

- **WHEN** a draft is classified as `surface-fail`
- **THEN** the editorial judge MAY omit `spineCandidate` and `cutMercilessly`
- **AND** MAY focus on local rewrite instructions instead

---

### Requirement: Metaphor-as-spine MUST be distinguished from decorative metaphor

A metaphor or image SHALL be treated as a valid article spine only if it satisfies all of the following:

- it can anchor the opening hook
- it can organize multiple middle sections without requiring a new dominant metaphor every section
- it can support the ending callback at the worldview / thesis level
- removing it would materially weaken the article's main line rather than only removing a colorful sentence

A metaphor that is merely funny, vivid, or quotable but does not organize the article SHALL be treated as decorative, not structural.

#### Scenario: decorative metaphor is not accepted as spine

- **WHEN** a draft contains a strong one-line analogy inside one section
- **AND** the rest of the article does not depend on that analogy for sequencing, escalation, or conclusion
- **THEN** the editorial judge SHALL classify that analogy as decorative
- **AND** SHALL NOT promote it to `spineCandidate`

#### Scenario: recurring image is accepted as spine candidate

- **WHEN** a draft uses an image such as “消防車澆多肉” to frame the opening, explain multiple examples of scale mismatch in the middle, and land a worldview callback in the ending
- **THEN** the editorial judge SHALL accept that image as a valid `spineCandidate`
- **AND** MAY recommend rebuilding the article around it

---

### Requirement: Structural-fail diagnosis MUST use strip test reasoning

For article-shape evaluation, the editorial judge SHALL apply strip-test reasoning:

- temporarily ignore ClawdNotes, kaomoji, analogies, and decorative stylistic language
- inspect the remaining section sequence and claim flow
- decide whether the remaining skeleton still has tension, escalation, and article-level movement

If the stripped skeleton still reads like a reference guide, sequential summary, or linear report, the draft SHALL be treated as structurally weak even if the prose is lively on the surface.

#### Scenario: lively prose cannot override dead skeleton

- **WHEN** a draft has strong analogies and energetic phrasing
- **AND** the stripped skeleton remains “feature 1 → feature 2 → feature 3 → recap”
- **THEN** the editorial judge SHALL diagnose structural weakness
- **AND** SHALL explain that decorative persona cannot fully compensate for a dead skeleton

#### Scenario: strong skeleton survives strip test

- **WHEN** a draft loses some charm after removing stylistic garnish
- **BUT** the remaining structure still shows escalation, surprise, or a coherent argument arc
- **THEN** the editorial judge SHALL NOT diagnose structural failure solely because the writing became less colorful

---

### Requirement: Rebuild mode MUST preserve truth while changing form

A writer operating in `rebuild` mode SHALL be free to change article form aggressively, but SHALL preserve all of the following:

- frontmatter truth
- sourceUrl alignment
- factual claims that remain in the rewritten draft
- the core thesis actually supported by the source material

`Rebuild` SHALL NOT permit fabrication, thesis inversion, or removal of source caveats when the article is translation- or source-based.

#### Scenario: rebuild changes structure but not thesis

- **WHEN** a translation draft is rebuilt from a 17-tip list into a staged argument arc
- **THEN** the writer MAY reorder evidence and remove redundant tips
- **AND** SHALL keep the original supported thesis intact
- **AND** SHALL NOT invent claims absent from the source

#### Scenario: rebuild preserves frontmatter truth

- **WHEN** a writer runs in `rebuild` mode
- **THEN** the writer SHALL NOT alter title, ticketId, sourceUrl, publish date, or other frontmatter facts unless separately instructed by a valid edit task

---

### Requirement: Editorial system MUST optimize for memorable main line, not uniform improvement

For any draft entering `restructure` or `rebuild`, the editorial system SHALL prioritize amplifying the strongest main line over evenly improving every section.

This means the system SHOULD:

- identify 1–2 ideas worth preserving at all costs
- let weaker supporting material be cut if it dilutes the main line
- prefer coherence and memorability over exhaustive coverage

#### Scenario: weaker sections are cut to protect main line

- **WHEN** a draft contains one very strong central observation and several merely competent explanatory sections
- **THEN** the editorial rewrite MAY delete the weaker sections
- **AND** SHALL prefer a shorter but more coherent article over a more complete but diluted one

#### Scenario: recommendation emphasizes what to amplify

- **WHEN** the editorial judge returns guidance for a `restructure` or `rebuild`
- **THEN** the guidance SHALL identify what to amplify, not only what to fix
- **AND** SHALL make the main-line preservation visible to the writer
