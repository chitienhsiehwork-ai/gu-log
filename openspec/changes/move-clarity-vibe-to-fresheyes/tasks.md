## 1. TDD — write failing tests first

- [ ] 1.1 In `tests/tribunal-v2/pass-bar.test.ts`, add v9 cases: Vibe composite = floor(sum of 4 dims / 4); Vibe pass bar over 4 dims (no `clarity`).
- [ ] 1.2 In `tests/tribunal-v2/pass-bar.test.ts`, add v9 cases: Fresh Eyes composite = floor(sum of 5 dims / 5); pass bar requires composite≥8 AND payoffDensity≥8 AND lengthFit≥8 AND clarity≥8; clarity=7 fails despite high composite.
- [ ] 1.3 In `tests/tribunal-v2/pass-bar.test.ts`, add regression cases: v8 posts keep legacy Vibe(5)/FreshEyes(4) math and bars unchanged.
- [ ] 1.4 In `tests/content-gates.test.ts`, add floor-gate cases: v9 post needs 4 vibe dims + composite≥3 (no clarity required); v8 post still needs 5; missing a required dim blocks commit; legacy v8 post with `scores.vibe.clarity` still validates.
- [ ] 1.5 In `tests/tribunal-v2/pipeline.test.ts`, update the `vibe()` / fresh-eyes factories so v9 fixtures carry clarity under fresheyes; confirm tests fail against current code.

## 2. Core logic (version-aware resolver)

- [ ] 2.1 `src/lib/tribunal-v2/pass-bar.ts`: replace constant `VIBE_DIMS` / fresh-eyes dim set with version-aware resolvers (`vibeDims(version)`, `freshEyesDims(version)`); v≥9 → new sets, else legacy.
- [ ] 2.2 `src/lib/tribunal-v2/pass-bar.ts`: route composite math and both pass bars through the resolver; add the non-compensating `clarity≥8` gate for v≥9 Fresh Eyes.
- [ ] 2.3 `src/lib/tribunal-v2/types.ts`: add `clarity` to `FreshEyesJudgeOutput.scores`; keep `clarity` on `VibeJudgeOutput.scores` optional (legacy).
- [ ] 2.4 `src/content/config.ts`: add optional `scores.freshEyes.clarity`; keep optional `scores.vibe.clarity` (additive, non-destructive).
- [ ] 2.5 `scripts/score-floor-check.mjs`: make the required vibe dimension set + composite divisor version-aware (4 dims for v≥9, 5 for v≤8); composite≥3 unchanged.
- [ ] 2.6 Run unit tests from group 1 until green.

## 3. Scoring SSOT + judge agents

- [ ] 3.1 `scripts/vibe-scoring-standard.md`: move the `clarity` rubric/definition from the Vibe section to the Fresh Eyes section; restate Vibe as 4 dims and Fresh Eyes as 5 dims; recalibrate examples; note version gating.
- [ ] 3.2 `.claude/agents/vibe-opus-scorer.md`: remove `clarity` from rubric + output JSON; reflect 4-dim composite + pass bar.
- [ ] 3.3 `.claude/agents/fresh-eyes.md`: add `clarity` as 5th dimension with the moved rubric + non-compensating gate; update output JSON.
- [ ] 3.4 `.codex/agents/fresh-eyes.toml`: mirror the fresh-eyes.md agent changes.

## 4. Stamping + tooling + UI

- [ ] 4.1 Bump the version the scorer/publisher stamps on new runs to `tribunalVersion: 9` (locate the writer of `tribunalVersion`; confirm `validate-posts.mjs` ≥-branch still holds).
- [ ] 4.2 `scripts/frontmatter-scores.mjs`: for v9 runs write `clarity` under `freshEyes`; reading stays backward-compatible for v8 `scores.vibe.clarity`.
- [ ] 4.3 `src/components/AiJudgeScore.astro`: render `clarity` under the Fresh Eyes panel for v9 posts and under Vibe for legacy posts (version-aware display).

## 5. Docs (atomic, same PR)

- [ ] 5.1 `CLAUDE.md`: update tribunal dimension references (Vibe 4 / Fresh Eyes 5) and note version-gating.
- [ ] 5.2 `playbooks/mac-CC-playbook.md` and `playbooks/CCC-playbook.md`: update any vibe/fresh-eyes dimension lists + pass bars.

## 6. Verify + ship

- [ ] 6.1 `pnpm exec vitest run` + `node scripts/validate-posts.mjs` green; spot-check a real v8 post still validates and renders unchanged.
- [ ] 6.2 `openspec validate move-clarity-vibe-to-fresheyes --strict` passes.
- [ ] 6.3 Open PR, let CI run, self-merge per CCC playbook once green.
