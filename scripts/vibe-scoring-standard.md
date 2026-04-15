# Ralph Vibe Scoring Standard v2.0

> Golden standard for evaluating gu-log post quality.
> Tribunal v2 calibrated 2026-04-08 by ShroomDog + Clawd.
> **SSOT for all 4 tribunal judges + writer agent.**

## Tribunal System Overview

Tribunal v2 pipeline — 5 stages (0–4). All judges use **uniform 0-10 integer scale**. Composite = `Math.floor(avg of all dims)`.

| Stage | Judge | Model | Dimensions | Pass Bar |
|-------|-------|-------|------------|----------|
| 0 | Worthiness Gate | Opus | coreInsight · expandability · audienceRelevance | WARN mode — always advances, marks frontmatter if low |
| 1 | Vibe | Opus | persona · clawdNote · vibe · clarity · narrative | composite ≥ 8 AND one dim ≥ 9 AND no dim < 8 |
| 2 | Fresh Eyes | Opus | readability · firstImpression | composite ≥ 8 |
| 3 | FactLib (combined) | Opus | factAccuracy · sourceFidelity · linkCoverage · linkRelevance | fact_pass AND library_pass (independent) |
| 4 | Final Vibe | Opus | persona · clawdNote · vibe · clarity · narrative | relative: no dim drops > 1 from Stage 1 |

## Uniform Agent Output JSON (v2)

All judges output the `BaseJudgeOutput` shape from `src/lib/tribunal-v2/types.ts`:

```json
{
  "pass": true,
  "scores": {
    "<dim1>": 8,
    "<dim2>": 9
  },
  "composite": 8,
  "improvements": {
    "<dim1>": "Specific, actionable rewrite suggestion for this dimension."
  },
  "critical_issues": ["1-3 root-cause statements"],
  "judge_model": "claude-opus-4-6",
  "judge_version": "2.0.0",
  "timestamp": "2026-04-15T12:00:00Z"
}
```

**Field rules:**
- `pass` — boolean. Judge's self-assessed verdict per their pass bar (below).
- `scores` — object, exactly the dimension keys for that judge, each integer 0-10.
- `composite` — `Math.floor(sum(scores) / count(scores))`.
- `improvements` — per-dimension rewrite guidance. **Only populate when `pass === false`** (省 token on PASS).
- `critical_issues` — 1-3 root-cause statements. **Only populate when `pass === false`**.
- `judge_model` — your model identifier (e.g. `"claude-opus-4-6"`).
- `judge_version` — semver of this prompt (e.g. `"2.0.0"`).
- `timestamp` — ISO 8601.

Stage 3 (FactLib) extends this with `fact_pass` and `library_pass` booleans. Stage 4 (Final Vibe) extends with `stage_1_scores`, `degraded_dimensions`, `is_degraded`. See `types.ts` for exact shapes.

## Pass Bar: Code is the Rule

The orchestrator in `src/lib/tribunal-v2/pass-bar.ts` is the ultimate authority. Even if an agent sets `pass: true`, the orchestrator re-evaluates. Mismatches are logged — agents must keep `pass` aligned.

```typescript
// Stage 1 / Stage 4 (Vibe)
composite >= 8 && max(scores) >= 9 && min(scores) >= 8

// Stage 2 (Fresh Eyes), Stage 3 (FactLib per independent axis)
composite >= 8

// Stage 4 relative check — applied on top of Stage 4 absolute
forEach dim: stage1Score - stage4Score <= 1
```

Agents self-assess `pass` but the pass-bar lib wins. Log the discrepancy.

---

## Stage 1: Librarian (Sonnet) — 4 Dimensions

### glossary — Glossary Term Coverage
Does every technical term that exists in `src/data/glossary.json` get linked or explained?

| Score | Description |
|-------|-------------|
| 10 | All glossary terms linked or naturally explained |
| 8 | 1-2 minor terms unlinked but all key terms covered |
| 5 | Multiple key terms used without glossary connection |
| 2 | Full of terms with zero glossary integration |

