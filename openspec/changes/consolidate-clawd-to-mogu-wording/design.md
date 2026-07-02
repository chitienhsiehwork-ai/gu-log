## Context

`Mogu` is the intended canonical name of the gu-log commentary persona. The component (`MoguNote.astro`), the glossary (`Mogu` entry, `/glossary#mogu`), and the CP series label (`Mogu Picks` in `article-counter.json`) are already on the new name. But the **authoring inputs** — the writer-prompt SSOT, `CONTRIBUTING.md`, `CLAUDE.md`, all 5 tribunal judge agents (and their `.codex` mirrors), and even the pre-commit hook's error text — still mandate "Clawd", so every new post keeps reintroducing the old name. The corpus reflects this: 1082 / 1083 posts use `ClawdNote`; only 2 use `MoguNote`; ~190 name "Clawd" in prose; 158 carry the `clawdNote` score key.

The migration is therefore not just half-applied — it is **actively re-seeded** by the SSOT every time content is authored, and it is **reader-visible** (SD-26 renders both names on one page). And it is **blocked**: four content-gating files hardcode `ClawdNote` with zero `MoguNote` awareness, so naively flipping imports breaks the pronoun and redundant-prefix gates.

This proposal does not implement the rename. It pins the target contract (`specs/persona-naming/spec.md`), records the open decisions with recommendations, and phases the work so the cheap, reversible SSOT/tooling edits land before any risky corpus migration.

## Goals / Non-Goals

**Goals:**
- One canonical reader-facing persona name (`Mogu`), agreed across component, glossary, SSOT prompts, and tooling.
- Stop new content from re-seeding "Clawd".
- Make the tooling `MoguNote`-aware so migration is even *possible* without breaking gates.
- Resolve the reader-visible SD-26 inconsistency.
- Keep all 1082 legacy posts rendering without a forced rewrite.

**Non-Goals:**
- No `scores.vibe.clawdNote` → `moguNote` schema migration (separate, heavy change).
- No rename of the OpenClaw / clawd-vm automation agent or the `clawd-picks-*` files.
- No forced mass rewrite of grandfathered posts.
- No implementation in this change — artifacts only.

## Open Decisions (options + recommendation)

**D1 — Scope boundary: persona only, or also the OpenClaw agent + `clawd-picks` pipeline?**
- *Option A (recommended):* Rename the **commentary persona only**. Leave the OpenClaw / clawd-vm agent identity and the `clawd-picks-prompt.md` / `clawd-picks-config.json` filenames as "Clawd".
- *Option B:* Also rename the VM agent and pipeline files.
- **Recommendation: A.** The existing `secure-clawd-vm-github-operator` OpenSpec change already treats "Clawd" as a *distinct VM automation agent* (alongside Iris) with its own GitHub-operator security contract. Conflating the reader-facing persona with that operator identity would entangle a cosmetic content rename with a security-scoped agent identity and a live pipeline's filenames. Renaming `clawd-picks-*` files also touches `~/clawd/AGENTS.md` and VM cron wiring outside this repo. Keep the blast radius on reader-facing content; note that the *user-facing* CP label is already "Mogu Picks", so the reader never sees "Clawd Picks" anyway.

**D2 — Component: permanent `ClawdNote` alias, or migrate all imports to `MoguNote`?**
- *Option A:* Keep `ClawdNote` as a permanent alias forever.
- *Option B (recommended):* Keep the alias **through grandfathering**, migrate new content to `MoguNote`, and offer an opt-in codemod — but only after Phase 0 teaches the 4 gating files about `MoguNote`.
- **Recommendation: B.** A permanent alias leaves a second name living in 1082 import lines indefinitely and keeps the door open for mixed-prefix pages like SD-26. Migrating everything in one shot is risky (it breaks the pronoun/redundant-prefix gates until tooling is updated, and rewrites reader prose at scale). Phase 0 (teach tooling) → Phase 1 (SSOT) → opt-in codemod is the safe ordering. The alias stays until the codemod has drained the corpus, then it can be removed in a later change.

**D3 — `scores.vibe.clawdNote` key: rename to `moguNote`, or keep as a stable internal name?**
- *Option A:* Rename the key to `moguNote`.
- *Option B (recommended):* Keep `clawdNote` as a stable internal identifier.
- **Recommendation: B.** The key is not reader-facing (it appears in frontmatter score blocks, not rendered prose). Renaming it touches `src/content/config.ts` (Zod, two blocks), `score-floor-check.mjs`, `validate-posts.mjs`, `src/lib/tribunal-v2/{pass-bar,types,git-format,pipeline}.ts`, `frontmatter-scores.mjs`, `vibe-scoring-standard.md`, the judge agents, **and 158 post frontmatters** — a full schema migration with its own version-gating story (mirroring how `move-clarity-vibe-to-fresheyes` had to thread `tribunalVersion` through every duplicated dimension list). That belongs in its own change. Decoupling it keeps the persona rename a content/SSOT change, not a schema migration.

