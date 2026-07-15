## 1. Fact Checker rubric — claim-scope classification + accuracy fast-path (P0, behavior SSOT)

- [ ] 1.1 In `.claude/agents/fact-checker.md`, add a "claim-scope classification" step: judge reads the full post and labels it claim-bearing / claim-free (definition + the borderline "one embedded claim stays claim-bearing" rule from design.md). State explicitly the classification is the judge's, not read from any flag.
- [ ] 1.2 In the same file, add the claim-free branch to the `accuracy` dimension: reflects source-argument faithfulness only, not penalized for un-verifiability, not padded with N/A, one-line report basis. Keep misattribution/garbled-argument as a real accuracy fault (no auto-10).
- [ ] 1.3 State the always-on invariant near the top of the agent spec: fidelity / sourceBoundary / commentarySeparation are scored for every post; the Fact Checker stage is never skipped; no `--skip-factcheck` flag exists.
- [ ] 1.4 Mirror 1.1–1.3 into the Codex twin `.codex/agents/fact-checker.toml` if it exists, so VM runs behave identically (skip if no twin present; note in PR).

## 2. Scoring standard mirror (P0)

- [ ] 2.1 In `scripts/vibe-scoring-standard.md`, add the claim-free row/note to the accuracy table (mirrors 1.2).
- [ ] 2.2 Add a one-line Fact-core composite note: a claim-free accuracy score feeds `floor(avg(accuracy, fidelity, consistency))` as a normal value, never dropped as N/A (mirrors the `tribunal-scoring-dimensions` delta).

## 3. Playbook derived line (P1)

- [ ] 3.1 In `playbooks/CCC-playbook.md`〈Tribunal 必跑規則〉add one line: claim-free 文章不是少跑一審 — Fact Checker 照跑，只有 accuracy 走 fast-path；judge 判 claim scope，不是 orchestrator 跳過 stage.

## 4. Verification (P0 — how we prove it works)

- [ ] 4.1 Re-run the Fact Checker (score-only) on CP-314 (a known claim-free post) and confirm: classified claim-free, accuracy scored via fast-path with the one-line basis, fidelity/sourceBoundary/commentarySeparation still scored, stage ran to completion. (Tier-2: reviewer reads the judge report against the spec scenarios.)
- [ ] 4.2 Re-run the Fact Checker on a claim-bearing anchor (e.g. CP-153, a benchmark-heavy post) and confirm classification = claim-bearing and accuracy is verified as before (no regression on the path that already works).
- [ ] 4.3 Confirm no code path, flag, or frontmatter field was added that lets an orchestrator skip the stage (grep the diff for any `skip`/`scope` gate; there should be none outside prose rubric).

## 5. Archive (P0 — merge gate per openspec SDLC)

- [ ] 5.1 `/opsx:archive` this change; sync the `tribunal-verification-scope` capability into `openspec/specs/` and apply the `tribunal-scoring-dimensions` delta; commit in the same PR.