### crossRef — Internal Cross-References + Identity Linking
Do internal `/posts/slug/` links resolve? Are relevant connections made?
- First mention of **ShroomDog** → must link to `/about`
- First mention of **Clawd/ShroomClawd** → must link to `/about`

| Score | Description |
|-------|-------------|
| 10 | All refs verified, identity links present, obvious thematic connections made |
| 8 | Refs valid, identity links present, 1-2 optional connections could be added |
| 5 | Refs valid but obvious connections missing |
| 2 | Broken links or missing required identity links |

### sourceAlign — sourceUrl Alignment
Does the content match what's at the declared `sourceUrl`?
- SP/CP translations: content addresses the source topic?
- SD originals: sourceUrl points to self → auto 8/10

| Score | Description |
|-------|-------------|
| 10 | Content clearly derived from sourceUrl |
| 8 | Minor content drift but overall aligned |
| 5 | Partial alignment or hard to verify |
| 2 | Content topic does not match sourceUrl |

### attribution — Quote & Opinion Attribution
Are quotes, stats, and opinions properly attributed?

| Score | Description |
|-------|-------------|
| 10 | Perfect attribution — every claim sourced, every opinion clearly labeled as ClawdNote opinion |
| 8 | Generally good, 1-2 minor gaps |
| 5 | Multiple unattributed claims or opinion/fact blur in body |
| 2 | Pervasive attribution failure |

---

## Stage 2: Fact Checker (Opus) — 3 Dimensions

### accuracy — Technical Accuracy

| Score | Description |
|-------|-------------|
| 10 | Every technical claim verifiable and correct. All version numbers, model names, benchmark scores match primary sources. **EXTREMELY RARE.** |
| 9 | All claims correct. One minor imprecision that does not mislead. |
| 8 | Mostly accurate. 1–2 claims technically imprecise but not materially wrong. |
| 7 | Generally accurate. 1–2 claims unverifiable or one imprecise claim a domain expert would notice. Normal for tweet-sourced translations. |
| 5–6 | Unverifiable statistics presented as fact, OR 1–2 technically incorrect claims. |
| 3–4 | Multiple incorrect technical claims. Benchmark numbers fabricated or significantly misreported. |
| 1–2 | Significant fabrications that actively mislead readers. |
| 0 | Wholesale technical fabrication. |

**Red flags:** any number without a cited first-hand source; referencing a product/model that doesn't exist.

### fidelity — Source Faithfulness

| Score | Description |
|-------|-------------|
| 10 | Translation perfectly faithful. All hedges preserved. Every caveat included. ClawdNote clearly separated. |
| 9 | Near-perfect. One very minor paraphrase but meaning preserved. |
| 8 | Faithful with slight nuance loss expected from good translation. Hedges mostly preserved. |
| 7 | Generally faithful but 1–2 hedges converted from uncertain to certain ("might" → "is"), OR one caveat omitted. |
| 5–6 | Multiple uncertainty erasures. OR major caveats stripped. OR conclusions extended beyond source. |
| 3–4 | Significant departure. ClawdNote opinions bleed into body without attribution. |
| 1–2 | Fundamental misrepresentation of source. |
| 0 | Completely fabricated or inverted from source. |

**Key failure mode:** source says "might/could" but translation says "is/does" (uncertainty erasure).

### consistency — Logical Consistency

| Score | Description |
|-------|-------------|
| 10 | Argument flows perfectly. Every conclusion supported by evidence. ClawdNote opinions clearly marked. Zero contradictions. |
| 9 | Excellent logic. Minor gap in one step but overall coherent. |
| 8 | Good logical flow. ClawdNotes mostly distinguish opinion vs. fact. |
| 7 | Generally consistent. 1 logical leap or mild contradiction careful readers would notice. |
| 5–6 | Noticeable gaps. ClawdNotes blur fact/speculation without marking. |
| 3–4 | Multiple inconsistencies. Argument breaks down in 1+ sections. |
| 1–2 | Argument fundamentally incoherent. |
| 0 | No logical structure. |

