# Proposal: Automate post version manifest freshness

## Why

`src/data/post-versions.json` is derived from full git history. For a
reader-visible post edit, the final value is only knowable after the commit
exists. That is why the current agent workflow can pass local build, push a PR,
and still fail CI later with a stale manifest.

The repo already has guardrails:

- `tests/post-version-manifest.test.ts` catches stale manifests in CI.
- `scripts/hooks/pre-push` can detect staleness, regenerate the file, and abort.

But the repair still depends on a human or agent remembering the last step:
commit the regenerated manifest, or amend the previous commit, then push again.
This should be machine work.

## What Changes

- Add a `post-commit` hook that runs after a local commit touches
  `src/content/posts/*.mdx`.
- The hook refreshes `src/data/post-versions.json` against the new `HEAD`.
- If the manifest changed, automation creates a generated follow-up commit such
  as `chore: refresh post version manifest`.
- Keep `pre-push` and CI as layered safety nets for missing hooks, shallow
  history, failed regeneration, or skipped local automation.
- Document that agents should no longer rely on memory for this sequence; the
  repo owns the repair loop.

## Non-goals

- Do not predict the next manifest from `pre-commit`; the commit does not exist
  yet and history simulation is fragile.
- Do not rewrite the user's just-created commit by default.
- Do not auto-commit from CI in the first implementation.
- Do not remove the committed manifest or change its semantics from full-history
  post touch counts.
- Do not let Vercel shallow builds regenerate this manifest; production still
  serves the committed file.

## Capabilities

### New Capabilities

- `post-version-manifest-freshness`: defines the post-commit automation and
  layered freshness checks for `post-versions.json`.

### Modified Capabilities

- None.

## Impact

This changes local authoring, agent shipping workflows, git hook installation,
and CI diagnostics. It should remove the recurring "commit → push → CI stale
manifest → amend → push again" failure mode for content PRs while preserving CI
as the final authority.

## Approval Meaning

Approving this change means gu-log should treat `post-versions.json` freshness
as an automated post-commit repair, not as an agent checklist item.
