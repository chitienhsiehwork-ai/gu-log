# Design — reject-claim-free-factcheck-fastpath (decision record)

> **This is a decision record, not a build.** It exists so the analysis below is
> not re-run from scratch the next time someone proposes skipping fact-check on
> mind-set posts. The living requirement in `tribunal-verification-scope` is the
> tripwire; this file is what the tripwire points at.

## The trigger

CP-314〈夢想變成工作之後〉is a translated reflection essay (Ryo Lu on craft and
motivation). It makes **zero verifiable technical/numeric claims**. The Fact
Checker's `accuracy` dimension is written for posts that carry claims, so on
CP-314 the judge improvised: `accuracy: 9` with an ad-hoc "-1 for inability to
verify" note. The maintainer's instinct: running a fact-checker on a post with
no facts to check feels silly — can we skip it for this kind of post?

## What was proposed (and is being rejected)

A `conditional-fact-verification` change: keep the Fact Checker stage running,
but give the `accuracy` dimension a **claim-free fast-path** — when the judge
classifies a post as claim-free, accuracy is scored on source-argument
faithfulness only and is *not penalized* for un-verifiability. Classification
was to live inside the judge's zero-context run (not an orchestrator flag), and
the proposal explicitly rejected two cruder variants: orchestrator-side stage
skip (option A) and a frontmatter `claim-free` flag.

## Why we did NOT do it

Three independent principal-level reviews (value / design-space / failure-mode)
converged on: **do not build this.** The reasons, strongest last:

### 1. It is over-process for a cosmetic, rare, currently-harmless issue
- CP-314 scored **all 9s and shipped to the homepage.** The improvisation never
  changed a ship / no-ship / homepage outcome. There is zero record of it
  blocking anything. It is a maintainer-facing annoyance, not a QA gap.
- Claim-free reflection translations are ~**2–5%** of the corpus (sampling
  `src/content/posts/`; most "reflection" posts still carry embedded claims).
  CP-314 is a rare edge, not a category.
- The entire behavioral payload was a few lines of prose rubric. Wrapping it in
  a new openspec capability + a `tribunal-scoring-dimensions` composite delta +
  the nine-stage archive gate is process tax a solo, velocity-over-stability
  repo should not pay for a 2% cosmetic case.

### 2. Two of the original proposal's arguments were wrong (verified against code)
- **"frontmatter routing = `--no-verify` slippery slope" is false.** The repo
  already does code-authoritative type routing: `src/lib/tribunal-v2/pass-bar.ts`
  moves `clarity` ownership from Vibe to Fresh Eyes by `tribunalVersion`, and
  `ticketId` prefix (SP/CP/SD/Lv) already drives rendering. A mutable
  orchestrator-written *skip signal* is dangerous; an intrinsic, code-authoritative
  *type discriminant* is not. The proposal conflated the two.
- **The rejection of "drop claim-free accuracy from the gate" was arithmetically
  backwards.** Fact-core gate = `floor(avg(accuracy, fidelity, consistency))`.
  Dropping accuracy → `floor(avg(fidelity, consistency))`. Worked example: a weak
  fidelity 6 with two 9s → 3-dim `floor(24/3)=8` PASS, but 2-dim `floor(15/2)=7`
  FAIL. Dropping accuracy makes the gate **stricter on fidelity** — which is what
  the proposal itself said it wanted ("fidelity matters most on reflection
  posts"). Keeping accuracy in the average **dilutes** the dimension it claimed to
  protect.

### 3. It trades a harmless inconsistency for a harmful one (the decisive reason)
- The inconsistency being "fixed" is **harmless**: a claim-free post getting
  accuracy 8 vs 9 changes nothing (both clear the floor) and there is no false
  fact to ship (there are no claims).
- Any fast-path/skip introduces a **harmful** failure mode. gu-log's *modal*
  article is a **hybrid**: a reflective translated body **plus** MoguNotes that
  assert real facts (a model can do X, a company shipped Y, cost Z). A biased
  judge (the feedback corpus records machine scores running ~+2 wide,
  2026-06-23) that pattern-matches "reflective tone → claim-free" will skip
  verifying the one embedded claim that *was* checkable — and ship it wrong.
  Classification **is** the verification act ("claim-free" means "I decided not
  to look"), so the "embedded claims still get checked" carve-out is circular.
- **The rewrite loop becomes aligned against quality.** When accuracy blocks the
  gate, the cheapest rewrite is not "verify and fix the claim" — it is "soften
  the claim into hedged opinion so the post reads as claim-free," which clears
  the gate. That systematically strips the concrete benchmarks / numbers /
  versions ShroomDog has repeatedly asked for (feedback corpus, SP-243 etc.).
  The gate would reward de-claiming.

## Decision

**Keep fact-check verification unconditional.** Accept the harmless cosmetic
inconsistency (a claim-free post's accuracy is scored on source-argument
faithfulness by the judge's normal judgment; an occasional ad-hoc note is fine).
Do **not** add a claim-scope classification, an accuracy fast-path, a skip flag,
or a composite change. Encode the decision as a living requirement so the next
proposal to make verification conditional collides with it and reaches this file.

## What would change our mind (revisit criteria)

Revisit only if **all** of these hold — otherwise the trade stays net-negative:
1. Claim-free / pure-reflection posts become a large share of output (say >20%),
   not a 2% edge.
2. The accuracy improvisation starts **actually blocking** good posts at the gate
   (a real floor/PASS failure), not just reading as untidy.
3. A guard-railed design is shown — by red-team fixture, not assertion — to not
   create the de-claiming incentive: a hard "when in doubt, claim-bearing" rule
   (claim-free must be affirmatively earned, never the borderline default), a
   boundary **hybrid** calibration anchor (not just a pure-reflection one like
   CP-314), and a known-false-hybrid fixture proving the fast-path does not pass
   it.

Absent all three, unconditional verification wins.
