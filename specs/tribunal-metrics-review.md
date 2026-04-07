# Spec: Tribunal Metrics Review

**Author**: Planner (Opus) — fresh-eyes review
**Date**: 2026-04-08
**Status**: FINAL — all CEO decisions confirmed
**Requested by**: CEO
**Parent spec**: `specs/tribunal-score-schema.md`

## Context

CEO 要求對 tribunal 的 12 個 dimensions 做 fresh-eyes review：是不是在測對的東西？有沒有重疊或遺漏？Agent prompt 有沒有 calibration 問題？

## CEO Decisions (Confirmed)

### Decision 1: `vibe.vibe` vs `freshEyes.firstImpression` — 保留兩者

**Rationale**: 雖然兩個 dimension 的 rubric 描述幾乎一樣（"would you share with a friend?"），但 **judge persona 不同 = 不同的 construct**：
- Vibe Scorer = calibrated veteran（讀過所有 golden standards，知道 SP-158 trap）
- Fresh Eyes = 3-month engineer（impatient，不知道 blog 的 context）

同一篇文章可以讓 veteran 覺得 vibe 不錯但讓 3-month 菜鳥完全讀不下去。**不同 POV 就是不同的測量。**

**Action**: None. Keep both dimensions as-is.

### Decision 2: 拆開 `librarian.sourceAlign`

**Problem**: `sourceAlign` 塞了三件不同性質的事：
1. sourceUrl 是否對齊內容（metadata check）
2. 引用歸屬是否正確（content quality）
3. 代名詞清晰度（readability）

**Change**:

| Before | After |
|---|---|
| `sourceAlign` (3-in-1) | `sourceAlign` (pure URL alignment) |
| — | `attribution` (引用歸屬、事實/觀點分離) |
| — | *(pronoun clarity 砍掉 — Vibe `clarity` 已涵蓋)* |

**Result**: Librarian 從 3 dims → **4 dims**: `glossary` · `crossRef` · `sourceAlign` · `attribution`

**Why drop pronoun clarity from Librarian?** Vibe Scorer 的 `clarity` dimension 更 well-calibrated（有 SP-158 教訓、有 rubric anchors），重複測量沒有額外 signal。

### Decision 3: 新增 `narrative` dimension（Vibe Scorer）

**Problem**: 敘事結構是 gu-log 品質的核心差異化因素（WRITING_GUIDELINES 整個 Narrative Structure section），也是 SP-158 核心教訓（decorative persona + linear structure = trap）。但沒有任何 dimension explicitly 測結構。

**Change**: Vibe Scorer 新增第 5 個 dimension `narrative`。

| Dimension | 測什麼 |
|---|---|
| `narrative` | 敘事結構、節奏變化、情緒起伏、結尾是否有 punch（不是 bullet recap） |

**Vibe Scorer 新 dimensions**: `persona` · `clawdNote` · `vibe` · `clarity` · `narrative`

**Scoring anchors (draft)**:
- **10** = 情緒起伏明確，每個 section 節奏不同，結尾 callback 開頭，讀完有「靠，這句要記住」的感覺
- **8** = 有變化但某些段落回到 explain → bullets → ClawdNote 的 template 節奏
- **6** = 線性結構（介紹 → 展開 → 再展開 → 結尾），沒有情緒高低點
- **4** = SP-158 level — 骨架是報告，表面裝飾改不了結構問題
- **2** = 純 bullet dump，沒有 narrative 可言

**Pass bar impact**: Vibe 的 pass bar 不變（composite ≥ 8 AND one dim ≥ 9 AND no dim < 8）。加了一個 dimension 後 composite 更嚴格（5 dims 的 avg 更難都 ≥ 8），這是好事。

### Decision 4: Fact Checker Calibration — Uniform Composite ≥ 8 + Anchor Tables

