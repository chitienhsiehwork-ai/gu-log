# Spec Delta

## MODIFIED Requirements

### Requirement: Article version semantics SHALL support content-oriented feedback

Gu-log SHALL bind feedback to both the file-touch `postVersion` and the content version. The content version SHALL be the reader revision: the reader-facing content hash published in the reader revision manifest, which excludes metadata such as Tribunal scores. Where other specs refer to `contentVersion` or `contentHash`, the reader revision SHALL satisfy them. Readability feedback SHALL be judged against the reader revision rather than metadata-only file changes.

#### Scenario: Metadata-only score update changes file version

- **WHEN** Tribunal updates only frontmatter scores without changing article body
- **THEN** the system MAY bump `fileVersion`
- **BUT** SHALL keep the reader revision unchanged
- **AND** readability feedback SHALL remain associated with the unchanged reader revision

#### Scenario: Body rewrite changes content version

- **WHEN** Tribunal rewrites article body text
- **THEN** the reader revision SHALL change
- **AND** future feedback SHALL bind to the new reader revision
