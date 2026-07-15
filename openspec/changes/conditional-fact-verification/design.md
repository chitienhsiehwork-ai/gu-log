# Design — conditional-fact-verification

## The one decision this change turns on: who holds skip authority

The maintainer's ask was "skip a review like Fact Checker when we don't need it." There are two ways to build that, and they are not equally safe:

| | A. Orchestrator-side skip (rejected) | B. Judge-side fast-path (**this design**) |
|---|---|---|
| Who decides "not needed" | The orchestrating agent, before the stage runs | The Fact Checker, from inside its zero-context run, having read the whole post |
| What gets skipped | The entire Fact Checker stage | Only the *verification work* behind the `accuracy` dimension |
| fidelity / sourceBoundary / commentarySeparation | Also skipped (they live in the same stage) | Always run |
| Failure mode | "we don't need it" decays into "the agent had a deadline" → a claim-bearing post ships unverified; identical shape to `--no-verify`, which the repo bans | Judge misclassifies a claim-bearing post as claim-free — bounded, and the judge is the actor already trained to read for claims |
| Reader/maintainer benefit (no improvised N/A) | Yes | Yes |

Both options remove the maintainer's felt problem (the pipeline improvising an accuracy score on a claim-free post). Only B keeps the three always-on checks and keeps the decision with an actor that has no incentive to cut corners. B is the design. The maintainer green-lit B.

## Why the classification cannot be a frontmatter flag

A tempting shortcut is a `factCheck.scope: claim-free` frontmatter field an outer agent sets, which the judge then trusts. Rejected: that reintroduces option A through the back door — the outer agent becomes the decider, and a wrong/stale flag silently disables verification on a post that needed it. The classification is **transient state inside one judge run**: the judge reads the post, decides, scores, and its report explains the decision. Nothing an orchestrator writes gates it. (Consistent with the repo's "code/frontmatter is authority, but a *skip signal* an agent writes is not a safe gate" posture.)

## What "claim-free" means (the judge's test)

A post is **claim-free** when it makes no decision-critical claim a reader could act on being wrong: no version numbers, benchmark figures, model/architecture assertions, dates-as-facts, quantities, or "X does Y" technical statements. Pure opinion, lived reflection, motivation, and mental-model prose qualify. Borderline: a reflection post that name-drops one real product capability ("the model can refactor code") is **claim-bearing for that clause** — the judge verifies the clause and treats the rest as claim-free. The fast-path is per-post accuracy scoring, not a licence to ignore an embedded factual claim.

## Accuracy scoring on a claim-free post

- Score `accuracy` at the **top of the band the post earns on faithfulness-adjacent grounds** — i.e. if there is nothing to get wrong and nothing is gotten wrong, accuracy is not dragged down by "couldn't verify" (there was nothing to verify). It is **not** auto-10: a claim-free post can still misattribute a quote or garble the source's argument, which is an accuracy-adjacent fault the judge still catches.
- The report line is one sentence: "No verifiable technical/numeric claims; accuracy reflects source-argument faithfulness only." No fabricated deduction, no N/A checklist.

## Fact-core composite interaction (why `tribunal-scoring-dimensions` is touched)

Fact-core composite = `floor(avg(accuracy, fidelity, consistency))`, pass bar ≥ 8. If a claim-free post scores accuracy honestly high (nothing wrong) the composite is unaffected. The delta's job is to make explicit that a claim-free accuracy score is a *real* score feeding the composite normally — **not** an N/A that gets dropped from the average (dropping it would let one weak fidelity score swing the composite harder). This keeps the pass bar meaning identical for both post types.

## SOP surface

- **Behavior SSOT:** `.claude/agents/fact-checker.md` (+ `.codex/agents/fact-checker.toml` twin) — the classification instruction and the claim-free accuracy branch live here; every runtime reads the agent spec.
- **Scoring standard:** `scripts/vibe-scoring-standard.md` — the accuracy table and Fact-core note mirror the rubric.
- **Playbook:** one derived line in `playbooks/CCC-playbook.md`〈Tribunal 必跑規則〉 clarifying "claim-free ≠ 少跑一審".
- No code path branches on classification; no flag; no stage-skip. The change is entirely in the judge's rubric + the specs that describe it.
