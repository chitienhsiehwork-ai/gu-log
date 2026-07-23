# Tribunal Vibe Scoring Standard

> Golden standard for evaluating gu-log post quality.
> Tribunal v8 FreshEyes length-fit update calibrated 2026-05-27 by ShroomDog + Iris.
> **v9 (move-clarity-vibe-to-fresheyes):** `clarity` (pronoun / voice
> attribution) moved from the Vibe judge to **Fresh Eyes** and became a
> non-compensating hard gate. Vibe is now 4 dims, Fresh Eyes 5. This is
> **version-gated**: posts at `tribunalVersion >= 9` use the new ownership;
> `tribunalVersion <= 8` posts keep clarity under Vibe unchanged (no migration).
> **SSOT for judge scoring behavior and writer-facing evidence.** Runtime
> provider/model selection is intentionally outside this file; the authority
> pointers are listed under〈Model 變更的校準門檻〉。

## Tribunal System Overview

Tribunal pipeline — 4 stages. All judges use **uniform 0-10 integer scale**. Composite = `Math.floor(avg of all dims)`.

### Judge Responsibility Boundary (v8/v9)

- **Librarian owns corpus overlap and duplicate-attention evidence.** It checks whether gu-log already covered the same concept, whether the post cites/contrasts relevant older posts early enough, and whether repeated background should be compressed.
- **Fresh Eyes owns first-time reader fatigue.** It judges whether a human reader would skim, close the tab, or feel the article is longer than its information gain. **For v9+ it also owns `clarity`** (pronoun / voice attribution) as a non-compensating hard gate.
- **Vibe owns article-internal rhythm and shareability.** It does not do corpus search. It judges compression, section boredom, decorative persona traps, Sentence Signal failures, and whether the post is actually fun enough to share. **For v9+ it no longer scores `clarity`** (moved to Fresh Eyes); 晶晶體 still drags `vibe` down via the penalty matrix.
- **Writer consumes judge evidence.** Librarian overlap evidence must trigger early citation/compression; FreshEyes fatigue must trigger structural shortening; Vibe rhythm failures must trigger a new spine, not extra jokes.

| Stage | Judge | Dimensions | Pass Bar |
|-------|-------|------------|----------|
| 1 | Fact Checker | accuracy · fidelity · consistency · sourceBoundary · commentarySeparation | fact core avg ≥ 8 AND sourceBoundary ≥ 8 AND commentarySeparation ≥ 8 |
| 2 | Librarian | glossary · crossRef · sourceAlign · attribution | composite ≥ 8 |
| 3 | Fresh Eyes | readability · firstImpression · payoffDensity · lengthFit · **clarity** (v9+) | composite ≥ 8 AND payoffDensity ≥ 8 AND lengthFit ≥ 8 AND **clarity ≥ 8** (v9+) |
| 4 | Vibe | persona · moguNote · vibe · narrative (v9; legacy v8 also had clarity) | composite ≥ 8 AND one dim ≥ 9 AND no dim < 8 |

## Uniform Agent Output JSON

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
  "judge_model": "<runtime-model-id>",
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
- `judge_model` — report the runtime model identifier if known. The runner's
  dynamic provenance stamp is authoritative; this example is not selector
  configuration.
- `judge_version` — semver of this prompt (e.g. `"2.0.0"`).
- `timestamp` — ISO 8601.

The shell runtime normalizes legacy `scores`/`composite` output into this uniform JSON shape before validation.

## Pass Bar: Code is the Rule

The orchestrator in `src/lib/tribunal-v2/pass-bar.ts` is the ultimate authority. Even if an agent sets `pass: true`, the orchestrator re-evaluates. Mismatches are logged — agents must keep `pass` aligned.

```typescript
// Vibe
composite >= 8 && max(scores) >= 9 && min(scores) >= 8

// Fresh Eyes, Librarian
composite >= 8

// Fact Checker v7
floor(avg(accuracy, fidelity, consistency)) >= 8
sourceBoundary >= 8
commentarySeparation >= 8
```

Agents self-assess `pass` but the pass-bar lib wins. Log the discrepancy.

---

## Stage 2: Librarian — 4 Dimensions

### glossary — Glossary Term Coverage
Does every technical term that exists in `src/data/glossary.json` get linked or explained?

