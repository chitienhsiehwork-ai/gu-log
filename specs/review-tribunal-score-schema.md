# Review: Tribunal Score Schema Spec

**Reviewer**: Reviewer (Opus)
**Date**: 2026-04-07
**Spec under review**: `specs/tribunal-score-schema.md`
**Parent spec**: `specs/tribunal-all-claude-migration.md`

---

## VERDICT: CONDITIONAL PASS (7 WARN, 3 FAIL)

Spec 整體方向正確、設計原則清楚。但有 3 個 FAIL 項目必須修才能進 implementation：schema drift 沒處理、缺失的 dependency 檔案、以及 acceptance criteria 不夠 testable。

---

## 1. Spec vs Parent Spec — Consistency Check

### [PASS] Model assignments match
- Spec: Librarian=Sonnet, FactCheck=Opus, FreshEyes=Haiku, Vibe=Opus
- Parent spec Section A: identical
- Evidence: spec lines 27/38/48/57 vs parent lines 55-58

### [PASS] Pass bars match
- Librarian: `score ≥ 8` (spec L35) vs parent Stage 1 `composite ≥ 8` (parent L32) -- OK
- Fact Check: `score ≥ 8` (spec L45) vs parent Stage 2 `score ≥ 8` (parent L36) -- OK
- Fresh Eyes: `score ≥ 8` (spec L55) vs parent Stage 3 `floor(avg) ≥ 8` (parent L40) -- OK
- Vibe: `score ≥ 8 AND one ≥ 9` (spec L65) vs parent Stage 4 `one ≥ 9 AND rest ≥ 8` (parent L44) -- OK

### [PASS] Dimension names match between spec sections
- Spec "4 Judges — Dimensions" section (L27-65) matches "Frontmatter Schema" example (L69-120) matches Zod schema (L122-174). All consistent.

### [PASS] Design principle: uniform 0-10, floor(avg)
- All 4 judges use 0-10 per dimension, composite = floor(avg). No exceptions. Confirmed in spec L19-23.

### [WARN] Vibe pass bar 表述不完全一致
- Spec L22-23: "composite ≥ 8（Vibe 額外條件：至少一個維度 ≥ 9 且其餘 ≥ 8）"
- Spec L65: "score ≥ 8 AND 至少一個維度 ≥ 9"
- Parent L44: "At least one dimension ≥ 9 AND rest ≥ 8"
- **Issue**: L65 只說 "one ≥ 9" 沒說 "rest ≥ 8"。雖然 composite ≥ 8 隱含了 rest 不能太低，但技術上 {10, 10, 6, 6} composite = 8 也能過。應該明確寫 "composite ≥ 8 AND at least one dim ≥ 9 AND no dim < 8"。
- **Impact**: Medium — 可能導致 edge case 通過不該通過的文章。

---

## 2. Schema & Validation Drift — CRITICAL FINDINGS

### [FAIL] `cl:` key 已存在於 8 篇文章但 Zod schema 不認得

**Evidence** — 以下 8 個檔案的 `ralph` block 已包含 `cl:` field：

| File | `cl` value |
|---|---|
| `cp-244-*.mdx` | 8 |
| `en-cp-244-*.mdx` | 9 |
| `sd-18-*.mdx` | 10 |
| `en-sd-18-*.mdx` | 9 |
| `sp-164-*.mdx` | 8 |
| `en-sp-164-*.mdx` | 8 |
| `cp-262-*.mdx` | 9 |
| `sp-158-*.mdx` | 10 |

**Root cause**: `frontmatter-scores.mjs` (L244) writes `cl` when clarity is provided, but `config.ts` (L47-54) Zod schema only defines `p`, `c`, `v` — no `cl`. Zod `.object()` default behavior = strip unknown keys silently. So `cl` passes build but is **silently dropped at runtime**, meaning the clarity score is **lost**.

