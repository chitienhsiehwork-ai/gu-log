# Spec: Tribunal Score Schema

**Author**: Planner (Opus)
**Date**: 2026-04-07
**Status**: FINAL — pending CEO approval
**Requested by**: CEO
**Parent spec**: `specs/tribunal-all-claude-migration.md` Section G
**Review**: `specs/review-tribunal-score-schema.md`

## Design Principles

1. **Uniform scale**: 所有維度 0-10，沒有例外
2. **Uniform composite**: `score = floor(avg of all dims)`，所有 judge 一樣
3. **Full names**: 不用縮寫，任何 agent 不查表就能讀懂
4. **SSOT in frontmatter**: sub-scores 全部存 frontmatter，不分散到 progress JSON
5. **No legacy**: 刪除所有舊 scores（ralph/gemini/codex），Zod schema 只有新 tribunal format。所有文章由 tribunal 從零打分
6. **Uniform agent output**: 所有 judge 吐同樣的 JSON 結構，orchestrator 不需要 per-judge parsing
7. **Code is the rule**: Pass bar、composite 計算、verdict 判定全部寫在 code 裡。Prompt 只用在 code 做不到的地方（rubric 理解、質性評分）

## Uniform Score System

```
每個維度：0-10
Composite：floor(avg of all dims)
Pass bar：composite ≥ 8
Vibe 額外條件：composite ≥ 8 AND 至少一個維度 ≥ 9 AND 沒有任何維度 < 8
```

## 4 Judges — Dimensions

### 1. Librarian (Sonnet) — 3 維度

| Dimension | 說明 | 涵蓋原本的 |
|---|---|---|
| `glossary` | Glossary term 覆蓋率、連結完整度 | glossaryCoverage |
| `crossRef` | 內部文章 cross-reference + identity linking（ShroomDog/Clawd 首次出現連結） | crossReferences + identityLinking |
| `sourceAlign` | sourceUrl 對齊、引用歸屬、事實/觀點分離 | sourceAlignment + attribution + pronounClarity |

Pass bar: `score ≥ 8`

### 2. Fact Checker (Opus) — 3 維度

| Dimension | 說明 |
|---|---|
| `accuracy` | 技術正確性（API、架構、model 名稱、benchmark 數字） |
| `fidelity` | 來源忠實度（翻譯有無扭曲、hedge/caveat 保留） |
| `consistency` | 邏輯一致性（論點前後不矛盾、結論有依據） |

Pass bar: `score ≥ 8`

### 3. Fresh Eyes (Haiku) — 2 維度

| Dimension | 說明 |
|---|---|
| `readability` | 第一次讀者能不能跟上、有沒有迷路 |
| `firstImpression` | 會不會讀完、會不會分享給朋友 |

Pass bar: `score ≥ 8`

### 4. Vibe Scorer (Opus) — 4 維度

| Dimension | 說明 |
|---|---|
| `persona` | LHY 教授風格：口語感、生活化比喻、對技術吐槽對人友善 |
| `clawdNote` | 吐槽 + 洞察品質：有沒有自己的立場、不只是解釋 |
| `vibe` | 整體好不好讀、想不想分享、fun/chill/informed |
| `clarity` | 代名詞清晰度、voice attribution、讀者永遠知道誰在講話 |

Pass bar: `composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8`

## Frontmatter Schema

### 完整範例

```yaml
scores:
  librarian:
    glossary: 8
    crossRef: 9
    sourceAlign: 8
    score: 8
    date: "2026-04-07"
    model: "claude-sonnet-4-6"
  factCheck:
    accuracy: 8
    fidelity: 9
    consistency: 8
    score: 8
    date: "2026-04-07"
    model: "claude-opus-4-6"
  freshEyes:
    readability: 8
    firstImpression: 8
    score: 8
    date: "2026-04-07"
    model: "claude-haiku-4-5"
  vibe:
    persona: 9
    clawdNote: 8
    vibe: 8
    clarity: 9
    score: 8
    date: "2026-04-07"
    model: "claude-opus-4-6"
```

No legacy keys. No `ralph`, `gemini`, `codex`, `sonnet`. One format.

### Zod Schema (for `src/content/config.ts`)