| Score | Description |
|-------|-------------|
| 10 | All glossary terms linked or naturally explained |
| 8 | 1-2 minor terms unlinked but all key terms covered |
| 5 | Multiple key terms used without glossary connection |
| 2 | Full of terms with zero glossary integration |

### crossRef — Internal Cross-References + Corpus Overlap
Does internal `/posts/slug/` links resolve? Are relevant connections made? Does the post avoid making readers re-read gu-log content that already exists?
- First mention of **ShroomDog** → must link to `/about`
- First mention of **Mogu/Mogu** → must link to `/about`
- When an older gu-log post already covers the same core workflow/concept, the new post must cite or contrast it early enough that readers understand what is new.
- If overlap is substantial, Librarian must name the old post(s), the repeated sections, and the required writer action: early cite, one-sentence recap, compression, contrast, merge, or rejection.

| Score | Description |
|-------|-------------|
| 10 | All refs verified, identity links present, obvious thematic connections made, and overlapping old posts are cited/contrasted early with clear new angle |
| 8 | Refs valid and important overlap handled, but 1-2 optional connections or compression opportunities remain |
| 5 | Refs valid but obvious connections missing, or repeated background makes the post feel redundant without enough early contrast |
| 2 | Broken links, missing required identity links, or same core claim/workflow repeated with no useful citation/contrast |

### sourceAlign — sourceUrl Alignment
Does the content match what's at the declared `sourceUrl`?
- GP/MP translations: content addresses the source topic?
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
| 10 | Perfect attribution — quotes/stats/evidence limits are clear, and gu-log/Mogu opinions stay in MoguNote |
| 8 | Generally good, 1-2 minor gaps |
| 5 | Multiple unattributed claims or opinion/fact blur in body |
| 2 | Pervasive attribution failure |

---

## Tribunal v8 Calibration References

Known false-positive examples live under `.codex/agents/references/`. Judges should treat these as calibration fixtures, not live article instructions.

- `.codex/agents/references/gp-187-v7-false-positive.md` points to the exact git commit/blob for the rejected GP-187 sample and MP-179 overlap target. Use it to remember why v7 exists: Librarian must catch MP-179 overlap, FreshEyes must catch reader fatigue, and Vibe must not award `vibe 8 / narrative 9` to a long linear-report skeleton.

## Stage 1: Fact Checker — 5 Dimensions

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
| 10 | Translation perfectly faithful. All hedges preserved. Every caveat included. MoguNote clearly separated. |
| 9 | Near-perfect. One very minor paraphrase but meaning preserved. |
| 8 | Faithful with slight nuance loss expected from good translation. Hedges mostly preserved. |
| 7 | Generally faithful but 1–2 hedges converted from uncertain to certain ("might" → "is"), OR one caveat omitted. |
| 5–6 | Multiple uncertainty erasures. OR major caveats stripped. OR conclusions extended beyond source. |
| 3–4 | Significant departure. MoguNote opinions bleed into body without attribution. |
| 1–2 | Fundamental misrepresentation of source. |
| 0 | Completely fabricated or inverted from source. |

**Key failure mode:** source says "might/could" but translation says "is/does" (uncertainty erasure).

### consistency — Logical Consistency

| Score | Description |
|-------|-------------|
| 10 | Argument flows perfectly. Every conclusion supported by evidence. MoguNote opinions clearly marked. Zero contradictions. |
| 9 | Excellent logic. Minor gap in one step but overall coherent. |
| 8 | Good logical flow. MoguNotes mostly distinguish opinion vs. fact. |
| 7 | Generally consistent. 1 logical leap or mild contradiction careful readers would notice. |
| 5–6 | Noticeable gaps. MoguNotes blur fact/speculation without marking. |
| 3–4 | Multiple inconsistencies. Argument breaks down in 1+ sections. |
| 1–2 | Argument fundamentally incoherent. |
| 0 | No logical structure. |

### sourceBoundary — GP Body Source Boundary

GP readers already see `原文出處：`. GP body should not waste flow on source-meta scaffolding like 「原作者說」「原文提到」「這篇文章在講」 or English equivalents. Present source claims directly, preserving hedges and evidence boundaries in natural prose. Evidence boundaries should be contextual and reader-respecting, not legalistic disclaimers like 「不是公開 benchmark」「僅供參考」「不是保證所有人都能做到」 unless the claim is genuinely high-risk (benchmark, finance, medical, safety, legal, company revenue, or decision-critical numbers).

