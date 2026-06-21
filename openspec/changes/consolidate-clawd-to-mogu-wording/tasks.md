## 0. Phase 0 — Teach content-gating tooling about MoguNote (additive, must land first)

- [ ] 0.1 `scripts/check-pronoun-clarity.mjs`: recognize `<MoguNote>` / `</MoguNote>` regions for masking, alongside the existing `<ClawdNote>` handling, so 你/我 inside a MoguNote is not flagged.
- [ ] 0.2 `tests/content-gates.test.ts`: add `MoguNote` fixtures to the `buildMask` and "does NOT flag 你/我 inside the note" tests so the mask behavior is pinned for the new component too.
- [ ] 0.3 `scripts/check-jingjing.mjs`: add `MoguNote` to the component-name allowlist; refresh the stale `// ...ClawdNote is:` comment.
- [ ] 0.4 `tests/content-integrity.spec.ts`: extend the redundant-prefix gate to cover `<MoguNote>` (flag a redundant `Mogu：` immediately inside the block), keeping the existing `<ClawdNote>` cases.
- [ ] 0.5 `scripts/obsidian-import.mjs`: map the `mogu` / `mogunote` callout to `MoguNote` and emit the `MoguNote` import; keep `clawd`→`ClawdNote` for backward compat.
- [ ] 0.6 Verify: a post using `<MoguNote>` passes pronoun, jingjing, and content-integrity gates; a post using `<ClawdNote>` still passes unchanged.

## 1. Phase 1 — Flip SSOT prose to "Mogu" (after Phase 0)

- [ ] 1.1 `GU-LOG_WRITER_PROMPT.md`: change 「品牌：統一叫 "Clawd"」(:147) to "Mogu"; update the `<ClawdNote>` usage examples/imports to `MoguNote`; update persona prose mentions. Keep the `clawdNote` *score-dimension* references (D3).
- [ ] 1.2 `CONTRIBUTING.md`: rename the `ClawdNote — Clawd 吐槽/註解` section to MoguNote; point the import guidance at `MoguNote`.
- [ ] 1.3 `CLAUDE.md`: update reader-facing persona mentions and the architecture note for the note component; leave the OpenClaw / clawd-vm agent identity and `clawd-picks-*` references untouched (D1).
- [ ] 1.4 `.claude/agents/{fact-checker,vibe-opus-scorer,fresh-eyes,librarian,tribunal-writer}.md` AND `.codex/agents/*.toml`: change persona-name prose ("Clawd commentary", "you don't know Clawd", "link Clawd to /about") to Mogu; KEEP the `clawdNote` dimension key and its rubric.
- [ ] 1.5 `.githooks/pre-commit`: update reader-facing error strings ("Use specific names (ShroomDog, Clawd, 讀者)…", "你/我 found … outside ClawdNote/blockquote") to reference Mogu / MoguNote.
- [ ] 1.6 Verify: a freshly authored post follows the Mogu name end-to-end and passes all gates.

## 2. Phase 2 — Fix reader-visible inconsistencies first (after Phase 0)

- [ ] 2.1 `src/content/posts/sd-26-20260616-loop-engineering-at-gu-log.mdx` + `en-sd-26-…`: migrate the 4 `<ClawdNote>` blocks to `<MoguNote>` (single import), so the page renders one persona name. Re-score is only required if reader-visible content changes beyond the component swap.
- [ ] 2.2 Repoint any `/glossary#clawd` (and `/en/glossary#clawd`) prose links in those posts to `/glossary#mogu`.
- [ ] 2.3 Sweep for any other single-page mixed-prefix posts (both `<MoguNote>` and `<ClawdNote>` in one file) and fix them in this batch.
- [ ] 2.4 Verify: SD-26 zh/en render only "Mogu …" prefixes; glossary-link-coverage gate passes.

## 3. Phase 3 — Optional opt-in corpus drain (after Phases 0–1)

- [ ] 3.1 Provide an opt-in codemod that, per batch of legacy posts, swaps `ClawdNote`→`MoguNote` imports/tags and prose "Clawd"→"Mogu", repointing `/glossary#clawd`→`/glossary#mogu`.
- [ ] 3.2 Run it in reviewable batches; respect the floor/score gate on any post whose reader-visible content changes.
- [ ] 3.3 Defer removal of the `src/components/ClawdNote.astro` alias to a future change, once the corpus is drained.

## 4. Explicitly deferred (NOT in this change)

- [ ] 4.1 `scores.vibe.clawdNote` → `moguNote` schema migration (separate change; touches Zod schema, 4 validators, tribunal v2 types, frontmatter tooling, agents, and ~158 post frontmatters — version-gated like `move-clarity-vibe-to-fresheyes`). — D3
- [ ] 4.2 Rename of the OpenClaw / clawd-vm automation agent and `clawd-picks-prompt.md` / `clawd-picks-config.json`. — D1

## 5. Validate the proposal

- [ ] 5.1 `openspec validate consolidate-clawd-to-mogu-wording --strict` passes.
