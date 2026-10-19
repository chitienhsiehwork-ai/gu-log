## Why

Production smoke after #1065 found that every manifest-backed legacy article redirect works without a trailing slash, while the same historically valid path with `/` now returns 404. Existing articles are reachable in both forms under the deployed Vercel default, so removing an article must preserve both forms without doubling the finite platform route count.

## What Changes

- Match each manifest-backed legacy article pathname with one exact Vercel optional-trailing-slash path pattern.
- Keep one redirect rule per manifest entry and reject deeper or otherwise expanded legacy paths.
- Extend route tests and the production verifier to exercise both pathname forms.

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `brand-taxonomy`：reader-facing legacy article compatibility must cover the exact path both with and without one trailing slash while remaining direct, permanent, and bounded.

## Impact

- `vercel.mjs` manifest-backed redirect source generation。
- Redirect config tests and `scripts/verify-brand-redirects.mjs` production audit。
- 新增一個 test-only direct devDependency（`path-to-regexp`），用 Vercel 同系列 parser 驗 source pattern；沒有 production dependency、content、canonical URL、API 或 runtime data-model change。
