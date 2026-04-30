## Why

The cancellation deadline changes the experiment from a slow three-PR comparison into an urgent quota-burn benchmark: Claude weekly quota should be spent down before midnight today while producing useful model-comparison artifacts for gu-log.

The experiment still starts from real gu-log posts, but it no longer waits for GPT-5.5/Codex. Sprin will configure Codex later. Iris SHALL focus now on Claude Opus 4.7, 4.6, and 4.5 and run repeated URL-only blind tests against good gu-log article/source candidates.

## What Changes

- Pivot the SP-181 blind eval into a Claude-only quota-burn experiment that runs until midnight Asia/Taipei or until Claude quota is effectively exhausted.
- Compare exactly three Claude Opus models:
  - Opus 4.7
  - Opus 4.6
  - Opus 4.5
- Start each model from only one URL per trial, selected from existing gu-log posts with `sourceUrl` metadata.
- Keep Apple / Banana / Camera as per-trial blind labels, but randomize their model mapping per trial and store mapping only in local experiment artifacts.
- Produce reusable result artifacts, not production article branches, unless Sprin later asks to turn a winning candidate into a PR.
- Add a quota-burn runner that can select candidates, launch concurrent Opus calls, monitor quota, and stop near midnight.

## Capabilities

### New Capabilities

- `tribunal-blind-model-eval`: Defines how gu-log runs blind URL-only model evaluations and urgent Claude quota-burn experiments.

### Modified Capabilities

- Existing SP-181 blind-eval scope is narrowed for today: GPT-5.5/Codex is postponed, Claude Opus 4.7/4.6/4.5 are in scope now.

## Impact

- Adds a script under `scripts/` for Claude Opus URL-only quota-burn experiments.
- Writes experiment results under `.score-loop/opus-url-burn/` so production content is untouched.
- Does not create blind PRs by default during the burn window.
- Does not merge or publish generated candidates automatically.
- May consume nearly all remaining Claude weekly quota before midnight by explicit user instruction.
