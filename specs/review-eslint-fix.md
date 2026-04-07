# Review: ESLint Fix

## Acceptance Criteria

- [x] ESLint 0 errors — **PASS**: `pnpm exec eslint .` produces 0 output lines, clean exit
- [x] Build passes — **PASS**: `pnpm run build` completes with "2673 page(s) built" and "[build] Complete\!"
- [x] 11 files modified as expected — **PASS**: `git diff --stat` confirms 11 files, 100 insertions, 26 deletions
- [x] Browser globals scoped to `e2e-tests/` only — **PASS**: `eslint.config.mjs` adds globals block with `files: ['e2e-tests/**/*.mjs']`
- [x] No rules disabled globally — **PASS**: no `eslint-disable` comments found in any changed file; `@typescript-eslint/no-unused-vars` override is scoped to specific file globs
- [x] `any` types replaced with proper types — **PASS**: `playwright.config.ts` uses `{ url: string }`, test files use `Record<string, unknown> | null`, `validate-lv-ticket.spec.ts` uses `e as { stdout?: string; stderr?: string }`
- [x] Unused vars prefixed with `_` not deleted — **PASS**: `assert`, `buildTree`, `collectA11yNodes`, `landmarks`, `COUNTER_FILE`, `VALID_PREFIXES`, `getBody`, `texts` all prefixed with `_` rather than removed
- [ ] TypeScript still clean (`astro check`) — **FAIL**: see below

## FAIL: `astro check` regression — 0 errors -> 8 errors

**Before fix**: `astro check` reports 0 errors, 0 warnings
**After fix**: `astro check` reports 8 errors, 0 warnings

All 8 errors are `ts(18047): 'capturedBody' is possibly 'null'`:
- `tests/ai-popup-chatbox.spec.ts` lines 151, 152, 183, 184 — accessing `.question`, `.text` on `capturedBody` after `expect(capturedBody).not.toBeNull()` (TS doesn't narrow from expect)
- `tests/ai-popup-edit-v2.spec.ts` lines 97, 98, 99, 101 — same pattern

**Root cause**: Builder changed `let capturedBody: any` to `let capturedBody: Record<string, unknown> | null` but didn't add a runtime null-guard or non-null assertion (`capturedBody\!.question`) after the `expect().not.toBeNull()` call. TypeScript's control flow analysis doesn't treat `expect()` as a type narrowing assertion.

**Fix options**:
1. Add `if (\!capturedBody) throw new Error('...');` before property access (best)
2. Use non-null assertion `capturedBody\!.question` (acceptable in tests)
3. Use `(capturedBody as Record<string, unknown>).question` (meh)

## Additional Findings

- **WARN**: `_landmarks` in `e2e-tests/suite.mjs:104` is declared, assigned `{}`, but never populated or read. The code immediately creates `tree = []` and pushes to that instead. This is dead code — the `_` prefix silences ESLint but the variable should probably just be removed.
- **WARN**: `_getBody` in `scripts/suggest-crosslinks.mjs:75` and `_testBackToTop`/`_testPWAManifest` in `e2e-tests/suite.mjs` are entire unused functions. Prefixing with `_` is correct for ESLint suppression, but these are candidates for deletion in a follow-up cleanup.
- **WARN**: `_texts` in `tests/ai-popup-iphone.spec.ts:216` is assigned `popup.innerText` but never used. The comment says "Currently neither is implemented." This is dead code masked by `_` prefix.
- **INFO**: `scripts/validate-posts.mjs` — `_COUNTER_FILE` and `_VALID_PREFIXES` are referenced nowhere in the file (confirmed by `astro check` warnings). These are used constants that lost their consumers at some point. Consider removing or re-integrating.

## Verdict: REQUEST_CHANGES

**Blocker**: The `astro check` regression (0 -> 8 TS errors) must be fixed before commit. The ESLint fix itself is correct and well-scoped, but it introduced TypeScript strictness errors by replacing `any` with `| null` without proper null narrowing.
