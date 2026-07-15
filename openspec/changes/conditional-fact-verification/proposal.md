## Why

Some gu-log posts make **zero verifiable claims** — a translated mind-set / reflection essay (e.g. CP-314〈夢想變成工作之後〉, translating Ryo Lu on craft & motivation) has no version numbers, no benchmarks, no architecture claims, nothing a Fact Checker can check against a primary source. Today the Fact Checker still scores the **accuracy** dimension for these posts because the rubric assumes every post carries technical claims. The judge improvises: CP-314 got `accuracy: 9` with an ad-hoc "-1 for inability to verify" note. That improvisation is inconsistent (two claim-free posts can get different accuracy scores for the same reason) and reads, to the maintainer, as the pipeline running a check that doesn't apply.

The maintainer's instinct was to **skip the Fact Checker entirely** for such posts. That instinct is half-right and half-dangerous:

- **Right:** the *accuracy verification effort* genuinely has nothing to do on a claim-free post.
- **Dangerous:** the Fact Checker scores five dimensions, not one. `fidelity` (did the translation erase a hedge or add a claim?) and `commentarySeparation` (did a MoguNote's POV bleed into the body?) are **most** at risk exactly on high-MoguNote-density reflection posts — the kind that are claim-free. Skipping the whole judge to save the accuracy work throws away the two checks that matter most on that post type. Skipping a review because "we don't need it" is also one orchestrator-convenience judgment away from the `--no-verify` slippery slope the repo bans outright.

This change makes the *verification effort* conditional **without** making any always-on check skippable, and pins the "does this post need verification?" decision to the zero-context judge rather than the orchestrator.

## What Changes

- **Fact Checker classifies claim scope.** The Fact Checker SHALL, from reading the full post, classify it as **claim-bearing** or **claim-free** (no decision-critical technical / numeric / factual claims — pure opinion, reflection, or mental-model prose). This classification is the judge's, made inside the judge's zero-context run — never delegated to the orchestrator or to a frontmatter flag an outer agent sets.
- **Accuracy gets a documented claim-free fast-path.** On a claim-free post, `accuracy` is scored via an explicit rule (not improvised, not padded with N/A scaffolding, not penalized for un-verifiability), and the judge's report states "no verifiable claims" in one line instead of inventing a deduction.
- **The always-on checks never skip.** `fidelity`, `sourceBoundary`, and `commentarySeparation` apply to every post regardless of classification. The Fact Checker stage itself is never skipped.
- **SOP codified.** The rule lives in spec + the Fact Checker agent rubric + the scoring standard, so every runtime (CCC `Agent`, shell `tribunal.sh`, Codex on VM) applies it identically. No `--skip-factcheck` flag, no orchestrator-side stage skipping.

## Capabilities

### New Capabilities
- `tribunal-verification-scope`: When and how the Fact Checker's *verification effort* is conditional on a post's claim scope, while the judge's non-verification checks (fidelity, source boundary, commentary separation) stay unconditional — and why the claim-scope decision belongs to the judge, not the orchestrator.

### Modified Capabilities
- `tribunal-scoring-dimensions`: the accuracy dimension and the Fact-core composite (`floor(avg(accuracy, fidelity, consistency))`) must define their behavior on a claim-free post so a legitimately un-verifiable accuracy score neither drags the composite below the pass bar nor is inflated to hide a real fidelity problem.

## Impact

- **Spec:** new `openspec/specs/tribunal-verification-scope/`; delta to `openspec/specs/tribunal-scoring-dimensions/`.
- **Judge rubric (SSOT for the behavior):** `.claude/agents/fact-checker.md` (accuracy dimension gains the claim-free branch + the classification instruction) and its Codex twin `.codex/agents/fact-checker.toml` if present.
- **Scoring standard:** `scripts/vibe-scoring-standard.md` (accuracy table gains the claim-free row; Fact-core composite note).
- **Playbook (derived view):** `playbooks/CCC-playbook.md`〈Tribunal 必跑規則〉 gains one line — "四審一個都不能跳；claim-free 文章不是少跑一審，是 Fact Checker 的 accuracy 走 fast-path"。
- **Non-goals:** no `--skip-factcheck` flag; no orchestrator-side stage skipping; no change to Vibe / Librarian / Fresh Eyes; no new frontmatter field (classification is transient inside the judge run, not persisted as a skip signal).