**Problem**: Fact Checker 是唯一沒有 golden standard calibration examples 的 judge。Scale 要從 0-4/0-3/0-3 改成 3×(0-10)，但完全沒有校準。

**Research completed** (see `specs/tribunal-calibration-research.md`):
- Researcher 產出了完整的 0-10 anchor descriptions（每個 dimension 都有 0/3/5/7/8/9/10 描述）
- 找到 2 個真實 calibration articles：
  - **SP-14** (high anchor, 9/10): Anthropic 研究，精確 stats，完整 hedge preservation
  - **CP-153** (medium anchor, 8/10): Tweet 來源，架構正確，numbers verifiable
- Low anchor (5-6): 掃完 post library 沒找到真正的低品質案例，用 hypothetical pattern 暫代。下一篇 fail 的文章出現時補入。

**CEO Decision: Uniform composite ≥ 8**（與其他 judge 一致）
- 不採用 researcher 建議的 per-dim ≥ 7 方案
- 理由：一致性 > 微調。`checkPassBar()` 只需要一套邏輯
- 如果某個 dim 是 7，composite 還能靠其他 dim 拉上 8

**Action**:
- [x] Anchor tables 寫入 fact-checker.md agent prompt
- [x] Calibration articles (SP-14, CP-153) 寫入 scoring SSOT
- [x] Pass bar = composite ≥ 8（uniform）

### Decision 5: Fresh Eyes Persona = 3-month Engineer, Bar 8

**Changes**:
1. Agent prompt persona 從 "developer with 1-2 years of experience" → **"developer with ~3 months of experience"**
2. Pass bar 維持 ≥ 8（與 schema spec 一致）
3. Persona description 加強 impatience: 更菜、更不耐煩、更容易被 jargon 嚇跑

**Why 3-month?** CEO preference。Fresh Eyes 的價值就是抓住「對新手完全不友善」的文章。1-2 year dev 太寬容。

### Decision 6: EN Version — Cultural Accessibility 併入 Persona

**Problem**: 所有 rubric 以 zh-tw 為基準。EN 版沒有 scoring guidance。

**Research completed** (see `specs/tribunal-calibration-research.md`):
- 調查了 3 篇 EN 文章（SP-14, SP-2, SP-24），全部 8/8/8 — zh-tw rubric 沒 capture EN-specific variance
- 產出了 EN 版 Persona 和 Clarity 的 anchor tables
- 提出 `culturalAccessibility` 作為新 dimension 的可能性

**CEO Decision: 併入 Persona（Option Y）**
- Cultural accessibility 本質上就是 Persona 的一部分 —「好的 persona = 讀者能 relate」
- 不增加 lang-aware 複雜度，EN 和 zh-tw 的 Vibe Scorer 用同樣的 5 dims
- EN persona rubric 自然包含 "analogies must be globally resonant"

**Scoring SSOT 的 EN 調整**:
1. **Persona (EN)**: LHY warmth + universally resonant analogies。PTT 風格換成 culturally neutral humor。Cultural accessibility 是 persona 的 sub-criteria。
2. **Clarity (EN)**: 你/我 禁令不適用。改為 referent clarity — "I/you" 的 referent 必須清楚。
3. **ClawdNote / Vibe / Narrative**: 同 zh-tw bar，不需要 EN-specific adjustment。

**Action**:
- [x] EN persona / clarity anchor descriptions 寫入 scoring SSOT
- [x] Cultural accessibility requirements 併入 EN persona rubric
- [x] 不加新 dimension，EN/zh-tw 維持同樣的 5 dims structure

---

## New Dimension Map (Post-Review)

### Vibe Scorer (Opus) — 5 dims (+1)

| Dimension | 測什麼 | 變更 |
|---|---|---|
| `persona` | LHY 教授風格 | unchanged |
| `clawdNote` | 吐槽 + 洞察品質 | unchanged |
| `vibe` | 整體 enjoyment（fun/chill/informed） | unchanged |
| `clarity` | 代名詞清晰度 / voice attribution | unchanged |
| `narrative` | **NEW** — 敘事結構、節奏、情緒起伏 | **added** |

