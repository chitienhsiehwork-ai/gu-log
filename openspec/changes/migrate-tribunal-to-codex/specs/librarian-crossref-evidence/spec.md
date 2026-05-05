## ADDED Requirements

### Requirement: Librarian SHALL receive deterministic repo evidence before judging

The tribunal Librarian stage SHALL receive a deterministic evidence packet containing target metadata, glossary hits, internal link checks, and related old posts before producing its score.

#### Scenario: Librarian stage starts

- **WHEN** the Librarian stage runs for a post
- **THEN** the runner SHALL generate an evidence packet for that post
- **AND** the Librarian prompt SHALL instruct the judge to use that packet before doing broad repo discovery

### Requirement: Similar old posts SHALL require citation or differentiation

When the evidence packet identifies a similar old gu-log post, the Librarian SHALL require the new post to either cite the old post or explain a distinct new POV, newer source, or different practical angle.

#### Scenario: New post overlaps old concept coverage

- **WHEN** a new SP repeats a concept already covered in an old gu-log post
- **THEN** the Librarian SHALL require a citation to the relevant old post
- **AND** the new post SHALL explain what new angle it adds

#### Scenario: Similar topic but new contribution exists

- **WHEN** a new post covers a similar topic but adds a distinct POV or newer primary source
- **THEN** the Librarian MAY pass the post
- **AND** it SHALL prefer adding a cross-reference over rejecting the post

### Requirement: Same source URL SHALL be treated as high-risk duplication

If the evidence packet finds an old post with the same source URL, the Librarian SHALL require explicit attribution to that old post or recommend merge/reject.

#### Scenario: Same source URL appears

- **WHEN** a draft post has the same source URL as an existing post
- **THEN** the Librarian SHALL flag the overlap
- **AND** the post SHALL NOT pass crossRef unless it explicitly justifies why a separate post is needed
