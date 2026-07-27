# versioned-human-feedback Specification

## Purpose

定義人類回饋與文章可見版本的綁定、公開／私密訊號邊界、內容版本語意與 resolution lifecycle，讓後續自動化只採信可追溯且仍有效的回饋。

## Requirements

### Requirement: Gu-log comments and feedback SHALL bind to the article version visible at submission time

Every gu-log comment or feedback record intended for quality learning SHALL include the article version snapshot visible when the feedback was submitted.

The snapshot SHALL include at least:

- `postId`
- `lang`
- `pathname`
- `postVersion` as an integer current file-touch version; content semantics require `contentVersion` when available
- `createdAt`

The snapshot SHOULD include when available:

- `ticketId`
- `contentVersion`
- `contentHash`
- qualified commit fields such as `servedBuildCommit`, `articleFileCommit`, or `contentCommit`
- `sourceDiscussionId` or `commentId`
- `commentUrl`

#### Scenario: ShroomDog leaves a negative gu-log comment on v1

- **WHEN** ShroomDog leaves a gu-log comment saying `這篇難看死了` while the article page version snapshot resolves to `v1`
- **THEN** the feedback record SHALL bind that comment to `postVersion=1`
- **AND** the record SHALL NOT be interpreted as feedback on a later rewritten `v2` or `v5`
- **AND** implementation SHALL expose version metadata through a page-level snapshot helper or data attribute rather than relying on the human seeing a version badge near the comment box
- **AND** later versions MAY reference it as a prior-version failure reason

#### Scenario: Tribunal rewrites the article after the comment

- **WHEN** Tribunal rewrites the article and the page later displays a higher version
- **THEN** the original comment SHALL remain attached to the version it was submitted against
- **AND** the rewritten version SHALL be evaluated with new human signals rather than inheriting unresolved negative sentiment blindly

---

### Requirement: Comment presence SHALL NOT imply positive engagement

Gu-log SHALL classify comment sentiment and feedback type before using comments as quality signals. The existence of a comment SHALL NOT be treated as positive by default.

#### Scenario: Explicit short negative comment

- **WHEN** a comment body is `這篇難看死了` or an equivalent explicit negative review
- **THEN** the system SHALL classify it as `sentiment="negative"`
- **AND** SHOULD classify `feedbackType="boring_or_bad_read"` or equivalent
- **AND** SHALL mark it as eligible to trigger rewrite/review policy

#### Scenario: Follow-up idea comment

- **WHEN** a comment suggests a related future article or adds a useful angle
- **THEN** the system MAY classify it as `feedbackType="followup_seed"`
- **AND** SHALL NOT treat it as boring/negative unless the body also expresses negative quality judgment

#### Scenario: Praise or share-like comment

- **WHEN** a comment explicitly says the article is useful, fun, or share-worthy
- **THEN** the system MAY classify it as positive
- **AND** SHALL still keep the article version snapshot so future rewrites do not misattribute the praise

---

### Requirement: Versioned feedback SHALL separate public comments from private editorial signals

Gu-log SHALL distinguish public comments, private ShroomDog feedback, AI edit suggestions, and generalized editorial corpus lessons.

#### Scenario: Public Giscus comment is indexed

- **WHEN** a public Giscus/GitHub Discussion comment is imported into the human feedback ledger
- **THEN** the imported record SHALL retain source identifiers such as discussion/comment id and URL
- **AND** the record SHALL mark visibility as public or source-managed

#### Scenario: Private ShroomDog feedback is recorded

- **WHEN** ShroomDog records private feedback that should guide Tribunal but not become public
- **THEN** the record SHALL mark visibility as private or operator-only
- **AND** implementation SHALL NOT expose the raw private body on the public article page by default

#### Scenario: General writing lesson is promoted to editorial corpus

- **WHEN** a specific feedback item reveals a reusable writing rule
- **THEN** the distilled lesson MAY be appended to `docs/shroomdog-editorial-feedback.md`
- **BUT** raw per-article feedback SHALL NOT be copied wholesale into the general corpus merely because it exists

---

### Requirement: Giscus pathname comments SHALL require a version-indexing strategy before driving automation