**Spec gap**: Spec says "Legacy keys 保留 optional（舊文章不壞）" (Design Principle 5) but doesn't address the `cl:` drift. These 8 posts are in a limbo state — neither legacy (3-dim ralph) nor new tribunal format.

**Required action**: Spec must decide:
1. Add `cl: z.number().optional()` to legacy `ralph` schema (quick fix), OR
2. Migrate these 8 posts to new tribunal format as part of this work

### [FAIL] `sonnet` key in AiJudgeScore.astro but NOT in Zod schema

**Evidence**: `AiJudgeScore.astro` L17 defines:
```typescript
sonnet?: { r: number; g: number; date: string; model?: string; harness?: string };
```

But `config.ts` scores object (L44-73) has NO `sonnet` key. Only `ralph`, `gemini`, `codex`.

**Impact**: The "Reader" card in the UI (AiJudgeScore.astro L209-261) can never render because the data is stripped by Zod at build time.

**Required action**: Either add `sonnet` to legacy schema, or confirm it's dead code that gets replaced by the new tribunal cards.

### [WARN] `frontmatter-scores.mjs` not mentioned in spec Dependencies

**Evidence**: `frontmatter-scores.mjs` (L41) hardcodes valid judge names: `['gemini', 'codex', 'opus', 'sonnet']`. Maps them to frontmatter keys (L47): `{ gemini: 'gemini', codex: 'codex', opus: 'ralph', sonnet: 'sonnet' }`.

New tribunal judges (`librarian`, `factCheck`, `freshEyes`, `vibe`) are NOT in this list. This script is the **actual code that reads/writes scores to frontmatter** — it's critical path.

**Required action**: Add `scripts/frontmatter-scores.mjs` to spec Dependencies section and add AC for updating it.

---

## 3. Agent Definition Delta — Detailed Inventory

### fact-checker.md (`.claude/agents/fact-checker.md`)

| Aspect | Current | Spec Target | Status |
|---|---|---|---|
| Scale | 0-4 / 0-3 / 0-3 (L29-43) | 0-10 / 0-10 / 0-10 | NEEDS CHANGE |
| Composite | sum (0-10) (L47) | floor(avg of 3) | NEEDS CHANGE |
| Key: technicalAccuracy | `breakdown.technicalAccuracy.score: "N/4"` | `accuracy: N` | NEEDS CHANGE |
| Key: sourceFaithfulness | `breakdown.sourceFaithfulness.score: "N/3"` | `fidelity: N` | NEEDS CHANGE |
| Key: logicalConsistency | `breakdown.logicalConsistency.score: "N/3"` | `consistency: N` | NEEDS CHANGE |
| Output JSON path | `breakdown.*` (L69-71) | flat `accuracy: N` etc. | NEEDS CHANGE |
| Pass bar | "PASS = score >= 8" (L74) | score ≥ 8 | OK (same threshold) |

### librarian.md (`.claude/agents/librarian.md`)

| Aspect | Current | Spec Target | Status |
|---|---|---|---|
| Dimensions | 6: glossaryCoverage, sourceAlignment, crossReferences, identityLinking, attribution, pronounClarity (L24-56) | 3: glossary, crossRef, sourceAlign | NEEDS CHANGE |
| Key names | long form (glossaryCoverage) | short form (glossary) | NEEDS CHANGE |
| Composite | floor(avg of 6) AND no dim < 6 (L59) | floor(avg of 3) AND score ≥ 8 | NEEDS CHANGE |
| Output JSON | `scores.glossaryCoverage.score` etc. (L72-79) | flat `glossary: N` etc. | NEEDS CHANGE |

### fresh-eyes.md (`.claude/agents/fresh-eyes.md`)

| Aspect | Current | Spec Target | Status |
|---|---|---|---|
| Dimensions | 2: readability, firstImpression | 2: readability, firstImpression | OK |
| Pass bar | "PASS = both >= 7" (L67) | score ≥ 8 (floor(avg) ≥ 8) | NEEDS CHANGE |
| Output JSON | `scores.readability.score` etc. (L59-63) | flat `readability: N` etc. | NEEDS CHANGE |

