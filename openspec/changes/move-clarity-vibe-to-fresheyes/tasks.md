## 1. TDD — write failing tests first

- [ ] 1.1 In `tests/tribunal-v2/pass-bar.test.ts`, add v9 cases: Vibe composite = floor(sum of 4 dims / 4); Vibe pass bar over 4 dims (no `clarity`).
- [ ] 1.2 In `tests/tribunal-v2/pass-bar.test.ts`, add v9 cases: Fresh Eyes composite = floor(sum of 5 dims / 5); pass bar requires composite≥8 AND payoffDensity≥8 AND lengthFit≥8 AND clarity≥8; clarity=7 fails despite high composite.
- [ ] 1.3 In `tests/tribunal-v2/pass-bar.test.ts`, add regression cases: v8 posts keep legacy Vibe(5)/FreshEyes(4) math and bars unchanged.
- [ ] 1.4 In `tests/content-gates.test.ts`, add floor-gate cases: v9 post needs 4 vibe dims + composite≥3 (no clarity required); v8 post still needs 5; missing a required dim blocks commit; legacy v8 post with `scores.vibe.clarity` still validates.
- [ ] 1.5 Update `tests/content-gates.test.ts:236-244` (`JUDGE_DIMS has 5 vibe dimensions`) for the version-aware `JUDGE_DIMS` shape (function / version-keyed map).
- [ ] 1.6 In `tests/tribunal-v2/pipeline.test.ts`, update the `vibe()` / fresh-eyes factories so v9 fixtures carry clarity under fresheyes; confirm tests fail against current code.

## 2. Core logic (version-aware resolver + pipeline plumbing)

- [ ] 2.1 `src/lib/tribunal-v2/pass-bar.ts`: replace constant `VIBE_DIMS` / fresh-eyes dim set with version-aware resolvers (`vibeDims(version)`, `freshEyesDims(version)`); v≥9 → new sets, else legacy.
- [ ] 2.2 `src/lib/tribunal-v2/pass-bar.ts`: route composite math and pass bars (`checkVibePassBar`, `checkFinalVibePassBar`, `checkFreshEyesPassBar`) through the resolver; add the non-compensating `clarity≥8` gate for v≥9 Fresh Eyes; thread a `version` parameter into these functions.
- [ ] 2.3 `src/lib/tribunal-v2/pipeline.ts`: plumb the post's `tribunalVersion` into scope; pass it to the pass-bar functions AND add the clarity gate to the inline `verifyFreshEyesPassBar` copy (pipeline.ts:198-212).
- [ ] 2.4 `src/lib/tribunal-v2/types.ts`: add `clarity` to `FreshEyesJudgeOutput.scores`; keep `clarity` on `VibeJudgeOutput.scores` optional (legacy).
- [ ] 2.5 `src/content/config.ts`: add optional `scores.freshEyes.clarity`; keep optional `scores.vibe.clarity` (additive, non-destructive).
- [ ] 2.6 `src/lib/tribunal-v2/git-format.ts:42`: make the commit-message vibe line version-aware (drop clarity from vibe line for v9; put it on the fresheyes line).
- [ ] 2.7 Run unit tests from group 1 until green.

## 3. Gate scripts (version-aware — these are the blocking holes)

- [ ] 3.1 `scripts/score-floor-check.mjs`: make the required vibe dimension set + composite divisor version-aware (4 dims for v≥9, 5 for v≤8); composite≥3 unchanged. (It already reads `tribunalVersion` from frontmatter.)
- [ ] 3.2 `scripts/validate-posts.mjs` Rule 15 (~lines 369-413): make the per-judge dimension lists version-aware for BOTH the vibe branch and the SD branch — v≥9 expects 4 vibe dims + clarity under freshEyes; v≤8 keeps the legacy 5-vibe-dim requirement. Without this, v9 posts are rejected at pre-commit + CI.
- [ ] 3.3 `scripts/score-helpers.sh:288-298` and `scripts/validate-judge-output.sh:85-95`: make the judge-output dimension validators version-aware so the v9 vibe judge (no clarity) and v9 fresh-eyes judge (with clarity) pass.
- [ ] 3.4 `scripts/tribunal-helpers.sh:16`: update the documented vibe schema comment for consistency.

## 4. Version stamp sites (bump 8 → 9, keep in lockstep)

- [ ] 4.1 `scripts/frontmatter-scores.mjs:41`: `CURRENT_TRIBUNAL_VERSION = 9` (the canonical frontmatter stamp).
- [ ] 4.2 `scripts/tribunal.sh:47` and `scripts/tribunal-quota-loop.sh:41`: `TRIBUNAL_VERSION=9` (ledger stamp — must match frontmatter or versions diverge).
- [ ] 4.3 `scripts/frontmatter-scores.mjs`: for v9 runs write `clarity` under `freshEyes`; reads stay backward-compatible for v8 `scores.vibe.clarity`.
- [ ] 4.4 Confirm `validate-posts.mjs:370` `>= 8` branch still behaves correctly with the new version-aware Rule 15 (it should now accept both v8 and v9 shapes).

## 5. Scoring SSOT + judge agents

- [ ] 5.1 `scripts/vibe-scoring-standard.md`: move the `clarity` rubric/definition from the Vibe section to the Fresh Eyes section; restate Vibe as 4 dims and Fresh Eyes as 5 dims; recalibrate examples; note version gating.
- [ ] 5.2 `.claude/agents/vibe-opus-scorer.md` AND `.codex/agents/vibe-opus-scorer.toml`: remove `clarity` from rubric + output JSON; reflect 4-dim composite + pass bar.
- [ ] 5.3 `.claude/agents/fresh-eyes.md` AND `.codex/agents/fresh-eyes.toml`: add `clarity` as 5th dimension with the moved rubric + non-compensating gate; update output JSON.
- [ ] 5.4 `src/lib/tribunal-v2/runners/stage-runners.ts:104`: update Final Vibe prompt wording ("the same 5 dimensions" → 4 for v9).

## 6. UI

- [ ] 6.1 `src/components/AiJudgeScore.astro`: render `clarity` under the Fresh Eyes panel for v9 posts and under Vibe for legacy posts (the `!== undefined` per-dimension guards make this additive).

## 7. Docs (atomic, same PR)

- [ ] 7.1 `CLAUDE.md`: update tribunal dimension references (Vibe 4 / Fresh Eyes 5) and note version-gating.
- [ ] 7.2 `playbooks/mac-CC-playbook.md` and `playbooks/CCC-playbook.md`: update any vibe/fresh-eyes dimension lists + pass bars.

## 8. Verify + ship

- [ ] 8.1 `pnpm exec vitest run` + `node scripts/validate-posts.mjs` green; spot-check a real v8 post still validates and renders unchanged.
- [ ] 8.2 `openspec validate move-clarity-vibe-to-fresheyes --strict` passes.
- [ ] 8.3 Mark PR #458 ready, let CI run, self-merge per CCC playbook once green.