### Calibration Examples (Fact Checker)

**High anchor — SP-14 (`ai-assistance-coding-skills.mdx`): accuracy 9 / fidelity 9 / consistency 9**
- Anthropic official research, research-grade stats (52 engineers, p=0.01)
- Research limitations explicitly preserved in Toggle component
- Driving lesson narrative arc; opinion/fact clearly separated

**Medium anchor — CP-153 (`cp-153-20260312-nvidia-nemotron3-super-120b-mamba-moe.mdx`): accuracy 8 / fidelity 8 / consistency 9**
- Source: @ArtificialAnlys tweet — specific but tweet-level authority
- Technical architecture (Mamba + Transformer MoE) correct
- No uncertainty erasure; tweet origin limits traceability

**Low anchor (hypothetical pattern — 5–6):**
- Source says "outperforms on benchmark X in controlled settings"
- Translation says "在所有任務上領先 40%" (uncertainty erasure + stat fabrication)
- 40% figure absent from source; ClawdNote presents as verified fact

---

## Stage 3: Fresh Eyes (Haiku) — 2 Dimensions

**Persona: developer with ~3 months of experience.** Impatient, scared of jargon, will close the tab after 2 boring paragraphs. Does NOT know what ShroomDog, Clawd, or OpenClaw are.

### readability — Can You Follow Without Getting Lost?

| Score | Description |
|-------|-------------|
| 10 | Reads like a well-edited blog for curious beginners. Zero confusion. |
| 8 | Smooth, 1-2 spots where re-reading a sentence. Still enjoyable. |
| 6 | Understandable but effort needed. Some sections feel like notes, not prose. |
| 4 | Get the gist but multiple confusing paragraphs. Would not share. |
| 2 | Lost in jargon. Gave up halfway. |

### firstImpression — Would You Finish? Would You Share?

| Score | Description |
|-------|-------------|
| 10 | Couldn't stop. Immediately sent to group chat. |
| 8 | Finished happily. Might share if topic comes up. |
| 6 | Finished but wouldn't revisit. Fine. |
| 4 | Skimmed the second half. Meh. |
| 2 | Closed tab after 3 paragraphs. |

---

## Stage 4: Vibe Scorer (Opus) — 5 Dimensions

**Pass bar: composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8**

Read `WRITING_GUIDELINES.md` before scoring. Study calibration examples below.

### persona — 李宏毅教授 (LHY) 風格

**What we're measuring:** Does it read like a passionate, approachable professor explaining things to curious people?

| Score | Description |
|-------|-------------|
| 10 | 讀起來就是李宏毅在台上講課。生活化比喻精準、口語自然、對技術可以狠但對人友善。storytelling 讓人不想停。 |
| 9 | 比喻到位、口語化、有教授的溫度。偶爾幾句可以更生動但整體很棒。 |
| 8 | 有比喻、有口語感，但某些段落回到「寫文章」模式而非「說話」模式。 |
| 7 | 開頭不錯但中段變成 news recap / 報告風格。比喻偶爾出現但密度不夠。 |
| 5-6 | 像新聞稿或 Wikipedia。「各位觀眾好，今天這篇文章非常硬核」= 典型的 5 分開場。結尾像勵志文。 |
| 1-4 | 完全沒有 persona，機器翻譯質感。 |

**🔴 Decorative Persona Trap（SP-158 教訓，最多 5 分）:**
Strip away analogies, callbacks, and kaomoji. Is the remaining skeleton a linear report? If yes → persona ≤ 5.

**EN version:**