### vibe-opus-scorer.md (`.claude/agents/vibe-opus-scorer.md`)

| Aspect | Current | Spec Target | Status |
|---|---|---|---|
| Dimensions | 4: persona, clawdNote, vibe, clarity | 4: persona, clawdNote, vibe, clarity | OK |
| Key names | full names already | full names | OK |
| Pass bar | "All four >= 8" (L68) | score ≥ 8 AND one ≥ 9 | NEEDS CHANGE |
| Output JSON | `scores.persona.score` etc. (L76-82) | flat `persona: N` etc. | NEEDS CHANGE |

---

## 4. Legacy Code/Format Cleanup — Complete Inventory

### TIER 1: Must update for spec to work

| # | File | What needs changing | Why |
|---|---|---|---|
| 1 | `src/content/config.ts` | Add 4 new judge blocks to Zod schema; add `cl` to legacy ralph | Schema doesn't validate new scores or existing `cl` field |
| 2 | `src/components/AiJudgeScore.astro` | New Props interface for tribunal cards; new/old display logic | Props only know ralph/gemini/codex/sonnet |
| 3 | `.claude/agents/fact-checker.md` | Scale 0-10x3, key names, output format | See delta table above |
| 4 | `.claude/agents/librarian.md` | 6 dims → 3, key names, composite formula | See delta table above |
| 5 | `.claude/agents/fresh-eyes.md` | Pass bar ≥ 7 → ≥ 8, output format | See delta table above |
| 6 | `.claude/agents/vibe-opus-scorer.md` | Pass bar add "one ≥ 9", output format | See delta table above |
| 7 | `scripts/frontmatter-scores.mjs` | Add new judge names (librarian/factCheck/freshEyes/vibe), new key mappings, new read/write logic | Currently only accepts gemini/codex/opus/sonnet |
| 8 | `scripts/vibe-scoring-standard.md` | Output JSON format alignment; pass bar update (Vibe: one ≥ 9 + rest ≥ 8; Fresh Eyes: ≥ 8) | Parent spec Section A mandates this |

### TIER 2: Should update (called by orchestrator)

| # | File | What needs changing | Why |
|---|---|---|---|
| 9 | `scripts/score-helpers.sh` | `validate_judge_score_json()` L259-287: add cases for `librarian`, `fact-checker`, `fresh-eyes`, `vibe-opus-scorer`; opus case missing `clarity` validation | Default `*) return 1` rejects new judge names |
| 10 | `scripts/score-helpers.sh` | `default_rate_limit_backoff()` L307-314: add `sonnet`, `haiku` cases | Missing backoff defaults for new model tiers |
| 11 | `scripts/validate-judge-output.sh` | Add cases for new judge names; currently only gemini/codex/opus/sonnet (L57-97) | Will reject new judge output as invalid |
| 12 | `scripts/tribunal-gate.sh` | References "3 judges" (L6, L240); calls `frontmatter-scores.mjs delete` with old judge names | Being replaced by ralph-all-claude.sh but should be noted |
| 13 | `CLAUDE.md` L94 | "Fresh Eyes ≥ 7" → "Fresh Eyes ≥ 8" | Parent spec Section A explicitly says update this |

### TIER 3: Dead code (parent spec says keep, don't delete)

| # | File | Status |
|---|---|---|
| 14 | `scripts/ralph-orchestrator.sh` | Being replaced by ralph-all-claude.sh; keep as dead code per parent spec |
| 15 | `scripts/gemini-scorer.sh` | Gemini judge wrapper; keep as dead code |
| 16 | `scripts/codex-scorer.sh` | Codex judge wrapper; keep as dead code |
| 17 | `scripts/ralph-scorer.sh` | Opus vibe scorer wrapper; keep as dead code |
| 18 | `scripts/multi-scorer.sh` | Multi-judge orchestration; keep as dead code |
| 19 | `scripts/score-loop-engine.sh` | Generic judge loop; keep as dead code |