| Score | Description |
|-------|-------------|
| 10 | Body has no source-meta scaffolding; evidence boundaries are smooth, contextual, and do not talk down to the reader. |
| 8 | Mostly clean; 1–2 small source-meta slips. |
| 6 | Repeated 「原作者說 / 原文提到」 transitions make the post feel like a report. |
| 4 | Source-report framing shapes multiple sections. |
| 2 | Body mostly narrates the source instead of translating/explaining it. |

### commentarySeparation — Commentary Separation

Mogu/gu-log opinions, interpretation, jokes, and source-meta commentary belong in `<MoguNote>`, not GP body.

| Score | Description |
|-------|-------------|
| 10 | Body stays source-derived; Mogu/gu-log stance and source-meta commentary live in MoguNote. |
| 8 | Mostly separated; 1–2 body sentences should move into MoguNote. |
| 6 | Several body opinions blur gu-log interpretation with source claims. |
| 4 | Reader must guess whether a claim comes from source or gu-log. |
| 2 | Commentary and source claims are heavily mixed. |

### Calibration Examples (Fact Checker)

**High anchor — GP-14 (`ai-assistance-coding-skills.mdx`): accuracy 9 / fidelity 9 / consistency 9**
- Anthropic official research, research-grade stats (52 engineers, p=0.01)
- Research limitations explicitly preserved in Toggle component
- Driving lesson narrative arc; opinion/fact clearly separated

**Medium anchor — MP-153 (`mp-153-20260312-nvidia-nemotron3-super-120b-mamba-moe.mdx`): accuracy 8 / fidelity 8 / consistency 9**
- Source: @ArtificialAnlys tweet — specific but tweet-level authority
- Technical architecture (Mamba + Transformer MoE) correct
- No uncertainty erasure; tweet origin limits traceability

**Low anchor (hypothetical pattern — 5–6):**
- Source says "outperforms on benchmark X in controlled settings"
- Translation says "在所有任務上領先 40%" (uncertainty erasure + stat fabrication)
- 40% figure absent from source; MoguNote presents as verified fact

---

## Stage 3: Fresh Eyes — readability · firstImpression · payoffDensity · lengthFit · clarity (v9; v8 had no clarity)

**Persona: developer with ~3 months of experience.** Impatient, scared of jargon, will close the tab after 2 boring paragraphs. Does NOT know what ShroomDog, Mogu, or OpenClaw are.

**Pass bar (v9+):** composite ≥ 8 AND payoffDensity ≥ 8 AND lengthFit ≥ 8 AND **clarity ≥ 8** — all three are non-compensating hard gates. (v8 had only payoffDensity / lengthFit gates and no clarity.)

### readability — Can You Follow Without Getting Lost?

| Score | Description |
|-------|-------------|
| 10 | Reads like a well-edited blog for curious beginners. Zero confusion. |
| 8 | Smooth, 1-2 spots where re-reading a sentence. Still enjoyable. |
| 6 | Understandable but effort needed. Some sections feel like notes, not prose. |
| 4 | Get the gist but multiple confusing paragraphs. Would not share. |
| 2 | Lost in jargon. Gave up halfway. |