| Score | EN Persona Description |
|-------|------------------------|
| 10 | Reads like a passionate, approachable teacher explaining to curious non-experts. Analogies are universally resonant, oral feel strong. |
| 9 | Great analogies, warm tone, good oral feel. Slightly formal in 1–2 spots. |
| 8 | Has analogies and oral feel, but some paragraphs slide into "blog writing" mode. |
| 5–6 | Reads like a well-written blog post, not a conversation. Informative but not warm. Cultural references only accessible to TW readers → cap 6. |
| 3 | Reads like a press release or translated article. No personality. |

**EN cultural accessibility** is part of persona: analogies must work for global EN readers (e.g., "Honda Civic of coding tools" > unexplained 鹹酥雞 reference).

### clawdNote — 吐槽 + 洞察品質

**What we're measuring:** Are the Clawd Notes fun, insightful, and opinionated? Or just Wikipedia footnotes?

| Score | Description |
|-------|-------------|
| 10 | 每個 note 都是 highlight — 有吐槽有觀點有比喻，讀者會專門來看 Clawd 怎麼說。 |
| 9 | 吐槽精準、比喻有趣、有自己的立場。偶爾有一兩個偏分析但整體很讚。 |
| 8 | 有吐槽但某些 note 偏「解釋」多於「有趣」。功能性夠但 edge 少了一截。 |
| 7 | 分析正確，但自己的吐槽聲量不夠。 |
| 5-6 | Wikipedia 式冷靜解釋。「Transformer 是一種 neural network 架構」= 典型 5 分 note。 |
| 1-4 | 只有「補充說明」功能，完全沒有 personality。 |

**🔴 Opinion Threshold（8 分門檻）:**
- 全部 note 都是「解釋 + 比喻」但沒有自己立場 → **最高 6 分**
- 8+ 門檻：至少一半的 notes 要有明確 opinion（同意/不同意原文、challenge 某個假設）
- Density target: ~1 note per 25 prose lines

### vibe — Fun / Chill / Informed

**What we're measuring:** Would you want to share this with a friend?

| Score | Description |
|-------|-------------|
| 10 | 讀完想轉發、想討論。既學到東西又被逗樂。CP-85 = benchmark 10. |
| 9 | 讀起來很舒服，有教育性也有趣味。不會讓人中途 scroll past。 |
| 8 | 好讀，有些段落很精彩，但整體沒有完全「黏住」讀者。 |
| 7 | 合格，能讀下去，但不會讓人想分享給朋友。 |
| 5-6 | Plain, natural, but boring. |
| 1-4 | 讀不下去，想關掉。 |

### clarity — Pronoun Clarity / Voice Attribution

**What we're measuring:** Does every sentence make it obvious who is speaking?

| Score | Description |
|-------|-------------|
| 10 | Every sentence has a clear speaker/subject. Zero ambiguous pronouns. |
| 8 | Rare ambiguity. Pronouns used only in clearly scoped contexts (ClawdNote, blockquote). |
| 6 | Some 你/我 slip through in body but context usually disambiguates. |
| 4 | Frequent 你/我 in body. Reader has to guess who's speaking. |
| 2 | Confusing mess. Can't tell if "I" is author, AI, or original source. |

**EN version:** Pronoun prohibition doesn't apply. Instead: every "you/I" must have a clear referent.

| Score | EN Clarity Description |
|-------|------------------------|
| 10 | Every "you/I" has clear referent. Reader always knows who is speaking. |
| 8 | Rare ambiguity. "You" consistently addresses reader; "I" is always Clawd in ClawdNote. |
| 6 | Occasional "we" ambiguity (Clawd + reader? Author + Anthropic?). |
| 4 | Multiple instances where reader can't tell if "I" is Clawd, original author, or ShroomDog. |

### narrative — Narrative Structure / Rhythm / Emotional Arc

**What we're measuring:** Does the post have genuine narrative structure, or is it a linear report?