```typescript
// Tribunal judges — uniform: all dims 0-10, score = floor(avg)
const tribunalJudge = (dims: Record<string, z.ZodNumber>) =>
  z.object({
    ...dims,
    score: z.number().min(0).max(10),
    date: z.string(),
    model: z.string().optional(),
  }).optional();

// Inside postsCollection schema:
scores: z.object({
  librarian: tribunalJudge({
    glossary: z.number().min(0).max(10),
    crossRef: z.number().min(0).max(10),
    sourceAlign: z.number().min(0).max(10),
  }),
  factCheck: tribunalJudge({
    accuracy: z.number().min(0).max(10),
    fidelity: z.number().min(0).max(10),
    consistency: z.number().min(0).max(10),
  }),
  freshEyes: tribunalJudge({
    readability: z.number().min(0).max(10),
    firstImpression: z.number().min(0).max(10),
  }),
  vibe: tribunalJudge({
    persona: z.number().min(0).max(10),
    clawdNote: z.number().min(0).max(10),
    vibe: z.number().min(0).max(10),
    clarity: z.number().min(0).max(10),
  }),
}).optional(),
```

## Data Migration — Clean Slate

**刪除所有現有 scores**。所有文章由新 tribunal 從零打分。

理由：
- 舊 scores 來自不同 model、不同 rubric、不同 scale — 轉換沒意義
- 品質好的文章，tribunal 第一次就會 PASS（一次 call）
- 品質不夠的文章，被 rewrite 是好事

### Migration script 做的事：

1. 掃描所有 `.mdx` 文章
2. 移除整個 `scores:` block（包含 ralph/gemini/codex/任何 score data）
3. 驗證 `pnpm run build` 通過

歷史 scores 保留在 git history 裡，不會真正消失。

## Uniform Agent Output JSON

所有 judge agent 必須吐同樣的 JSON 結構，讓 orchestrator 不需要 per-judge parsing：

```json
{
  "judge": "librarian",
  "dimensions": {
    "glossary": 8,
    "crossRef": 9,
    "sourceAlign": 8
  },
  "score": 8,
  "verdict": "PASS",
  "reasons": {
    "glossary": "All key terms linked...",
    "crossRef": "3 relevant posts referenced...",
    "sourceAlign": "Source faithfully represented..."
  }
}
```

**規則**：
- `judge`: agent 名稱（`librarian` / `factCheck` / `freshEyes` / `vibe`）
- `dimensions`: key = dimension 全名，value = 0-10 整數
- `score`: `floor(avg of dimensions)`，agent 自己算
- `verdict`: `"PASS"` or `"FAIL"`，agent 根據 pass bar 自己判（advisory only）
- `reasons`: 每個維度一句話理由

### Pass Bar Enforcement — Code is the Rule

> **Principle: code is the rule. prompt is when we cannot code.**

Agent 的 `verdict` 只是 advisory。**Orchestrator 用 code 做最終裁決**，不靠 agent prompt enforce pass bar。

Orchestrator 必須實作 `checkPassBar(judge, dimensions)` function：

```javascript
function checkPassBar(judge, dimensions) {
  const values = Object.values(dimensions);
  const composite = Math.floor(values.reduce((a, b) => a + b) / values.length);

  if (composite < 8) return { pass: false, composite, reason: `composite ${composite} < 8` };

  if (judge === 'vibe') {
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max < 9) return { pass: false, composite, reason: `no dimension ≥ 9 (max: ${max})` };
    if (min < 8) return { pass: false, composite, reason: `dimension < 8 (min: ${min})` };
  }

  return { pass: true, composite };
}
```

- Agent verdict 和 code verdict 不一致時 → **以 code 為準**，log the discrepancy
- Pass bar 規則只維護在 code 裡，agent prompt 只需要 reference「依照 pass bar 判 PASS/FAIL」

## UI: AiJudgeScore.astro — 完全重寫

舊 component 的 Props（ralph/gemini/codex/sonnet）全部砍掉。只支援新 tribunal format。