**Unexplained-acronym rule:** an unexplained marketing / PM / business acronym the 3-month-engineer persona may not know (CTA, MVP, ICP, TAM, ARR, CAC, …) is a readability snag — cap `readability` at 7 for one, 6 if several. Note `scripts/check-jingjing.mjs` auto-allows any ≤6-char all-caps token as an "acronym," so the deterministic 晶晶體 lint will never catch these — Fresh Eyes is the judge that has to. (Universally-understood tech acronyms like API/SDK/CLI/MCP are fine; this is about jargon outside the reader's domain.)

### firstImpression — Would You Finish? Would You Share?

| Score | Description |
|-------|-------------|
| 10 | Couldn't stop. Immediately sent to group chat. |
| 8 | Finished happily. Might share if topic comes up. |
| 6 | Finished but wouldn't revisit. Fine. |
| 4 | Skimmed the second half. Meh. |
| 2 | Closed tab after 3 paragraphs. |

**Reader-fatigue rule:** Fresh Eyes does not do corpus search; Librarian owns old-post overlap evidence. But if the article itself repeatedly re-explains basics, spends multiple sections in recap mode, or feels longer than its information gain, cap `firstImpression` at 7. If a smart beginner can summarize the next section before reading it because the rhythm is predictable, cap `readability` or `firstImpression` at 6.

**Metaphor mapping-reset gate:** A metaphor should let the reader reuse one mental map. If the post moves among more than three independent metaphor systems, or repeatedly recasts the same actors into new roles, the reader must rebuild that map instead. Cap `readability` at 6 and `payoffDensity` at 7; the stage must fail. Three is a ceiling, not a target. One planned metaphor carried consistently is ideal, and direct prose with no metaphor is valid. Do not penalize a brief comparison that clearly extends the same mapping; flag a new system only when roles or causal relationships must be remapped.

**Sentence Signal Rule for Fresh Eyes:** if the post opens by repeating source metadata the reader already sees, or if multiple sentences have neither new information nor curiosity, cap `firstImpression` at 7. A smart impatient beginner does not reward throat-clearing.

### clarity — Pronoun Clarity / Voice Attribution (v9+ — moved here from Vibe)

**What we're measuring:** Does every sentence make it obvious who is speaking? This is a SEPARATE axis from readability — prose can flow smoothly yet still leave a stranger unsure whether a line is the author's opinion, the source author's claim, or an aside. Non-compensating hard gate (clarity < 8 fails the stage). For `tribunalVersion <= 8` this dimension lived under Vibe and is NOT scored here.

| Score | Description |
|-------|-------------|
| 10 | Every sentence has a clear speaker/subject. Zero ambiguous pronouns. |
| 8 | Rare ambiguity. Pronouns used only in clearly scoped contexts (MoguNote, blockquote). |
| 6 | Some 你/我 slip through in body but context usually disambiguates. |
| 4 | Frequent 你/我 in body. Reader has to guess who's speaking. |
| 2 | Confusing mess. Can't tell if "I" is author, AI, or original source. |

**EN version:** Pronoun prohibition doesn't apply. Instead: every "you/I" must have a clear referent.

| Score | EN Clarity Description |
|-------|------------------------|
| 10 | Every "you/I" has clear referent. Reader always knows who is speaking. |
| 8 | Rare ambiguity. "You" consistently addresses reader; "I" is always Mogu in MoguNote. |
| 6 | Occasional "we" ambiguity (Mogu + reader? Author + Anthropic?). |
| 4 | Multiple instances where reader can't tell if "I" is Mogu, original author, or ShroomDog. |

**晶晶體 boundary:** for zh-tw posts, decorative-English mixing also hurts clarity, but cite the canonical programmatic gate `scripts/check-jingjing.mjs` rather than inventing a penalty for allowlisted words (model names, tool names, glossary terms, `vs`/`bug`/`commit`/`PR`). Penalize only when the checker reports a violation or its output is in the evidence packet.

---

## Stage 4: Vibe Scorer (Opus-calibrated rubric) — persona · moguNote · vibe · narrative (v9; legacy v8 also had clarity)

**Pass bar: composite ≥ 8 AND at least one dimension ≥ 9 AND no dimension < 8**

Read `GU-LOG_WRITER_PROMPT.md` before scoring. Study calibration examples below.

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

**🔴 Decorative Persona Trap（GP-158 教訓，最多 5 分）:**
Strip away analogies, callbacks, and kaomoji. Is the remaining skeleton a linear report? If yes → persona ≤ 5.

**🔴 AI-Tell Trap（GP-232 教訓，密度型扣分）:**
跨多代模型都會出現的「AI 腔」簽名；換 model 不會自動消失，只有這一關擋得住。重點是**密度 + 是否 reflexive**，不是單次出現：承載 thesis 或笑點的單次用法是 earned，**保留**；句型慣性的反射用法是 filler，**扣分**。
- **T1 反義對偶過載**：「不是 X，是 Y」「不在 X，在 Y」當每段收尾的反射動作。承載論點的 1–2 次保留；通篇靠它製造「金句感」→ 3 次以上 reflexive 用法 persona ≤ 7。
- **T2 假深度 reframe**：「表面是 X，真正/深層才是 Y」「聽起來像 X，但其實 Y」「透露的訊息比表面更深」——用 scaffolding 假裝多給一層解讀。出現在多數 MoguNote → persona ≤ 6。
- **T3 空洞強化詞**：「拆得很乾淨 / 很漂亮 / 到位 / 精準」「這才是工程品味」這種沒有具體資訊、只負責讓句子聽起來收得漂亮的 flourish。要求改成具體內容；多處未改 → persona ≤ 7。
- **T4 mic-drop 打燈**：每個 section 都用一句單獨成段的「人生哲理」收尾。偶一為之 OK；變成固定收法 → 連同 narrative 一起看 template 節奏。

一句話判準：**earned（承載論點/笑點）留，reflexive（句型慣性）殺。**

**EN version:**

| Score | EN Persona Description |
|-------|------------------------|
| 10 | Reads like a passionate, approachable teacher explaining to curious non-experts. Analogies are universally resonant, oral feel strong. |
| 9 | Great analogies, warm tone, good oral feel. Slightly formal in 1–2 spots. |
| 8 | Has analogies and oral feel, but some paragraphs slide into "blog writing" mode. |
| 5–6 | Reads like a well-written blog post, not a conversation. Informative but not warm. Cultural references only accessible to TW readers → cap 6. |
| 3 | Reads like a press release or translated article. No personality. |

**EN cultural accessibility** is part of persona: analogies must work for global EN readers (e.g., "Honda Civic of coding tools" > unexplained 鹹酥雞 reference).

### moguNote — 吐槽 + 洞察品質

**What we're measuring:** Are the Mogu Notes fun, insightful, and opinionated? Or just Wikipedia footnotes?

| Score | Description |
|-------|-------------|
| 10 | 每個 note 都是 highlight — 有吐槽有觀點有比喻，讀者會專門來看 Mogu 怎麼說。 |
| 9 | 吐槽精準、比喻有趣、有自己的立場。偶爾有一兩個偏分析但整體很讚。 |
| 8 | 有吐槽但某些 note 偏「解釋」多於「有趣」。功能性夠但 edge 少了一截。 |
| 7 | 分析正確，但自己的吐槽聲量不夠。 |
| 5-6 | Wikipedia 式冷靜解釋。「Transformer 是一種 neural network 架構」= 典型 5 分 note。 |
| 1-4 | 只有「補充說明」功能，完全沒有 personality。 |

**🔴 Opinion Threshold（8 分門檻）:**
- 全部 note 都是「解釋 + 比喻」但沒有自己立場 → **最高 6 分**
- 8+ 門檻：至少一半的 notes 要有明確 opinion（同意/不同意原文、challenge 某個假設）
- Density target: ~1 note per 25 prose lines

**🪞 Self-referential callback（自我指涉）= moguNote 的高分訊號:**
- 當原文講的東西 gu-log 自己也在做（對抗式 review → gu-log 的 tribunal；長跑 agent → pipeline；把教訓寫回指令 → playbook/prompt），一個把它接回 gu-log 自身、且**誠實**的 callback 是 highlight 級的 note——尤其敢自嘲的 meta（例：「你正在讀的這篇就是被 gu-log 四法官審過、拿 sub-8、還掛精修中 badge」）。真誠又貼題的 self-ref 可以是某個 note 上 9-10 的理由。
- **但這不是免費加分**：硬塞、不貼題、純自誇（「順帶一提 gu-log 超強」）是 cringe，反而是 persona/vibe 的扣分項。callback 必須真實 + 自然 + 服務當下論點，否則寧可不放。判準：拿掉這個 self-ref，note 還成立嗎？成立才放。

### vibe — Fun / Chill / Informed

**What we're measuring:** Would you want to share this with a friend?

| Score | Description |
|-------|-------------|
| 10 | 讀完想轉發、想討論。既學到東西又被逗樂。MP-85 = benchmark 10. |
| 9 | 讀起來很舒服，有教育性也有趣味。不會讓人中途 scroll past。 |
| 8 | 好讀，有些段落很精彩，但整體沒有完全「黏住」讀者。 |
| 7 | 合格，能讀下去，但不會讓人想分享給朋友。 |
| 5-6 | Plain, natural, but boring. |
| 1-4 | 讀不下去，想關掉。 |

**Sentence Signal Rule:** every sentence must be informative or intriguing. If a sentence only repeats source metadata, throat-clears, or restates what the reader already sees in the byline/source block, it is dead weight. Multiple dead sentences cap vibe at 7; a dead opening usually means the post should fail unless the rest recovers hard.

**Compression gate:** Vibe does not perform corpus-overlap search; that belongs to Librarian. Vibe does ask whether the article is internally loose. If 25–40% of prose could be deleted without losing meaningful information, cap `vibe` at 7. If a section mostly restates earlier sections with different packaging, cap `vibe` at 6 even when facts are correct.

**Section-boredom gate:** inspect section rhythm. If two or more consecutive sections follow the same report template (`explain → quote → translate/explain → MoguNote`) without a fresh turn, surprise, scene, or opinionated point, cap `narrative` at 6. Adding more jokes or kaomoji does not fix a boring skeleton.

**Metaphor coherence gate:** Count independent metaphor systems, not decorative words. If the article uses more than three, or repeatedly reassigns the same actors across unrelated worlds, cap `narrative` at 6; the stage must fail. A high score requires either direct prose or one planned core metaphor whose mapping remains stable from setup through payoff. Extra analogies do not compensate for a weak spine and must not inflate `persona`.

**Corpus boundary:** If Librarian evidence says the post overlaps an older gu-log piece, Vibe may use that evidence only to judge the current article's pacing and redundancy. Vibe must not invent or own the old-post search.

**晶晶體 boundary:** Vibe Scorer must not invent its own English-term lint. For zh-tw posts, `scripts/check-jingjing.mjs` is the canonical programmatic gate and allowlist. If the checker returns clean, do not penalize accepted engineering terms such as `vs`, `bug`, `commit`, `PR`, model names, tool names, or glossary terms as hard-policy 晶晶體 hits. Penalize decorative English mixing only when the checker reports a violation, or when deterministic checker output is included in the evidence packet. The accepted-English boundary SHALL be discussed with ShroomDog every time a term is added to or removed from the checker/glossary acceptance set, because this boundary directly affects reading flow and only ShroomDog can decide which English terms feel natural in gu-log zh-tw prose.

> **Note (v9):** the `clarity` dimension moved to **Stage 3 Fresh Eyes** — see
> its rubric there. For `tribunalVersion <= 8` posts clarity was scored here.

### narrative — Narrative Structure / Rhythm / Emotional Arc

**What we're measuring:** Does the post have genuine narrative structure, or is it a linear report?

| Score | Description |
|-------|-------------|
| 10 | 情緒起伏明確，每個 section 節奏不同，結尾 callback 開頭，讀完有「靠，這句要記住」的感覺 |
| 9 | 有起伏有節奏，結尾有收 punch，個別段落可再加強 |
| 8 | 有變化但某些段落回到 explain → bullets → MoguNote 的 template 節奏 |
| 6 | 線性結構（介紹 → 展開 → 再展開 → 結尾），沒有情緒高低點 |
| 4 | GP-158 level — 骨架是報告，表面裝飾改不了結構問題 |
| 2 | 純 bullet dump，沒有 narrative 可言 |

**Key test:** Strip analogies, kaomoji, and MoguNotes. Is the remaining skeleton a linear textbook report? If yes → narrative ≤ 5.

**Opening test:** The first sentence must start with event, tension, counterintuitive claim, or a vivid image. Openings like 「原作者這篇分析文講了一個……」 / "This article discusses..." repeat source metadata and should cap narrative at 7.

**GP-158 教訓:** decorative persona (surface features + linear structure) = narrative ≤ 5.

---

## Calibration Examples — Vibe Scorer

### Score 10 — MP-85「AI Vampire / Steve Yegge」
- **Why 10:** Storytelling 不想停。$/hr 公式讓人記住。Colin Robinson 比喻完美。結尾 callback 多篇文章。
- **ShroomDog note:** Vibe outstanding 但 MoguNote 密度可再高。

### Score 9 — MP-30「Anthropic Misalignment Hot Mess」
- **Why 9:** 比喻到位（金魚讀文章、期末考、學渣選C）。口語自然。Mogu Notes 有吐槽有自嘲。

### Score 3 — GP-93「Levelsio 清空待辦清單」
- **Why 3:** 題材超有趣但被寫成新聞稿。開場「各位觀眾好，今天這篇文章非常硬核」太生硬。
- **ShroomDog note:** 明明 Levelsio 的故事很 exciting，讀起來卻超爆無聊。3/3/3。

### Score 2/2/3 — GP-110「Codex 10 Best Practices」
- **Why 2/2/3:** Persona 離 LHY 差距巨大。MoguNote 全部無聊且用了 CodexNote/GeminiNote 暴露 pipeline diff。

### Score 3/3/5 → Rewrite — GP-158「Agent Trace Improvement Loop」
- **Why 3/3/5:** 表面特徵齊全（貓比喻、callback 結尾、MoguNote 密度夠）但讀起來仍然是線性報告。MoguNotes 全部在「解釋 + 正經比喻」，沒有一個有自己立場的 opinion。narrative = 4（GP-158 的核心問題）。
- **⚠️ Key lesson:** 這種「表面合格但骨子裡無聊」的文章比 GP-93（完全沒 persona）更危險，因為 scorer 會被騙。
- **📚 Before/After Study Pair:**
  - Before: `fa338ed` — decorative persona trap (persona 3 / vibe 5 / narrative 4)
  - After: `74095c4` — opinion-first MoguNotes + narrative tension
  - `git diff fa338ed 74095c4 -- ':(glob)src/content/posts/*-158*'`

### Score 6 → 8 — GP-192「Codex Goals / Ralph Loop」
- **Why before 6:** 初版 facts 沒錯，但把 Jarrod 原文的刀口磨平成「長跑 Agent 需要結構」的通用教學。骨架是 Ralph Loop → 三個洞 → 工程流程，缺少 Codex Goals 解剖帶來的 tension；讀者看完知道要做事前釐清、多 Agent、外部記憶，但不會記得「Codex Goals 解的是不要熄火，不是不要迷路」。
- **Why after 8:** 重寫後把主軸改成 Codex Goals 產品化 Ralph Loop，但只解決續航；真正的問題是長跑 Agent 可以不休息地跑偏。三個補件（訪談、多 Agent、新脈絡、外部記憶）不再像清單，而是一路回答「如何避免勤奮地跑偏」。
- **⚠️ Key lesson:** Source fidelity 不只是 facts 對不對；原文的「刀口」也要保留。把尖銳 critique 寫成 generic best practices，即使每句都正確，vibe 也會塌。
- **📚 Before/After Study Pair:**
  - Before: `c8fd389b` — generic long-running-agent structure (vibe 6 after strict scorer; initial article had 8-ish surface scores but weak source knife)
  - After: `c9e332e1` — Codex Goals tension + endurance-vs-direction spine (vibe 8)
  - `git diff c8fd389b c9e332e1 -- ':(glob)src/content/posts/*-192*'`

### 綜合五分的標準 — GP-175「Opus 4.7 prompting cheat sheet」
- **為什麼是五分（7/8/7/9/7，composite 7 FAIL）:** GP-175 是 cheat sheet 偽裝成 blog post 的典型案例。表面有比喻（tokenizer 房東換租金、effort 咖啡機粗細、snippet 換合約夥伴）、有 MoguNote、有 kaomoji —— 所有 decorative 特徵齊全。但骨架是教科書：三件必知大事 → Effort 五級階梯 → 4.6→4.7 行為差異 → 可 copy 的 prompt snippets。**拿掉比喻之後就是 release notes**。
- **Scorer 判讀差異（2026-04-17 跨版本實驗）**：
  - Opus 4.6 scorer: composite 7 FAIL — 抓到 "effort ladder and snippets sections revert to reference-doc mode — listing 5 levels in order and pasting code blocks is writing, not talking"、"readers bookmark it, not share it for fun"
  - Opus 4.7 scorer: composite 8 PASS — reasons 裡看到了同樣問題（「偏實用 cheat sheet 寫法」「snippet 集錦那段偏 reference dump」「結尾偏 checklist」）**但沒扣分**。典型 bar drift。
  - Opus 4.5 scorer: composite 8 PASS — 也沒扣到 FAIL。
- **⚠️ 最關鍵的教訓 — 這就是 decorative persona trap 的 2026 年版本**：GP-158 是「貓比喻 + 正經 MoguNote」偽裝，GP-175 是「房東/咖啡機比喻 + 有立場 MoguNote」偽裝。比 GP-158 更難抓，因為 MoguNote 真的有 opinion。但骨架一樣 linear。
- **Strip test 怎麼做**：遮住所有 `<MoguNote>` 區塊、遮住段落裡的第一個比喻句，只讀剩下的 body。如果讀起來像 release notes / cheat sheet / reference doc，narrative 就 ≤ 5。GP-175 通過 strip test 就是一份 release notes。

### Score 6 — MP-146「Simon Willison Anti-Patterns」
- **Why 6:** 開頭不錯，但中段變成 plain reporting。MoguNote 引用社群回覆但自己的聲量不夠。

---

## Evaluation Protocol (All Judges)

1. **Read the ENTIRE post** — don't skim
2. **Respect v8 judge boundaries** — Librarian owns corpus overlap; Fresh Eyes owns reader fatigue; Vibe owns internal rhythm/shareability; Writer consumes evidence instead of inventing new scope
3. **Score each dimension independently** (integer 0-10)
4. **Calculate composite** = `Math.floor(avg of all dims)`
5. **Apply pass bar** — per-judge rules above; set `pass` accordingly
6. **If `pass === false`:** write actionable `improvements` per failing dimension + 1-3 `critical_issues` root causes
7. **If `pass === true`:** omit `improvements` and `critical_issues` to save tokens
8. **Output v2 JSON** — `BaseJudgeOutput` shape from `src/lib/tribunal-v2/types.ts` (`pass/scores/composite/improvements?/critical_issues?/judge_model/judge_version/timestamp`)

---

## Model 變更的校準門檻

本文件只定義 rubric，不定義 runtime provider 或 model ID。不要在這裡
複製現行 model 快照；實際 selection、fallback 與 provenance 由下列
authority 決定：

| Contract | Authority |
|----------|-----------|
| Per-judge provider policy | `openspec/specs/codex-tribunal-runtime/spec.md` + `tribunal_judge_provider()` |
| Claude model selector | `.claude/agents/<role>.md` 第一段 frontmatter 的 `model:` |
| Codex model selector | `GP_CODEX_MODEL` + `tribunal_codex_exec()` |
| Writer mode / provider | `tribunal_writer_mode()` + `tribunal_writer_exec()` |
| 實際執行 provenance | `tribunal_write_actual_provider()` + `run_stage()` |
| 評分維度與 pass bar | 本文件 + `src/lib/tribunal-v2/pass-bar.ts` |

`TRIBUNAL_FORCE_PROVIDER`、availability 與 quota fallback 的互動也以
`scripts/tribunal-helpers.sh` 的行為與 contract tests 為準，不在散文複述。

### 歷史 false-positive calibration

- **GPT-5.5 / Tribunal v5** 曾給 GP-187 `vibe: 8 / narrative: 9`，但 ShroomDog 人工判定「太長、廢話太多、重複 MP-179，而且『變基』語感很糟」。v7 修正責任邊界：Librarian 抓 MP-179 overlap；Vibe 抓 compression / section boredom / decorative pass trap；FreshEyes 抓讀者疲勞。

任何 scorer 都必須繼承這些 calibration 教訓，不能只逐項勾表面特徵。

### 修改 model 配置的流程

1. **提出假設**：說明為什麼想換 model（例如新版本在某任務上更好）
2. **A/B 測試**：用同一篇文章跑新舊 model，比較分數和 reasons
3. **人工驗證**：人看兩份 reasons，判斷哪個更準確
4. **更新 runtime SSOT**：只修改對應 authority 與 contract tests；只有 rubric 或 calibration 結論改變時，才更新本文件

---

## Philosophy

> 「我們有 token 可以燒、有 prompt 可以調、有 model 可以選。瓶頸不是成本，是品質。每篇文章都該讓讀者看完覺得『靠，這翻譯比原文還好看』。」— ShroomDog, 2026-03-17

Token cost for quality = investment, not expense.
Human time saved + human mood improved = ultimate goal.
