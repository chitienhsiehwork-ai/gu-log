## Context

The tribunal v2 scoring logic hard-codes dimension sets per judge: `VIBE_DIMS` (5) and the Fresh Eyes dim set (4) live in `src/lib/tribunal-v2/pass-bar.ts`, mirrored in `src/lib/tribunal-v2/types.ts`, the Zod schema in `src/content/config.ts`, the pre-commit floor gate `scripts/score-floor-check.mjs`, and the human-readable SSOT `scripts/vibe-scoring-standard.md`. Composites are floored means of those fixed sets; pass bars reference specific dimension names. `tribunalVersion` already exists in frontmatter and progress ledgers and is currently at `8`.

`clarity` (pronoun / voice attribution) currently sits in Vibe, where it tends to score high and inflate the vibe composite without the post earning its persona/clawdNote/vibe/narrative. The change relocates clarity to the Fresh Eyes (stranger-reader) judge and hardens it.

## Goals / Non-Goals

**Goals:**
- Move `clarity` from Vibe (5→4 dims) to Fresh Eyes (4→5 dims) for new scoring runs.
- Make `clarity` a non-compensating hard gate in Fresh Eyes.
- Keep all existing posts valid and unchanged via `tribunalVersion` gating.
- Keep the change test-first (TDD): pass-bar / composite / floor-gate behavior pinned by tests before logic changes.

**Non-Goals:**
- No migration script; no edits to existing post frontmatter; no re-scoring of `tribunalVersion <= 8` posts.
- No change to Librarian or Fact Checker judges.
- No change to the homepage publish bar (overall composite ≥ 8) itself — only the inputs that feed Vibe/FreshEyes composites change, and only for v9+ posts.
- No change to the meaning of `clarity` (stays pronoun / voice attribution).

## Decisions

**D1. Gate on `tribunalVersion`, single source of dimension ownership.**
Introduce a version-aware resolver (e.g. `vibeDims(version)` / `freshEyesDims(version)` in `pass-bar.ts`) returning the owned dimension list: `version >= 9` → new sets; else legacy sets. Composite, pass-bar, and floor-gate all consume this resolver instead of a module-level constant. *Alternative considered:* a one-time migration moving `clarity` into `freshEyes` across all posts and dropping the version branch — rejected (user decision): touches the whole corpus, forces re-validation, and discards the historical record of how old posts were scored. Version-gating is cheaper and preserves history.

**D2. New version number = 9.** The canonical current version is `scripts/frontmatter-scores.mjs:41` `CURRENT_TRIBUNAL_VERSION = 8` (the value stamped into frontmatter). The shell ledger writers `scripts/tribunal.sh:47` and `scripts/tribunal-quota-loop.sh:41` define `TRIBUNAL_VERSION=8` in parallel, and `validate-posts.mjs:370` branches on `>= 8`. **All of these stamp/branch sites move to 9 together** or the ledger and frontmatter versions diverge. (Correction: no test asserts the stamped version is 8 — the earlier "tests pin 8" claim was a misread of an article-count assertion in `series-content.test.ts`.)

**D3. Schema keeps both shapes (additive, not destructive).** `src/content/config.ts` keeps `scores.vibe.clarity` as an optional field (so v8 posts validate) and adds `scores.freshEyes.clarity` as optional. No field is removed. Validation does not force clarity into either judge; the version-aware logic decides which one is authoritative.

**D4. Non-compensating clarity gate mirrors existing pattern.** Fresh Eyes already enforces non-compensating gates on `payoffDensity` and `lengthFit`; `clarity` joins that list for v9+. Implementation reuses the existing per-dimension floor check.

**D5. Human-signal routing follows ownership.** `tribunal-human-signal-loop` routing for `confusing` / `context_missing` moves clarity to FreshEyes; Vibe's boring-feedback dimension hint drops clarity. This keeps feedback flowing to the judge that now owns the dimension.

## Risks / Trade-offs

- **Composite rounding shifts (5→4 / 4→5 divisor).** A given raw set of dimension scores can produce a different floored composite under v9. → Mitigation: this only affects v9+ posts (none exist yet); pin the new math with tests before changing logic; legacy posts keep the v8 divisor.
- **The dimension sets are DUPLICATED across gate scripts, not centralized.** `VIBE_DIMS` in `pass-bar.ts` is module-local (zero importers), but the same lists are independently hard-coded in `scripts/validate-posts.mjs` (Rule 15, both the vibe and SD branches), `scripts/score-helpers.sh`, `scripts/validate-judge-output.sh`, `scripts/frontmatter-scores.mjs`, and `src/lib/tribunal-v2/git-format.ts`. A grep-for-importers misses all of them. → Mitigation: every copy must be made version-aware in this change. In particular `validate-posts.mjs` Rule 15 currently *requires* `clarity` under `vibe` for `tribunalVersion >= 8`, so it will REJECT every correctly-stamped v9 post — a hard blocker, not an edge case. Centralizing the lists into one source is explicitly out of scope (future cleanup) to avoid a refactor mid-change.
- **The pipeline has no `tribunalVersion` in scope.** `src/lib/tribunal-v2/pipeline.ts` does not currently reference a version; `verifyFreshEyesPassBar` (pipeline.ts:198-212) re-implements the fresh-eyes bar inline (a parallel copy of `checkFreshEyesPassBar`). → Mitigation: plumb the post's `tribunalVersion` into the pipeline first, then thread it into both the resolver-based pass-bar functions AND the inline `verifyFreshEyesPassBar` copy so the clarity gate is applied in both places.
- **Frontmatter tooling writes clarity to the wrong judge.** `scripts/frontmatter-scores.mjs` must write clarity under `freshEyes` for v9 runs. → Mitigation: cover with a write/read test.
- **Docs drift.** CLAUDE.md / playbooks state "5 dimensions". → Mitigation: update them in the same change (atomic commits).

## Migration Plan

No data migration. Deploy is code-only; v9 logic activates for posts stamped `tribunalVersion: 9` by the next scoring run. Rollback = revert the change; v8 posts are unaffected because they never used the new branch.

## Open Questions

None — the three design forks (backcompat = version-bump grandfather; clarity definition = keep as independent voice-attribution dim coexisting with readability; clarity gate = non-compensating hard gate) were resolved with the owner before this proposal.
