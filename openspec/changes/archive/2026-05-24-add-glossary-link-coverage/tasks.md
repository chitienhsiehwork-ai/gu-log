## 1. OpenSpec

- [x] 1.1 Add glossary-link-coverage proposal / design / spec deltas
- [x] 1.2 Validate OpenSpec change with `openspec validate add-glossary-link-coverage --strict`

## 2. Deterministic checker / fixer

- [x] 2.1 Add tests for parser boundaries: frontmatter, code, inline code, links, blockquotes, HTML attrs
- [x] 2.2 Add tests for per-post per-term first safe occurrence policy
- [x] 2.3 Add tests for zh-tw vs en glossary URL selection
- [x] 2.4 Add tests for `linking.match` not raw aliases
- [x] 2.5 Implement `scripts/check-glossary-links.mjs`
- [x] 2.6 Implement `scripts/apply-glossary-links.mjs`

## 3. Phase 1 ratchet

- [x] 3.1 Add package scripts for changed glossary/post checks
- [x] 3.2 Wire pre-commit to run changed-post / changed-term glossary coverage checks
- [x] 3.3 Wire CI to run changed-post / changed-term glossary coverage checks on PRs

## 4. Phase 2 report + safe backfill

- [x] 4.1 Add full-site report support
- [x] 4.2 Add `--all` and `--term` fixer modes
- [x] 4.3 Backfill safe existing corpus links, including Elixir

## 5. Phase 3 full hard gate

- [x] 5.1 Add full-site `glossary:check` CI hard gate
- [x] 5.2 Verify full-site checker passes after backfill / ignore decisions

## 6. Verification / delivery

- [x] 6.1 Run focused tests
- [x] 6.2 Run `pnpm run build`
- [x] 6.3 Open PR, monitor CI, merge, smoke prod