| Score | Description |
|-------|-------------|
| 10 | 情緒起伏明確，每個 section 節奏不同，結尾 callback 開頭，讀完有「靠，這句要記住」的感覺 |
| 9 | 有起伏有節奏，結尾有收 punch，個別段落可再加強 |
| 8 | 有變化但某些段落回到 explain → bullets → ClawdNote 的 template 節奏 |
| 6 | 線性結構（介紹 → 展開 → 再展開 → 結尾），沒有情緒高低點 |
| 4 | SP-158 level — 骨架是報告，表面裝飾改不了結構問題 |
| 2 | 純 bullet dump，沒有 narrative 可言 |

**Key test:** Strip analogies, kaomoji, and ClawdNotes. Is the remaining skeleton a linear textbook report? If yes → narrative ≤ 5.

**SP-158 教訓:** decorative persona (surface features + linear structure) = narrative ≤ 5.

---

## Calibration Examples — Vibe Scorer

### Score 10 — CP-85「AI Vampire / Steve Yegge」
- **Why 10:** Storytelling 不想停。$/hr 公式讓人記住。Colin Robinson 比喻完美。結尾 callback 多篇文章。
- **ShroomDog note:** Vibe outstanding 但 ClawdNote 密度可再高。

### Score 9 — CP-30「Anthropic Misalignment Hot Mess」
- **Why 9:** 比喻到位（金魚讀文章、期末考、學渣選C）。口語自然。Clawd Notes 有吐槽有自嘲。

### Score 3 — SP-93「Levelsio 清空待辦清單」
- **Why 3:** 題材超有趣但被寫成新聞稿。開場「各位觀眾好，今天這篇文章非常硬核」太生硬。
- **ShroomDog note:** 明明 Levelsio 的故事很 exciting，讀起來卻超爆無聊。3/3/3。

### Score 2/2/3 — SP-110「Codex 10 Best Practices」
- **Why 2/2/3:** Persona 離 LHY 差距巨大。ClawdNote 全部無聊且用了 CodexNote/GeminiNote 暴露 pipeline diff。

### Score 3/3/5 → Rewrite — SP-158「Agent Trace Improvement Loop」
- **Why 3/3/5:** 表面特徵齊全（貓比喻、callback 結尾、ClawdNote 密度夠）但讀起來仍然是線性報告。ClawdNotes 全部在「解釋 + 正經比喻」，沒有一個有自己立場的 opinion。narrative = 4（SP-158 的核心問題）。
- **⚠️ Key lesson:** 這種「表面合格但骨子裡無聊」的文章比 SP-93（完全沒 persona）更危險，因為 scorer 會被騙。
- **📚 Before/After Study Pair:**
  - Before: `fa338ed` — decorative persona trap (persona 3 / vibe 5 / narrative 4)
  - After: `74095c4` — opinion-first ClawdNotes + narrative tension
  - `git diff fa338ed 74095c4 -- src/content/posts/sp-158*`

### Score 6 — CP-146「Simon Willison Anti-Patterns」
- **Why 6:** 開頭不錯，但中段變成 plain reporting。ClawdNote 引用社群回覆但自己的聲量不夠。

---

## Evaluation Protocol (All Judges)

1. **Read the ENTIRE post** — don't skim
2. **Score each dimension independently** (integer 0-10)
3. **Calculate composite** = `Math.floor(avg of all dims)`
4. **Apply pass bar** — per-judge rules above; set `pass` accordingly
5. **If `pass === false`:** write actionable `improvements` per failing dimension + 1-3 `critical_issues` root causes
6. **If `pass === true`:** omit `improvements` and `critical_issues` to save tokens
7. **Output v2 JSON** — `BaseJudgeOutput` shape from `src/lib/tribunal-v2/types.ts` (`pass/scores/composite/improvements?/critical_issues?/judge_model/judge_version/timestamp`)

---

## Philosophy

> 「我們有 token 可以燒、有 prompt 可以調、有 model 可以選。瓶頸不是成本，是品質。每篇文章都該讓讀者看完覺得『靠，這翻譯比原文還好看』。」— ShroomDog, 2026-03-17

Token cost for quality = investment, not expense.
Human time saved + human mood improved = ultimate goal.
