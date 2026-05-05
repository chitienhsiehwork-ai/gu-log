## ADDED Requirements

### Requirement: People glossary entries SHALL be stored in glossary SSOT

Recurring people referenced by gu-log posts SHALL be represented in `src/data/glossary.json` with a `people` category, canonical term, short definition, related entries, and first-definition post.

#### Scenario: Andrej Karpathy appears in a new post

- **WHEN** a post mentions Andrej Karpathy
- **THEN** the post MAY link to the glossary entry
- **AND** the post SHALL NOT reintroduce his full background unless the article needs a new contextual angle

### Requirement: Glossary aliases SHALL support identity linking

Glossary entries SHALL support aliases so librarian tooling can detect common short names, handles, and spelling variants.

#### Scenario: Alias is used in article body

- **WHEN** article text uses `Karpathy`, `SimonW`, or `bcherny`
- **THEN** librarian tooling SHALL be able to associate the alias with the canonical glossary entry

### Requirement: Glossary UI SHALL render people category explicitly

The glossary page SHALL render `people` as a first-class category with an explicit label rather than falling back to raw or missing category text.

#### Scenario: People category exists

- **WHEN** the glossary contains at least one entry with category `people`
- **THEN** the glossary page SHALL show a people category filter/label
- **AND** those entries SHALL be reachable by stable glossary anchors
