## Why

A translated reflection essay (CP-314) makes no verifiable claims, so the Fact Checker's `accuracy` dimension has nothing to check and the judge improvises an ad-hoc score. The maintainer asked whether fact-check could be skipped for such mind-set posts.

Three principal-level reviews (value / design-space / failure-mode) converged on **do not build it**: cosmetic and rare (CP-314 scored all 9s and shipped; claim-free reflections are ~2–5% of the corpus), and any conditional-verification mechanism trades a *harmless* inconsistency for a *harmful* one — a hybrid reflection+facts post (gu-log's modal shape) misclassified as claim-free ships an unverified false claim, and the rewrite loop learns that de-claiming is the cheapest way past the accuracy gate. Full reasoning + revisit criteria: `design.md`.

This change **records that decision** so it is not re-litigated: it codifies "fact-check verification is unconditional" as a living requirement. A future proposal to skip fact-check on mind-set posts will conflict with it and surface this record.

## What Changes

- **Add a living capability `tribunal-verification-scope`** with one requirement: the Fact Checker stage and its `accuracy` dimension run for every post regardless of claim density; no flag / frontmatter field / judge classification may skip verification or exempt accuracy for a post class. This ratifies the status quo — no runtime behavior changes.
- **Preserve the rejected alternative + reasoning in `design.md`** (the trigger, the three-reviewer synthesis, the two broken arguments in the original proposal, the harmless→harmful trade, the de-claiming incentive, and the revisit criteria).
- **Add a one-line pointer** in `.claude/agents/fact-checker.md` near the `accuracy` dimension so an editor tempted to add a skip there sees the decision and the archive path.
- **No code, no rubric mechanism, no composite math change, no new flag or frontmatter field.**

## Capabilities

### New Capabilities
- `tribunal-verification-scope`: Fact-check verification is unconditional across post types; claim density never gates whether the Fact Checker runs or whether `accuracy` is earned. Serves as the tripwire a future conditional-verification proposal must delta.

## Impact

- **Spec:** new `openspec/specs/tribunal-verification-scope/` (synced on archive).
- **Decision record:** `openspec/changes/archive/2026-07-16-reject-claim-free-factcheck-fastpath/design.md`.
- **Pointer only:** one comment line in `.claude/agents/fact-checker.md` (no behavior change).
- **Non-goals:** does not change any Fact Checker scoring behavior, does not touch the accuracy rubric mechanics, does not add or remove any dimension. The claim-free accuracy improvisation remains as an accepted, harmless quirk.
