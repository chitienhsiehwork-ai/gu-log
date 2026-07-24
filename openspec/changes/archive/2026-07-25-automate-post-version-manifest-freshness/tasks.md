# Tasks

> 2026-07-25：本 change 已被 PR #552 的 pre-commit staged projection 取代，以下 implementation
> tasks 刻意保持未完成，作為「沒有實作 post-commit auto-commit」的歷史證據。封存時使用
> `--skip-specs`，不把被否決的 delta 同步到 stable specs。

## 1. OpenSpec

- [ ] 1.1 Add `post-version-manifest-freshness` capability spec delta.
- [ ] 1.2 Validate the change with OpenSpec when the CLI is available.

## 2. Post-commit automation

- [ ] 2.1 Add `scripts/hooks/post-commit`.
- [ ] 2.2 Add `scripts/refresh-post-version-manifest-after-commit.mjs`.
- [ ] 2.3 Detect whether latest `HEAD` touches `src/content/posts/*.mdx`.
- [ ] 2.4 Regenerate `src/data/post-versions.json` only when full history is available.
- [ ] 2.5 Create generated follow-up commit when the manifest changes.
- [ ] 2.6 Add recursion guard so generated manifest commits do not trigger another generated commit.
- [ ] 2.7 Refuse auto-commit on dirty unrelated worktree, in-progress git operations, or incomplete history.

## 3. Existing guardrails

- [ ] 3.1 Keep `pre-push` freshness check as a fallback.
- [ ] 3.2 Improve `scripts/build-version-manifest.mjs --check` stale message to mention the new helper/hook.
- [ ] 3.3 Ensure `scripts/setup-hooks.sh` installs `post-commit` and syncs `.githooks/post-commit`.
- [ ] 3.4 Keep CI `tests/post-version-manifest.test.ts` as final authority.

## 4. Tests

- [ ] 4.1 Add helper tests with synthetic repos for stale/fresh/non-post commits.
- [ ] 4.2 Add recursion guard test for generated manifest commit.
- [ ] 4.3 Add dirty worktree refusal test.
- [ ] 4.4 Add hook installation/integration test for `post-commit`.
- [ ] 4.5 Run targeted vitest and full build.

## 5. Docs

- [ ] 5.1 Update `CONTRIBUTING.md` to explain automatic manifest repair.
- [ ] 5.2 Update `CLAUDE.md` / agent playbook so agents no longer manually remember the post-commit manifest sequence.
- [ ] 5.3 Document the fallback when hooks are not installed: run the helper or rely on pre-push/CI error output.
