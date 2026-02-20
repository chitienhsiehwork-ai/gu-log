# MDX Prettier Compatibility TODO (Level 3 / Plan C)

## Why this exists

`src/content/posts/*.mdx` currently contains project-specific MDX syntax patterns that Astro can render, but Prettier's parser cannot reliably parse.

So in Level 3 we split checks:
- Prettier for code/config paths (signal stays useful)
- content checks via `validate:posts` + `build` (quality still enforced)

## Current parse-error hotspots (from baseline `pnpm run format:check` before split)

- Total SyntaxError files: **294**
- Extension split: **293 mdx**, **1 astro**
- Dominant parser error type: **Unexpected token** (287 cases)

### Common MDX patterns to normalize later

1. Custom shorthand wrapper syntax, e.g.:
   - `<$><ClawdNote> ... </$>`
   - `<$><Toggle ...> ... </$>`
2. Raw JSON / object-like content at top-level (not fenced code block)
3. Raw script-like snippets (e.g. function calls) in article body
4. Unescaped `>` sequences in plain text where MDX expects JSX/HTML-safe tokenization

## Progressive convergence plan

### Phase A (done in this PR)
- Keep `src/content/posts/*.mdx` out of Prettier scope (targeted format scripts)
- Keep content quality gate active via:
  - `pnpm run validate:posts`
  - `pnpm run build`

### Phase B (next)
- Create codemods / authoring rules to normalize the 4 hotspot patterns above.
- Prioritize files with repeated wrappers (`<$>...</$>`) first.

### Phase C (after normalization)
- Gradually re-enable Prettier for MDX by subset (batch/folder allowlist), not all-at-once.
- Keep this file updated with remaining incompatible pattern counts.