Pass bar: `composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8`

### Fact Checker (Opus) — 3 dims

| Dimension | 測什麼 | 變更 |
|---|---|---|
| `accuracy` | 技術正確性 | scale 0-10 (was 0-4) |
| `fidelity` | 來源忠實度 | scale 0-10 (was 0-3) |
| `consistency` | 邏輯一致性 | scale 0-10 (was 0-3) |

Pass bar: `composite ≥ 8`

### Librarian (Sonnet) — 4 dims (+1)

| Dimension | 測什麼 | 變更 |
|---|---|---|
| `glossary` | Glossary 覆蓋率 | unchanged |
| `crossRef` | Internal cross-references + identity linking | unchanged |
| `sourceAlign` | sourceUrl 是否對齊內容 | **narrowed** (was 3-in-1) |
| `attribution` | 引用歸屬、事實/觀點分離 | **NEW** (split from sourceAlign) |

Pass bar: `composite ≥ 8`

### Fresh Eyes (Haiku) — 2 dims

| Dimension | 測什麼 | 變更 |
|---|---|---|
| `readability` | 能不能跟上 | unchanged |
| `firstImpression` | 會不會讀完/分享 | unchanged |

Pass bar: `composite ≥ 8`
Persona: **3-month engineer** (was 1-2 year)

---

## Total: 4 Judges, 14 Dimensions (+2)

| Judge | Dims | Model |
|---|---|---|
| Vibe Scorer | 5 | Opus |
| Fact Checker | 3 | Opus |
| Librarian | 4 | Sonnet |
| Fresh Eyes | 2 | Haiku |

---

## Impact on Schema Spec

`specs/tribunal-score-schema.md` 需要更新：

1. **Vibe**: 加 `narrative` dimension
2. **Librarian**: 加 `attribution` dimension，`sourceAlign` 描述 narrowed
3. **Fresh Eyes**: persona description 更新
4. **Zod schema**: 對應新增 fields
5. **Frontmatter 範例**: 更新
6. **UI cards**: Librarian sub-scores 多一個，Vibe sub-scores 多一個
7. **checkPassBar()**: 邏輯不變（composite-based），但 Vibe 的 avg 分母從 4 → 5

---

## All Decisions Finalized

| # | Decision | Status |
|---|---|---|
| 1 | Keep `vibe.vibe` + `freshEyes.firstImpression` (different POV) | Confirmed |
| 2 | Split `librarian.sourceAlign` → `sourceAlign` + `attribution` | Confirmed |
| 3 | Add `narrative` dimension to Vibe Scorer | Confirmed |
| 4 | Fact Checker: 0-10 anchors + uniform composite ≥ 8 | Confirmed |
| 5 | Fresh Eyes: 3-month engineer, bar 8 | Confirmed |
| 6 | EN: cultural accessibility 併入 Persona, no new dim | Confirmed |

---

## Acceptance Criteria (for this review spec)

- [ ] **MR-1**: Vibe Scorer agent definition includes `narrative` dimension with scoring anchors
- [ ] **MR-2**: Librarian agent definition has 4 dims: `glossary`, `crossRef`, `sourceAlign` (pure URL), `attribution`
- [ ] **MR-3**: Fresh Eyes persona = "~3 months of experience", pass bar ≥ 8
- [ ] **MR-4**: Fact Checker has ≥ 2 calibration examples (SP-14, CP-153) with per-dimension 0-10 scores + anchor tables
- [ ] **MR-5**: Scoring SSOT includes EN-specific Persona/Clarity anchor descriptions; cultural accessibility is part of EN Persona rubric
- [ ] **MR-6**: `tribunal-score-schema.md` updated to reflect new dimension map
- [ ] **MR-7**: All agent output JSON reflects updated dimension keys