**D4 — Existing ~1082 posts: codemod now, or grandfather?**
- *Option A:* Mass codemod prose "Clawd"→"Mogu" + `ClawdNote`→`MoguNote` across the corpus now.
- *Option B (recommended):* Grandfather old posts; enforce "Mogu" for new content; provide an opt-in codemod runnable in batches after Phase 0.
- **Recommendation: B.** A 1082-file rewrite of reader prose is high-risk (changes article voice, triggers re-validation, balloons one PR) and unnecessary for the reader-facing goal once new content is correct. Grandfathering matches the repo's existing pattern (posts without scores are grandfathered; the floor gate only fires on reader-visible edits). The opt-in codemod lets the corpus drain gradually, with the SD-26 mixed-prefix pages fixed first as a small, high-value batch.

**D5 — SSOT prompt edits (writer prompt / CLAUDE.md / CONTRIBUTING / agents): the actual wording.**
- This is the Phase 1 content of the rename. The load-bearing edit is `GU-LOG_WRITER_PROMPT.md:147` 「品牌：統一叫 "Clawd"」 → 「品牌：統一叫 "Mogu"」, plus the `<ClawdNote>` usage examples pointing at `MoguNote`, the judge-agent rubric persona mentions, and the pre-commit hook's "Use specific names (ShroomDog, Clawd, …)" string. The `clawdNote` *dimension key* inside agent rubrics stays (D3).

## Phasing

The phases are ordered so each one is independently shippable and the risky corpus work comes last, behind the tooling fix.

- **Phase 0 — Teach tooling about `MoguNote` (additive, reversible).** Update `check-pronoun-clarity.mjs`, `check-jingjing.mjs`, `tests/content-integrity.spec.ts`, `tests/content-gates.test.ts` (and `obsidian-import.mjs`'s callout map) to recognize `MoguNote` alongside `ClawdNote`. No content changes; both component names pass every gate afterward. **This unblocks Phases 2–3.**
- **Phase 1 — Flip the SSOT prose to "Mogu" (D5).** Writer prompt, `CONTRIBUTING.md`, `CLAUDE.md`, 5 judge agents + `.codex` mirrors, pre-commit error strings. New content is now authored as Mogu. Keep the `clawdNote` dimension key.
- **Phase 2 — Fix the reader-visible inconsistencies first.** Migrate the SD-26 zh/en pair (and any other mixed-prefix pages) to all-`MoguNote` + Mogu prose; repoint `/glossary#clawd` links to `/glossary#mogu`. Small, high-value batch — runs only after Phase 0.
- **Phase 3 (optional, opt-in) — Drain the corpus.** Codemod legacy posts `ClawdNote`→`MoguNote` + prose "Clawd"→"Mogu" in reviewable batches. Once drained, a later change may remove the `ClawdNote.astro` alias.

## Risks / Trade-offs

- **Re-seeding loop.** Until Phase 1 lands, every new post the pipeline writes reintroduces "Clawd" (the writer prompt mandates it). → Phase 1 should follow Phase 0 quickly; the two are small.
- **Pronoun-gate breakage if order is violated.** Migrating a post to `<MoguNote>` before Phase 0 makes `check-pronoun-clarity.mjs` flag every 你/我 inside the note (it only masks `<ClawdNote>`). → The spec encodes the ordering constraint as a hard requirement.
- **Dangling `/glossary#clawd` links.** ~190 posts link to an anchor that does not exist (no `Clawd` glossary entry). → Phase 2 repoints them; the glossary-link-coverage gate already enforces that linked terms resolve.
- **Two-name window.** During Phases 0–3 the corpus legitimately mixes both names. → Acceptable for grandfathered pages; only *single-page* mixing (SD-26) is a defect, and it is fixed first in Phase 2.
- **Schema-key temptation.** Someone may try to "finish the job" by also renaming `scores.vibe.clawdNote`. → D3 and the spec explicitly fence it off as a separate migration.

## Migration Plan

No data migration in this change (proposal only). When implemented: Phase 0 and Phase 1 are code/doc edits with trivial rollback (revert). Phase 2 touches a handful of posts. Phase 3 is opt-in and batchable, so rollback is per-batch. The `ClawdNote.astro` alias guarantees no post breaks at any point; alias removal is deferred to a future change after the corpus is drained.

## Open Questions

- Final removal of the `ClawdNote.astro` alias (after Phase 3) — out of scope here; decide once the corpus is drained.
- Whether the `scores.vibe.clawdNote` → `moguNote` schema migration is ever worth doing (D3 defers, does not forbid).
