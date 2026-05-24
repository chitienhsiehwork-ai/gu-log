## Overview

Glossary link coverage is a deterministic content hygiene gate. It should behave like `check-jingjing.mjs`: fast, explainable, safe by default, and strict only where the boundary is already decided.

## Link policy

The checker enforces article-level coverage, not occurrence-level linking:

- If a post body contains a glossary term, the post MUST contain at least one safe Markdown link for that term to the correct glossary anchor.
- The fixer SHOULD link only the first safe occurrence per term per post.
- Existing links count if they point to the expected glossary path and anchor.

## Parsing boundaries

The scanner treats only article body prose as linkable. It MUST ignore:

- YAML frontmatter
- fenced code blocks
- inline code spans
- Markdown link text and targets
- raw URLs
- import/export lines
- MDX component tags and attributes
- blockquotes by default

This keeps source quotes and structured metadata from being rewritten by automation.

## Glossary linking config

`src/data/glossary.json` may optionally include:

```json
{
  "term": "Elixir",
  "linking": {
    "enabled": true,
    "anchor": "elixir",
    "match": ["Elixir"],
    "caseSensitive": true
  }
}
```

Rules:

- `linking.enabled: false` disables automatic enforcement for that entry.
- If `linking` is absent, the canonical `term` is used as the only matcher.
- `aliases` are not automatic matchers; they are often for search/explanation and may be ambiguous.
- Longer match strings win before shorter strings to avoid `Codex` stealing `Codex app server`.

## Ignore mechanisms

A post may opt out of specific terms with either:

```md
---
glossaryIgnore:
  - Elixir
---
```

or body comments:

```md
<!-- glossary-ignore Elixir -->
```

Ignore should be rare and reviewable.

## Phase rollout

### Phase 1

Changed-term and changed-post ratchet:

- PR changes to `src/data/glossary.json` run checks for changed glossary terms across all posts.
- PR changes to posts run checks for all enabled glossary terms in those posts.
- pre-commit mirrors the same logic for staged files.

### Phase 2

Full report and backfill:

- `scripts/check-glossary-links.mjs --all --format json` provides full-site coverage report.
- `scripts/apply-glossary-links.mjs --all` backfills safe first occurrences.

### Phase 3

Full hard gate:

- CI runs `pnpm run glossary:check` on every PR.
- The gate fails on any unlinked enabled glossary term in any post.

## Risks

- Overlinking harms reading flow. Mitigation: first occurrence only.
- Ambiguous terms can create wrong links. Mitigation: explicit `linking.match`, ignore list, and disabled linking.
- Backfill creates large diffs. Mitigation: idempotent fixer and reviewable output.