### TIER 4: Posts with `cl:` drift (data, not code)

8 posts with `cl:` field in `ralph` block that Zod silently strips:
- `cp-244`, `en-cp-244`, `sd-18`, `en-sd-18`, `sp-164`, `en-sp-164`, `cp-262`, `sp-158`

---

## 5. Acceptance Criteria — Tightened (Testable)

### Schema (config.ts)

- [ ] **AC-1**: `src/content/config.ts` defines `scores.librarian` with fields `glossary`, `crossRef`, `sourceAlign` (all `z.number().min(0).max(10)`), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-2**: `scores.factCheck` with fields `accuracy`, `fidelity`, `consistency` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-3**: `scores.freshEyes` with fields `readability`, `firstImpression` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-4**: `scores.vibe` with fields `persona`, `clawdNote`, `vibe`, `clarity` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-5**: New tribunal judge blocks do NOT include `harness` field.
- [ ] **AC-6**: Legacy `ralph` schema adds optional `cl: z.number().optional()` to stop silent stripping.
- [ ] **AC-7**: Legacy `gemini`, `codex` schemas remain unchanged and `.optional()`.
- [ ] **AC-8**: `pnpm run build` passes with (a) posts having only legacy scores, (b) posts having only new tribunal scores, (c) posts having both.

### UI (AiJudgeScore.astro)

- [ ] **AC-9**: Props interface includes all 4 new tribunal judge types with their sub-score fields.
- [ ] **AC-10**: New tribunal cards show: judge name, composite `score/10`, and individual dimension scores.
- [ ] **AC-11**: When post has BOTH legacy and new tribunal scores, only tribunal cards render.
- [ ] **AC-12**: When post has ONLY legacy scores, existing card layout renders unchanged.
- [ ] **AC-13**: `sonnet` key in Props either gets Zod backing or is removed as dead code. No phantom Props.

### Agent Definitions

- [ ] **AC-14**: `fact-checker.md` output JSON uses keys `accuracy`, `fidelity`, `consistency` (each 0-10). Composite = `floor(avg)`. No "N/4" or "N/3" scale references remain.
- [ ] **AC-15**: `librarian.md` has exactly 3 dimensions: `glossary`, `crossRef`, `sourceAlign`. No references to identityLinking, attribution, pronounClarity, glossaryCoverage, sourceAlignment, crossReferences.
- [ ] **AC-16**: `fresh-eyes.md` pass bar = `floor(avg(readability, firstImpression)) ≥ 8`. No "≥ 7" references remain.
- [ ] **AC-17**: `vibe-opus-scorer.md` pass bar = `composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8`. No "All four >= 8" without the ≥ 9 condition.

### Scripts

- [ ] **AC-18**: `scripts/frontmatter-scores.mjs` accepts judge names `librarian`, `factCheck`, `freshEyes`, `vibe` (in addition to legacy `gemini`, `codex`, `opus`, `sonnet`). Maps to correct frontmatter keys.
- [ ] **AC-19**: `scripts/score-helpers.sh` `validate_judge_score_json()` handles `librarian`, `fact-checker`, `fresh-eyes`, `vibe-opus-scorer` judge names with correct dimension validation.
- [ ] **AC-20**: `scripts/validate-judge-output.sh` handles new judge names.
- [ ] **AC-21**: `scripts/vibe-scoring-standard.md` output format section matches new tribunal JSON structure.

### Documentation

- [ ] **AC-22**: `CLAUDE.md` L94 reads "Fresh Eyes ≥ 8" (not ≥ 7).

### Regression

- [ ] **AC-23**: `pnpm run build` passes on current codebase (no existing posts break).
- [ ] **AC-24**: `node scripts/validate-posts.mjs` passes.

---