Because current Giscus configuration maps comments by pathname, Gu-log SHALL NOT use raw Giscus comments as Tribunal automation input until they have been indexed with article identity and version metadata.

#### Scenario: Raw Giscus comment exists without version metadata

- **WHEN** a GitHub Discussion comment is found only by pathname
- **AND** no version snapshot has been resolved
- **THEN** the system SHALL treat the comment as unversioned raw input
- **AND** SHALL NOT use it to trigger automatic Tribunal rewrite until version binding is resolved or a human confirms the binding

#### Scenario: Indexer resolves version by timestamp

- **WHEN** a Giscus-derived indexer imports a comment with `createdAt`
- **AND** the post version history can resolve which version was live at that time
- **THEN** the indexer MAY bind the comment to that version
- **AND** the record SHALL include a resolution method such as `timestamp_inferred`
- **AND** the record SHOULD include confidence or ambiguity when commit/version boundaries are unclear

#### Scenario: First-party feedback form submits metadata directly

- **WHEN** a first-party gu-log feedback form submits a comment
- **THEN** the submission SHALL include the current version snapshot directly from the article page
- **AND** no timestamp inference SHALL be required for the initial binding

---

### Requirement: Article version semantics SHALL support content-oriented feedback

Gu-log SHALL define whether a feedback record binds to file touch version, content version, or both. Long-term, feedback about readability SHOULD bind to content version rather than metadata-only file changes.

#### Scenario: Metadata-only score update changes file version

- **WHEN** Tribunal updates only frontmatter scores without changing article body
- **THEN** the system MAY bump `fileVersion`
- **BUT** SHOULD keep `contentVersion` unchanged
- **AND** readability feedback SHOULD remain associated with the unchanged content version

#### Scenario: Body rewrite changes content version

- **WHEN** Tribunal rewrites article body text
- **THEN** the system SHALL create or resolve a new content version
- **AND** future comments SHALL bind to the new content version

---

### Requirement: Feedback records SHALL have explicit resolution state

Versioned feedback used by Tribunal SHALL track resolution state so old negative feedback does not permanently poison later versions.

Valid states SHALL include at least:

- `open`
- `requeued`
- `addressed_by_rewrite`
- `accepted_current`
- `deferred`
- `false_positive`

#### Scenario: Negative v1 feedback is addressed by v2 rewrite

- **WHEN** v1 has an open negative feedback record
- **AND** Tribunal rewrites the article into v2 to address it
- **THEN** the feedback MAY transition to `addressed_by_rewrite`
- **AND** the resolution SHALL reference the new version or rewrite run
- **AND** v2 SHALL require new human/Tribunal evidence before being considered fixed

#### Scenario: Human accepts current version despite old negative feedback

- **WHEN** ShroomDog explicitly decides the current version is acceptable
- **THEN** open negative feedback MAY transition to `accepted_current`
- **AND** the resolution SHALL record who/when/why at a summary level

---

### Requirement: Current postVersion semantics SHALL be explicit

Current `postVersion` SHALL be treated as the existing file-touch version generated by `scripts/build-version-manifest.mjs`, not as a content-only version. Until `contentVersion` exists, human feedback MAY bind to `postVersion` as the best available visible snapshot, but readability semantics MUST NOT assume that every `postVersion` bump means body content changed.

If commit fields are recorded, each field SHALL specify its semantic role, such as `servedBuildCommit`, `articleFileCommit`, or `contentCommit`. Implementations SHALL NOT use an unqualified `commit` field for automation decisions.

#### Scenario: Metadata-only score update changes file version

- **WHEN** Tribunal updates only frontmatter scores without changing article body
- **THEN** the system MAY bump current file-touch `postVersion`
- **BUT** SHALL NOT infer that readability feedback has a new content target unless `contentVersion` or `contentHash` changed

#### Scenario: Qualified commit fields are recorded

- **WHEN** an event snapshot records a commit-like identifier
- **THEN** the field name SHALL identify whether it is the served build commit, article file commit, or content commit
- **AND** automation SHALL NOT rely on a generic ambiguous `commit` field