| Card | Judge | 大數字 | Sub-scores 行 |
|---|---|---|---|
| **Librarian** | librarian | `score/10` | glossary · crossRef · sourceAlign |
| **Fact Check** | factCheck | `score/10` | accuracy · fidelity · consistency |
| **Fresh Eyes** | freshEyes | `score/10` | readability · firstImpression |
| **Vibe** | vibe | `score/10` | persona · clawdNote · vibe · clarity |

- 有 scores → 顯示 4 張 card
- 沒 scores → 不顯示 panel（文章等待 tribunal 評分）
- 不需要 legacy/new 切換邏輯

新的 tribunal keys **不加 `harness` field**。讀者想看 harness 可以點 pipeline script 連結。

## Legacy Cleanup Inventory

### TIER 1: 必須更新

| # | File | 改什麼 | 為什麼 |
|---|---|---|---|
| 1 | `src/content/config.ts` | 砍掉 ralph/gemini/codex Zod blocks，只留 4 個新 judge | 一套 schema |
| 2 | `src/components/AiJudgeScore.astro` | 完全重寫 Props + cards，砍掉所有 legacy code（ralph/gemini/codex/sonnet） | 一套 UI |
| 3 | `.claude/agents/fact-checker.md` | Scale 0-10×3，key names，output uniform JSON | 目前是 0-4/0-3/0-3 + nested JSON |
| 4 | `.claude/agents/librarian.md` | 6 dims → 3，key names，composite formula，output uniform JSON | 目前 6 維度 + nested JSON |
| 5 | `.claude/agents/fresh-eyes.md` | Pass bar ≥ 7 → ≥ 8，output uniform JSON | 目前 pass bar 太低 |
| 6 | `.claude/agents/vibe-opus-scorer.md` | Pass bar 加 "one ≥ 9 + no dim < 8"，output uniform JSON | 目前只有 "all ≥ 8" |
| 7 | `scripts/frontmatter-scores.mjs` | 砍掉 legacy judge names，只支援 librarian/factCheck/freshEyes/vibe | Hardcodes `['gemini', 'codex', 'opus', 'sonnet']` |
| 8 | `scripts/vibe-scoring-standard.md` | Output JSON format 對齊 uniform format；pass bar 更新 | SSOT 要 match |
| 9 | **所有 .mdx 文章** | 刪除整個 `scores:` block | Clean slate，tribunal 從零打分 |

### TIER 2: 應該更新（orchestrator 會 call）

| # | File | 改什麼 | 為什麼 |
|---|---|---|---|
| 10 | `scripts/score-helpers.sh` | `validate_judge_score_json()` 改為只認新 judge names + uniform JSON validation | Default `*) return 1` 會 reject 新 judges |
| 11 | `scripts/score-helpers.sh` | `default_rate_limit_backoff()` 加 sonnet/haiku cases | 缺 backoff defaults |
| 12 | `scripts/validate-judge-output.sh` | 改為只認新 judge names + uniform JSON | 只認得 gemini/codex/opus/sonnet |
| 13 | `scripts/tribunal-gate.sh` | References "3 judges" → being replaced | 被 ralph-all-claude.sh 取代 |
| 14 | `CLAUDE.md` | "Fresh Eyes ≥ 7" → "Fresh Eyes ≥ 8"；更新 scores 描述 | Parent spec 明確要求 |
| 15 | `scripts/validate-posts.mjs` | 確認 score-related checks 對齊新 schema | 獨立於 Zod 的 validation |

### TIER 3: Dead code（parent spec 說保留不刪）

| # | File | 狀態 |
|---|---|---|
| 16 | `scripts/ralph-orchestrator.sh` | 被 ralph-all-claude.sh 取代 |
| 17 | `scripts/gemini-scorer.sh` | Gemini judge wrapper |
| 18 | `scripts/codex-scorer.sh` | Codex judge wrapper |
| 19 | `scripts/ralph-scorer.sh` | Opus vibe scorer wrapper |
| 20 | `scripts/multi-scorer.sh` | Multi-judge orchestration |
| 21 | `scripts/score-loop-engine.sh` | Generic judge loop |

## Acceptance Criteria

### Schema (config.ts)