## 6. Additional Findings

### [WARN] `sonnet` key is a ghost

`AiJudgeScore.astro` renders a "Reader" card from `scores.sonnet` data (L209-261), but no post in the entire repo has a `sonnet` key in frontmatter scores, and Zod doesn't define it. This is dead UI code. The spec should explicitly state whether `sonnet` becomes `freshEyes` in the new schema, or gets removed.

### [WARN] Output JSON format inconsistency across agents

Current agents output different JSON structures:
- fact-checker: `{ score, breakdown: { technicalAccuracy: { score: "N/4", reason } } }`
- librarian: `{ composite, scores: { glossaryCoverage: { score: N, reason } } }`
- fresh-eyes: `{ scores: { readability: { score: N, reason } } }`
- vibe-opus-scorer: `{ scores: { persona: { score: N, reason } } }`

Spec proposes flat frontmatter (`persona: 9`) but doesn't specify the **agent output JSON format** that the orchestrator expects. The orchestrator needs to parse agent output → extract scores → write to frontmatter. This transformation layer needs to be specified.

**Recommendation**: Define a uniform agent output JSON format in the spec:
```json
{
  "judge": "librarian",
  "dimensions": { "glossary": 8, "crossRef": 9, "sourceAlign": 8 },
  "score": 8,
  "date": "2026-04-07",
  "model": "claude-sonnet-4-6",
  "reasons": { "glossary": "...", "crossRef": "...", "sourceAlign": "..." },
  "verdict": "PASS"
}
```

### [WARN] Composite formula for Vibe needs clarification

Spec says `score = floor(avg of all dims)` universally. But Vibe also needs "one ≥ 9 AND rest ≥ 8". 

Question: is `score` the floor(avg), and the ≥ 9 condition is checked separately by the orchestrator? Or does the agent itself enforce it? This matters for the output JSON — does the agent report `meetBar` or `verdict` that includes the ≥ 9 check?

### [FAIL] Spec Dependencies section incomplete

Missing from Dependencies:
- `scripts/frontmatter-scores.mjs` — the actual read/write code for frontmatter scores
- `scripts/validate-judge-output.sh` — validates judge output JSON
- `scripts/score-helpers.sh` — contains `validate_judge_score_json()`
- `CLAUDE.md` — contains stale Fresh Eyes bar (≥ 7)
- `scripts/vibe-scoring-standard.md` — listed in parent spec but missing from this spec's Dependencies

### [WARN] No mention of `validate-posts.mjs`

`scripts/validate-posts.mjs` does frontmatter validation independently from Zod. If it has score-related checks, it also needs updating. Should be verified.

---

## Summary Table

| # | Item | Status | Action Required |
|---|---|---|---|
| 1 | Spec vs parent: pass bars | PASS | None |
| 2 | Spec vs parent: model assignments | PASS | None |
| 3 | Spec vs parent: dimension names | PASS | None |
| 4 | Uniform 0-10 / floor(avg) | PASS | None |
| 5 | Vibe pass bar wording | WARN | Tighten L65 to include "no dim < 8" |
| 6 | `cl:` drift in 8 posts | FAIL | Add `cl` to legacy ralph schema or migrate |
| 7 | `sonnet` ghost key | FAIL (grouped with #12) | Decide: add to Zod or remove from UI |
| 8 | `frontmatter-scores.mjs` missing | FAIL | Add to Dependencies + create AC |
| 9 | Agent output JSON format undefined | WARN | Define uniform output format |
| 10 | Vibe composite vs ≥ 9 enforcement | WARN | Clarify who enforces |
| 11 | Dependencies section incomplete | FAIL | Add 5 missing files |
| 12 | `validate-judge-output.sh` not mentioned | WARN | Add to inventory |

---

**Reviewer verdict**: CONDITIONAL PASS. Fix the 3 FAIL items (cl: drift, Dependencies, frontmatter-scores.mjs), then spec is ready for Builder.
