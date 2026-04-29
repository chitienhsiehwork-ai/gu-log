## Why

Sprin wants to evaluate whether GPT-5.5 can replace Opus in the Tribunal pipeline, but the comparison must be grounded in a realistic article review rather than model vibes or synthetic benchmarks.

The first experiment SHALL use SP-181 because it is hard enough to be worth reading three times: the article depends on multi-agent nuance, production-agent judgment, and gu-log voice. The human reviewer is Sprin only, so the workflow should minimize ceremony while preserving blind comparison quality.

## What Changes

- Define a three-candidate blind evaluation for SP-181 using Vercel Preview PRs.
- Use neutral candidate labels: Apple, Banana, Camera.
- Compare three Tribunal configurations:
  - Current Opus Tribunal baseline.
  - All Opus 4.7 Tribunal.
  - All GPT-5.5 Tribunal.
- Require Codex/GPT-5.5 runner setup and smoke verification before starting the full experiment.
- Require branch/PR/title labeling that helps Sprin refer to candidates without revealing model mapping.
- Require cleanup before merging any winning candidate so blind labels do not ship to production.

## Capabilities

### New Capabilities

- `tribunal-blind-model-eval`: Defines how gu-log runs blind, branch-based Tribunal model evaluations with Vercel Preview URLs.

### Modified Capabilities

- None. This is an experiment spec; implementation may later add reusable runner adapters or scripts.

## Impact

- `scripts/tribunal-all-claude.sh` or a new experiment runner may need model-suite overrides.
- A Codex/OpenAI runner adapter may be needed for GPT-5.5 judge/writer stages.
- Draft PRs and Vercel Preview deployments will be created for the three candidates.
- SP-181 article files will be modified only inside experiment branches.
- The main branch SHALL NOT receive blind labels or losing candidates.