- [ ] **AC-1**: `config.ts` defines `scores.librarian` with fields `glossary`, `crossRef`, `sourceAlign` (all `z.number().min(0).max(10)`), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-2**: `scores.factCheck` with fields `accuracy`, `fidelity`, `consistency` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-3**: `scores.freshEyes` with fields `readability`, `firstImpression` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-4**: `scores.vibe` with fields `persona`, `clawdNote`, `vibe`, `clarity` (all 0-10), plus `score`, `date`, `model`. All `.optional()`.
- [ ] **AC-5**: New tribunal judge blocks do NOT include `harness` field.
- [ ] **AC-6**: No legacy score keys exist in Zod schema. No `ralph`, `gemini`, `codex`, `sonnet`.
- [ ] **AC-7**: `pnpm run build` passes after all changes.

### Data Migration

- [ ] **AC-8**: ALL `scores:` blocks removed from ALL `.mdx` article files.
- [ ] **AC-9**: `pnpm run build` passes after score removal (scores are optional, no breakage).

### UI (AiJudgeScore.astro)

- [ ] **AC-10**: Props interface includes ONLY the 4 new tribunal judge types. No legacy Props (ralph/gemini/codex/sonnet).
- [ ] **AC-11**: Tribunal cards show: judge name, composite `score/10`, and individual dimension scores.
- [ ] **AC-12**: Posts without scores → no score panel rendered.

### Agent Definitions

- [ ] **AC-13**: `fact-checker.md` output JSON uses uniform format with keys `accuracy`, `fidelity`, `consistency` (each 0-10). Composite = `floor(avg)`. No "N/4" or "N/3" scale references remain.
- [ ] **AC-14**: `librarian.md` has exactly 3 dimensions: `glossary`, `crossRef`, `sourceAlign`. No references to old 6-dim names.
- [ ] **AC-15**: `fresh-eyes.md` pass bar = `score ≥ 8`. No "≥ 7" references remain.
- [ ] **AC-16**: `vibe-opus-scorer.md` pass bar = `composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8`.
- [ ] **AC-17**: All 4 agents output uniform JSON format: `{ judge, dimensions, score, verdict, reasons }`.

### Programmatic Enforcement

- [ ] **AC-18**: Orchestrator implements `checkPassBar(judge, dimensions)` function in code. Pass bar rules enforced programmatically. Agent verdict is advisory only; code verdict is final.
- [ ] **AC-19**: `checkPassBar` covers: composite ≥ 8 for all judges; Vibe additionally checks one dim ≥ 9 and no dim < 8.

### Scripts

- [ ] **AC-20**: `scripts/frontmatter-scores.mjs` only accepts judge names `librarian`, `factCheck`, `freshEyes`, `vibe`. Legacy judge names removed.
- [ ] **AC-21**: `scripts/score-helpers.sh` `validate_judge_score_json()` validates uniform JSON for new judge names only.
- [ ] **AC-22**: `scripts/validate-judge-output.sh` validates new judge names only.
- [ ] **AC-23**: `scripts/vibe-scoring-standard.md` output format section matches uniform JSON structure.

### Documentation

- [ ] **AC-24**: `CLAUDE.md` reads "Fresh Eyes ≥ 8" (not ≥ 7). Score system description updated.

### Regression

- [ ] **AC-25**: `pnpm run build` passes.
- [ ] **AC-26**: `node scripts/validate-posts.mjs` passes.

## Out of Scope

- Scoring rubric 內容調整（什麼算 8 分、什麼算 5 分）— 由另一個 Planner session 處理
- Progress JSON 格式（屬於 parent spec）
- 刪除 TIER 3 dead code（parent spec 說保留）

## Dependencies

- Parent spec: `specs/tribunal-all-claude-migration.md`
- Zod schema: `src/content/config.ts`
- UI component: `src/components/AiJudgeScore.astro`
- Agent definitions: `.claude/agents/{librarian,fact-checker,fresh-eyes,vibe-opus-scorer}.md`
- Score writer: `scripts/frontmatter-scores.mjs`
- Score validator: `scripts/validate-judge-output.sh`
- Score helpers: `scripts/score-helpers.sh`
- Post validator: `scripts/validate-posts.mjs`
- Scoring SSOT: `scripts/vibe-scoring-standard.md`
- Project docs: `CLAUDE.md`
