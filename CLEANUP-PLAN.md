# Cleanup Plan (2026-03-15)

> For shroom-CC to pick up. Delete this file after tasks are done.

## Context (what sprin-CC did this session)

CI was fully red — every PR Fast Gate run was failing. sprin-CC fixed it in a series of commits:

1. **`fix(ci): drop explicit pnpm version`** — removed `with: { version: 10 }` from all workflow files so `pnpm/action-setup@v4` reads from `packageManager` in `package.json` (SSOT)
2. **`fix(ci): override flatted>=3.4.0`** — security-gate was failing because `flatted` (eslint → file-entry-cache → flat-cache → flatted) had a HIGH vuln (unbounded recursion DoS). Added pnpm override in `package.json` to force `>=3.4.0`
3. **`fix(lint): eslint errors`** — fixed `no-misleading-character-class` in `src/plugins/remark-kaomoji-nowrap.mjs` (combined character ᗜ̶ in regex, used `eslint-disable` block), removed unused `ARM_RE`, prefixed unused `_context` in `src/pages/api/feed.json.ts`
4. **`style: run prettier on all source files`** — 19 files had formatting violations. Ran `pnpm run format` on everything
5. **`fix(build): resolve TS errors`** — three pre-existing build errors:
   - `src/components/Mermaid.astro`: CDN import `import('https://...')` caused TS2307. Fixed by putting URL in a variable so TS sees `import(string)` instead of trying to resolve the literal
   - `src/pages/api/posts/[slug].json.ts`: `getCollection` return type was a union of posts+briefs. Used `CollectionEntry<'posts'>` to narrow
   - `tests/fixtures.ts`: monocart-reporter type mismatch. Simplified to `any` (this is the hack task #2 below will fix properly)
6. **`feat(hooks): add Prettier format check to pre-commit hook`** — added Step 0.6 in `scripts/hooks/pre-commit` that runs full `pnpm run format:check`. Also bumped CSS budget from 32→48KB in `quality/bundle-budget.json` because pre-push hook was blocking (CSS legitimately grew from new components)

**CSS investigation result**: CSS grew from ~21KB to ~27KB (source) / 44KB (built) due to legitimate feature additions (AiPopup 405 lines, Mermaid 227 lines, SearchBar 202 lines). No dead CSS found — all removed features (PWA, BackToTop) had their CSS cleaned up properly.

**Trend monitor note**: pre-push hook shows total HTML at 75MB / total at 83MB (way above 30MB critical threshold). This is from content growth (articles), not a bug. Thresholds in `quality/bundle-budget.json` may need adjusting.

## Tasks (ordered by priority)

### 1. Delete dead giscus theme file
- **File**: `public/giscus-tokyo-night.css`
- **Why**: Zero references in codebase. Theme switched to Dracula. Only `giscus-dracula.css` (dark) and `giscus-solarized-light.css` (light) are used in `src/components/Giscus.astro`
- **Action**: Delete file, verify build

### 2. Fix `any` type hack in test fixtures
- **File**: `tests/fixtures.ts` line 4
- **Why**: Current `let addCoverageReport: any = null` loses type safety
- **Action**: Import proper types from `monocart-reporter` and type the function signature correctly
- **Ref**: monocart-reporter types at `node_modules/monocart-reporter/lib/index.d.ts` line 218-221

### 3. (Optional) CSS investigation follow-up
- `src/components/AiPopup.astro` has 405 lines of scoped CSS — largest single contributor
- Could investigate lazy-loading the popup CSS (only load when Edit with AI is triggered)
- Not urgent: current 44.63KB is within 48KB budget

## Verification
After all changes:
```bash
pnpm exec eslint <changed-files>
pnpm exec prettier --check <changed-files>
pnpm exec astro check
# Then after push:
gh run watch  # monitor CI
```

## Notes
- `pnpm run lint` and `pnpm run format:check` OOM on sprin's Mac — run on specific files instead
- Pre-commit hook now runs Prettier check (added this session)
- Pre-push hook checks bundle budgets
