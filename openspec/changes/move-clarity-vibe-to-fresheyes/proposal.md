## Why

The Vibe Scorer's `clarity` dimension (pronoun / voice attribution) has historically been an easy dimension that props up the vibe composite — a "送分題" that lets a post clear the vibe pass bar without genuinely earning persona / clawdNote / vibe / narrative. Clarity is fundamentally a *reader-comprehension* signal, which is exactly what the Fresh Eyes judge (a zero-context stranger reader) is built to assess. Moving clarity out of Vibe and into Fresh Eyes — and making it a non-compensating hard gate there — makes **both** judges stricter and puts each dimension under the judge best suited to score it.

## What Changes

- **BREAKING (scoring contract, version-gated):** Introduce `tribunalVersion: 9`. All scoring-dimension changes below apply only to posts scored at `tribunalVersion >= 9`. Posts at `tribunalVersion <= 8` keep the old rules unchanged (grandfathered).
- **Vibe judge: 5 → 4 dimensions.** Remove `clarity`. New dims: `persona`, `clawdNote`, `vibe`, `narrative`. Composite becomes `floor(sum / 4)`. Vibe pass bar wording unchanged (composite ≥ 8 AND at least one dim ≥ 9 AND no dim < 8) but now evaluated over 4 dims.
- **Fresh Eyes judge: 4 → 5 dimensions.** Add `clarity`, keeping its current meaning (pronoun / voice attribution: each sentence makes it obvious who is speaking). It coexists with `readability` as an independent dimension (readability = can you follow the rhythm; clarity = whose voice is speaking). Composite becomes `floor(sum / 5)`.
- **Fresh Eyes pass bar gains a non-compensating gate on clarity.** New bar: composite ≥ 8 AND `payoffDensity` ≥ 8 AND `lengthFit` ≥ 8 AND `clarity` ≥ 8.
- **Floor commit gate** (`scores.vibe`) requires the 4 vibe dims (not 5) + composite ≥ 3 for `tribunalVersion >= 9`; keeps requiring 5 dims for `<= 8`.
- **No migration.** Existing posts' frontmatter is not touched. Logic branches on `tribunalVersion`.

## Capabilities

### New Capabilities
- `tribunal-scoring-dimensions`: Defines which judge owns which scoring dimension, per-judge composite math, per-judge pass bars (including non-compensating hard gates), the floor commit-gate dimension set, and how all of the above are gated by `tribunalVersion` so older posts remain valid.

### Modified Capabilities
- `tribunal-human-signal-loop`: The human-signal routing requirement currently states confusion feedback routes to "FreshEyes readability and Vibe clarity". Since clarity now lives in Fresh Eyes, this routing changes to FreshEyes readability and FreshEyes clarity.

## Impact

- **Core logic:** `src/lib/tribunal-v2/pass-bar.ts` (VIBE_DIMS, FRESHEYES dims, composite divisors, pass-bar predicates — version-aware), `src/lib/tribunal-v2/types.ts` (VibeJudgeOutput / FreshEyesJudgeOutput dimension fields), `src/content/config.ts` (scores.vibe / scores.freshEyes Zod schema), `scripts/score-floor-check.mjs` (dimension set + composite, version-aware).
- **Scoring SSOT:** `scripts/vibe-scoring-standard.md` (move clarity rubric from Vibe section to Fresh Eyes section; recalibrate examples for 4-dim vibe / 5-dim fresh eyes).
- **Judge agents:** `.claude/agents/vibe-opus-scorer.md`, `.claude/agents/fresh-eyes.md`, `.codex/agents/fresh-eyes.toml`.
- **UI / tooling:** `src/components/AiJudgeScore.astro` (dimension display), `scripts/frontmatter-scores.mjs` (read/write dimension mapping).
- **Tests (TDD — write first):** `tests/tribunal-v2/pass-bar.test.ts`, `tests/tribunal-v2/pipeline.test.ts`, `tests/content-gates.test.ts`.
- **Docs:** `CLAUDE.md`, `playbooks/mac-CC-playbook.md`, `playbooks/CCC-playbook.md` (dimension-count references).
- **Non-goals:** no migration script; no re-scoring or rewriting of existing `tribunalVersion <= 8` posts; no change to Librarian or Fact Checker judges; no change to the homepage publish bar (overall composite ≥ 8) itself.
