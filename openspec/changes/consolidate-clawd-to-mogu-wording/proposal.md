## Why

The gu-log commentary persona — the voice that speaks inside note boxes ("Clawd：又來了，每篇論文都說自己 SOTA…") — is being renamed **Clawd → Mogu**. The migration is **half done and inconsistent**, and the inconsistency is now reader-visible.

Verified state (counts taken at proposal time against `src/content/posts/`, `2026-06-21`):

- **Component layer is already migrated.** `src/components/MoguNote.astro` is the real component; it renders prefixes like `Mogu 碎碎念：` and links the `Mogu` token to `/glossary#mogu`. `src/components/ClawdNote.astro` is now a thin legacy alias that wraps `MoguNote` ("New content should import MoguNote directly").
- **The glossary already has a `Mogu` entry** (`src/data/glossary.json`, term `Mogu`, anchor `/glossary#mogu`). There is **no** `Clawd` glossary entry — yet ~190 posts link prose "Clawd" to `/glossary#clawd` (a dangling anchor) or `/about`.
- **Everything that drives NEW content still says "Clawd".** The writer-prompt SSOT explicitly mandates it (`GU-LOG_WRITER_PROMPT.md:147` 「品牌：統一叫 "Clawd"」), as do `CONTRIBUTING.md`, `CLAUDE.md`, all 5 tribunal judge agents (`.claude/agents/*.md` + their `.codex/agents/*.toml` mirrors), and the pre-commit hook's own error text.
- **The corpus is overwhelmingly "Clawd".** Of **1083** posts, **1082** still `import ClawdNote` / use `<ClawdNote>`; only **2** use `<MoguNote>`. **~190** posts name "Clawd" in prose. **158** carry the `scores.vibe.clawdNote` score key.
- **The reader-visible bug is concrete.** `src/content/posts/sd-26-20260616-loop-engineering-at-gu-log.mdx` (and its `en-` pair) render **4 "Clawd …" prefixes AND 1 "Mogu …" prefix in the same article**, while the frontmatter score key reads `clawdNote: 8`. A reader sees two names for one persona on one page.
- **The tooling cannot tell `MoguNote` apart from prose yet.** `scripts/check-pronoun-clarity.mjs`, `scripts/check-jingjing.mjs`, `tests/content-integrity.spec.ts`, and `tests/content-gates.test.ts` hardcode `ClawdNote`/`ShroomDogNote` and contain **zero** references to `MoguNote` (verified by grep). So flipping a post's import to `<MoguNote>` today *breaks the pronoun checker* (it stops masking the note body and flags every 你/我 inside) and the redundant-prefix integrity test. The tooling must learn `MoguNote` **before** any mass component migration.

This change is a **proposal only**: it defines the target contract, the open decisions with recommendations, and a phased plan. It does **not** edit prompts, components, posts, or tooling.

## What Changes

This proposal establishes the rename as an OpenSpec contract and **phases** it so the low-risk SSOT/tooling work lands before any risky mass content migration. Concretely the proposal commits to:

- **Define the scope boundary** (recommended: rename the gu-log *commentary persona* only; leave the OpenClaw / clawd-vm automation-agent identity and the `clawd-picks-*` pipeline filenames out of scope — see decision D1).
- **Phase 0 — Tooling learns `MoguNote` (additive, non-breaking).** Teach `check-pronoun-clarity.mjs`, `check-jingjing.mjs`, `tests/content-integrity.spec.ts`, and `tests/content-gates.test.ts` to recognize `MoguNote` *in addition to* `ClawdNote`. After Phase 0, a post may use either component and pass every gate. **This unblocks everything else.**
- **Phase 1 — SSOT prose says "Mogu".** Update the writer prompt, `CONTRIBUTING.md`, `CLAUDE.md`, the 5 judge agents + their `.codex` mirrors, and the pre-commit hook's reader-facing error strings so new content is authored as "Mogu". The component-import guidance points at `MoguNote`.
- **Phase 2 — New content is authored as Mogu; old posts grandfathered** (recommended D4). The legacy `ClawdNote` alias stays so the 1082 existing posts keep rendering; new posts import `MoguNote` and say "Mogu" in prose. An optional opt-in codemod is provided for migrating posts in batches, gated behind Phase 0.
- **Keep the `scores.vibe.clawdNote` schema key as a stable internal name** (recommended D3) — renaming it is a separate, heavy schema migration across 1000+ posts + 8 validators/agents and is explicitly out of scope here.

