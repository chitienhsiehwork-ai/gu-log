# Cleanup Plan (2026-03-15)

> For shroom-CC to pick up. Delete this file after tasks are done.

## Context
sprin-CC session fixed CI from red to green (lint, prettier, TS build errors, security gate). These cleanup items were discovered along the way.

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