## Capabilities

### New Capabilities
- `persona-naming`: Defines the single canonical reader-facing name of the gu-log commentary persona (`Mogu`), the scope boundary that separates it from the OpenClaw automation-agent identity, the component/glossary/tooling/SSOT surfaces that must agree on that name, the rule that no single rendered page may show two names for the persona, and the phasing constraint that content-gating tooling must recognize `MoguNote` before any mass component migration. The schema key `scores.vibe.clawdNote` is explicitly declared a stable internal identifier exempt from this naming rule.

### Modified Capabilities
<!-- None. The four checkers/tests this change touches in Phase 0 are not currently
     governed by an OpenSpec capability spec (they are code with no spec contract),
     so their behavior change is captured as new requirements under persona-naming
     rather than as deltas to an existing capability. glossary-link-coverage is
     affected operationally (a Clawd→Mogu link target swap) but its requirements
     do not change. -->

## Impact

**SSOT prose (Phase 1 wording edits):**
- `GU-LOG_WRITER_PROMPT.md` (~27 hits; the canonical 「品牌：統一叫 "Clawd"」 directive at :147)
- `CONTRIBUTING.md` (~18 hits; the `ClawdNote — Clawd 吐槽/註解` component section)
- `CLAUDE.md` (~15 hits; persona references in style guide + architecture)
- `.claude/agents/{fact-checker,vibe-opus-scorer,fresh-eyes,librarian,tribunal-writer}.md` and the `.codex/agents/*.toml` mirrors (persona-name references in rubrics; the `clawdNote` *dimension key* stays — see D3)
- `.githooks/pre-commit` reader-facing error strings ("Use specific names (ShroomDog, Clawd, 讀者)…")

**Tooling that must learn `MoguNote` (Phase 0 — the blocking gap):**
- `scripts/check-pronoun-clarity.mjs` (masks `<ClawdNote>` regions so 你/我 inside aren't flagged; 0 `MoguNote` refs today)
- `scripts/check-jingjing.mjs` (component-name allowlist)
- `tests/content-integrity.spec.ts` (redundant-prefix gate, hardcoded `<ClawdNote>`)
- `tests/content-gates.test.ts` (pronoun-mask unit fixtures)
- `scripts/obsidian-import.mjs` (callout→component map; should map `mogu`→`MoguNote`)

**Glossary / links:**
- `src/data/glossary.json` already has `Mogu`; ~190 posts link "Clawd"→`/glossary#clawd` (dangling) or `/about`. Reconciling these link targets to `/glossary#mogu` is part of Phase 2 content work, gated behind Phase 0.

**Components (already migrated; alias retained):**
- `src/components/MoguNote.astro` (canonical), `src/components/ClawdNote.astro` (legacy alias — kept under D4)

**Schema key — explicitly OUT of scope for renaming (D3):**
- `scores.vibe.clawdNote` lives in `src/content/config.ts`, `scripts/score-floor-check.mjs`, `scripts/validate-posts.mjs`, `src/lib/tribunal-v2/{pass-bar,types,git-format,pipeline}.ts`, `scripts/frontmatter-scores.mjs`, `scripts/vibe-scoring-standard.md`, the judge agents, and **158** post frontmatters. Renaming it is a separate heavy migration; this change keeps it stable.

**Explicitly OUT of scope (D1):**
- The OpenClaw / clawd-vm "Clawd" automation-agent identity (`CLAUDE.md` 「Clawd (OpenClaw)」; the existing `secure-clawd-vm-github-operator` OpenSpec change treats Clawd as a distinct VM agent alongside Iris).
- The `scripts/clawd-picks-prompt.md` / `scripts/clawd-picks-config.json` pipeline filenames. (Note: the CP *series label* is already "Mogu Picks" in `scripts/article-counter.json`; the pipeline *files* keep their names.)

**Non-goals:**
- No edits to prompts/components/posts/tooling in *this* change — proposal artifacts only.
- No `scores.vibe.clawdNote` → `moguNote` schema rename.
- No rename of the OpenClaw VM agent or `clawd-picks-*` files.
- No forced mass rewrite of the 1082 grandfathered posts (codemod is opt-in).
