# Tribunal Calibration Research

> Researcher: Claude Code (Sonnet 4.6)
> Date: 2026-04-08
> For: planner-metrics — tribunal-design team

---

## Part 1: Fact Checker Calibration

### Current State Assessment

The current `fact-checker.md` agent uses an **asymmetric scale**:
- Technical Accuracy: 0–4
- Source Faithfulness: 0–3
- Logical Consistency: 0–3
- Total: 0–10

This creates confusion when comparing dimension scores. The proposed change is to **all dimensions → 0–10**, which needs new anchor descriptions per dimension.

### 0–10 Scale Anchor Descriptions

#### technicalAccuracy (0–10)

| Score | Description | Signal |
|-------|-------------|--------|
| 10 | Every technical claim verifiable and correct. All version numbers, model names, architectures, benchmark scores match primary sources or traceable first-hand citations. Zero fabricated numbers. | "Score 10 is EXTREMELY RARE" — same principle applies |
| 9 | All claims correct. One minor imprecision (e.g., ballpark rounding) that does not mislead. |  |
| 8 | Mostly accurate. Contains 1–2 claims that are technically imprecise but not materially wrong (e.g., paraphrasing an architecture without being incorrect). |  |
| 7 | Generally accurate. 1–2 claims unverifiable from source, or 1 technically imprecise claim a domain expert would notice. Normal for tweet-sourced translations. |  |
| 5–6 | Has unverifiable statistics presented as fact, OR 1–2 technically incorrect claims. May reference model capabilities that are exaggerated vs. actual source. | Red flag: number without cited first-hand source |
| 3–4 | Multiple incorrect technical claims. Or references product/version that doesn't exist. Benchmark numbers fabricated or significantly misreported. | Red flag: non-existent model names |
| 1–2 | Significant fabrications that actively mislead readers about how something works. |  |
| 0 | Wholesale technical fabrication. |  |

#### sourceFidelity (0–10)

| Score | Description | Signal |
|-------|-------------|--------|
| 10 | Translation perfectly faithful. All hedges preserved (might/could/seems → 可能/或許/似乎). Every caveat, limitation, disclaimer included. No added claims. ClawdNote clearly separated. |  |
| 9 | Near-perfect faithfulness. One very minor paraphrase but meaning preserved. Hedges maintained. |  |
| 8 | Faithful with slight nuance loss expected from good translation. Hedges mostly preserved. Limitations section present even if abbreviated. | Normal good translation |
| 7 | Generally faithful but 1–2 hedges converted from uncertain to certain ("might" → "is/will"), OR one minor caveat omitted. |  |
| 5–6 | Multiple instances of uncertainty erasure. OR major caveats/limitations stripped. OR conclusions extended beyond what source supports. | Key failure mode |
| 3–4 | Significant departure from source interpretation. ClawdNote opinions bleed into body without attribution. Or source's argument substantially changed. |  |
| 1–2 | Fundamental misrepresentation of source material. Inverts source's conclusions or stance. |  |
| 0 | Completely fabricated or inverted from source. |  |

#### logicalConsistency (0–10)

| Score | Description | Signal |
|-------|-------------|--------|
| 10 | Argument flows perfectly. Every conclusion supported by evidence presented. ClawdNote opinions clearly marked as speculation/opinion. Zero internal contradictions. |  |
| 9 | Excellent logic. Minor gap in one reasoning step but overall coherent and well-structured. |  |
| 8 | Good logical flow. ClawdNotes mostly mark opinion vs. fact clearly. Occasional leap is minor. |  |
| 7 | Generally consistent. Has 1 logical leap or mild contradiction that careful readers would notice. |  |
| 5–6 | Noticeable logical gaps. ClawdNotes blur fact/speculation without marking. OR conclusion doesn't fully follow from evidence presented. |  |
| 3–4 | Multiple logical inconsistencies. Argument structure breaks down in 1+ sections. |  |
| 1–2 | Argument is fundamentally incoherent. Reader cannot follow the logical chain. |  |
| 0 | No logical structure. |  |

---

### Recommended Calibration Articles

#### Anchor 1: Score 9 — SP-14 (`ai-assistance-coding-skills.mdx`)

**Why this is the high anchor:**

- **Source**: Anthropic official research page (not a tweet — directly verifiable)
- **Specificity**: Cites `52 engineers`, `50% vs 67%`, `Cohen's d=0.738, p=0.01` — all precise, research-grade stats
- **Hedge preservation**: Research limitations explicitly preserved in a `<Toggle>` component:
  - "Sample of 52 people — not huge"
  - "test was given right after the task, so long-term effects are unknown"
  - "agentic tools might have even stronger effects" (uncertainty, not certainty)
- **Attribution-first**: Every pattern described as "Low scorers (averaging below 40%) fell into..." — clear subject
- **Logical consistency**: The "driving lesson / self-driving car" narrative arc holds throughout; no contradictions

**Estimated scores:**
- technicalAccuracy: 9 (precise research stats, all sourced; -1 for minor inability to verify every interaction-pattern classification)
- sourceFidelity: 9 (excellent hedge preservation; limitations Toggle is exemplary)
- logicalConsistency: 9 (clean narrative arc, opinion/fact clearly separated)

---

#### Anchor 2: Score 8 — CP-153 (`cp-153-20260312-nvidia-nemotron3-super-120b-mamba-moe.mdx`)

**Why this is the medium-high anchor:**

- **Source**: @ArtificialAnlys tweet — less authoritative than research paper, but specific
- **Technical claims**: 120B total params, 12.7B active params, 36 Intelligence Index score, 484 tok/s, 100K→1M context window
- **Strengths**: Analogy-heavy writing doesn't fabricate numbers. Cross-reference to CP-147 for context. Technical architecture explanation (Mamba + Transformer MoE) is correct.
- **Limitations as a calibration article**: Tweet source makes some claims harder to trace to primary (e.g., "DeepInfra and LightningAI immediately launched support"). The article states Nemotron uses "up to 100萬 token" context window — verifiable claim but from tweet, not NVIDIA primary source.
- **No uncertainty erasure**: Does not upgrade "the tweet says" to absolute fact.

**Estimated scores:**
- technicalAccuracy: 8 (accurate architecture description; benchmark numbers from tweet-level source)
- sourceFidelity: 8 (no uncertainty erasure; good but tweet origin limits traceability)
- logicalConsistency: 9 (MoE cost analogy is internally consistent; cost/performance argument holds)

---

#### Anchor 3: Score 5–6 — Hypothetical (Pattern Description)

**Observation**: After surveying the post library, I did not find a clear real-world 5–6 anchor — the existing posts are generally factually careful. This is a good sign for the content quality, but means calibration examples must describe failure patterns explicitly.

**Failure pattern for 5–6 anchor (based on Fact Checker red flags):**

```
Hypothetical SP-XXX: "Claude Outperforms GPT by 40% on Every Task"

Failure pattern:
- Source says "outperforms on benchmark X in controlled settings"
- Translation says "在所有任務上領先 40%" (uncertainty erasure + stat fabrication)
- Source hedges "we believe" → translation drops hedge
- 40% figure appears nowhere in source
- ClawdNote presents this as verified fact, not ClawdNote opinion
```

**Closest real example from vibe calibration lore**: SP-110 ("Codex 10 Best Practices") was noted for being a poor-quality article overall. While its vibe score was 2/2/3, its factual accuracy pattern likely included:
- Presenting general best-practices as definitive facts
- ClawdNotes from CodexNote/GeminiNote mixed with body text (attribution failure)
- Logical inconsistency from pipeline diff exposure

**Recommendation**: Use SP-14 (9) and CP-153 (8) as calibration anchors for now. Build the 5–6 anchor from the next article that genuinely fails fact-check — add it to this doc when encountered.

---

### PASS Threshold Recommendation

Current: total score ≥ 8 (sum of 0–4 + 0–3 + 0–3 = PASS at 8/10).

**With new 0–10 per dimension:**

| Dimension | PASS threshold | Rationale |
|-----------|----------------|-----------|
| technicalAccuracy | ≥ 7 | Allows tweet-sourced imprecision; fails clear fabrication |
| sourceFidelity | ≥ 7 | Allows minor nuance loss; fails systematic uncertainty erasure |
| logicalConsistency | ≥ 7 | Allows minor gaps; fails fundamental incoherence |
| **Overall PASS** | **All three ≥ 7** | Equivalent rigor to current 8/10 bar |

---

## Part 2: EN Version Calibration Rubric

### EN Posts Surveyed

1. `en-ai-assistance-coding-skills.mdx` (SP-14) — ralph: 8/8/8, gemini: 10
2. `en-claude-code-vs-codex.mdx` (SP-2) — ralph: 8/8/8, gemini: 8
3. `en-claude-is-a-space-to-think.mdx` (SP-24) — ralph: 8/8/8, gemini: 9

All three score **8/8/8** on the standard vibe rubric. This suggests either:
- EN posts consistently hit the bar, OR
- The zh-tw rubric doesn't fully capture EN-specific quality variance

### EN Quality Distribution Observations

**What's working well in EN posts:**
- LHY analogies translate naturally into English ("It's like when you go to a convenience store...")
- Kaomoji usage fits EN tone (same ones from guidelines)
- ClawdNote persona holds in English — "I" is clear speaker
- Simple English execution is generally strong (no heavy jargon)

**EN-specific quality variance not captured by current rubric:**

1. **Cultural compensation** (zh-tw rubric assumes reader knows PTT, BORO, 鹹酥雞 culture)
   - EN posts must work harder to land the same analogies for non-TW readers
   - Example: SP-24 uses "temple" analogy — works for TW/Asian readers, may alienate Western EN readers
   - The RPG analogy in SP-2 is strong because it's internationally resonant

2. **Pronoun rule exemption creates different quality signals**
   - zh-tw clarity score penalizes 你/我 in body text
   - EN post body text legitimately uses "you" and "I" — clarity scoring must work differently
   - EN clarity should focus on: "Is it clear who/what is being described?" not "are pronouns avoided?"

3. **Humor style adaptation**
   - zh-tw: PTT directness, 台灣梗, local food references
   - EN: Same dry wit but culturally neutral references
   - "Unskippable YouTube ad" (SP-24) > "temple popup" for global EN readers
   - "Honda Civic of coding tools" (SP-2) — great cultural bridge

4. **Persona calibration difference**
   - zh-tw LHY persona: professor-on-stage feel, highly oral
   - EN LHY persona: approachable teacher feel, slightly less oral but must still avoid academic stiffness
   - EN risk: sliding into "blog post" style vs. "professor talking" style

### EN-Specific Scoring Adjustments Proposed

#### Persona dimension (EN version)
The existing rubric asks "Does it read like LHY?" but for EN, LHY's specific Taiwanese oral markers don't apply. Proposed EN-adjusted rubric:

| Score | EN Persona Description |
|-------|------------------------|
| 10 | Reads like a passionate, approachable teacher explaining to a curious non-expert. Analogies are universally resonant, oral feel is strong without being casual. |
| 9 | Great analogies, warm tone, good oral feel. Slightly formal in 1–2 spots but overall excellent. |
| 8 | Has analogies and oral feel, but some paragraphs slide into "blog writing" mode. |
| 7 | Good but inconsistent — some sections feel like a professor, others like documentation. |
| 5–6 | Reads like a well-written blog post, not a conversation. Informative but not warm. |
| 3 | Reads like a press release or translated article. No personality. |

#### Clarity dimension (EN version)
zh-tw clarity focuses on 你/我 prohibition. EN clarity should focus on:

| Score | EN Clarity Description |
|-------|------------------------|
| 10 | Every "you/I" has a clear referent. Reader always knows who is speaking, who is acting, who the sentence is about. |
| 8 | Rare ambiguity. "You" consistently addresses reader; "I" is always Clawd in ClawdNote. |
| 6 | Occasional "we" ambiguity (is it Clawd + reader? Author + Anthropic?). |
| 4 | Multiple instances where reader can't tell if "I" is Clawd, original author, or ShroomDog. |

#### New EN-only dimension to consider: Cultural Accessibility

This is currently unmeasured but represents real EN-specific quality variance:

| Score | Cultural Accessibility |
|-------|------------------------|
| 10 | All analogies and cultural references are immediately accessible to a global EN reader. No TW-specific knowledge required. Context gaps filled with brief, non-condescending explanation. |
| 8 | Mostly accessible. One cultural reference that TW readers get more immediately than global readers, but not blocking. |
| 6 | 2–3 analogies that rely on TW cultural familiarity (e.g., "鹹酥雞攤" without explanation, "PTT" without context). |
| 4 | Multiple unexplained cultural references that confuse global EN readers. |
| 2 | Article assumes TW cultural context throughout. |

**Note**: Whether to add this as a 5th scored dimension or incorporate into Persona score is a planner decision.

### EN Rubric: PASS Bar Recommendation

Current vibe bar: all dimensions ≥ 8.

For EN, recommend:
- Persona ≥ 8 (same bar)
- ClawdNote ≥ 8 (same bar — humor quality doesn't change by language)
- Vibe ≥ 8 (same bar)
- Clarity ≥ 8 (EN definition — focus on referent clarity, not pronoun prohibition)
- Cultural Accessibility ≥ 7 (if added as new dimension — slightly lower bar since full global accessibility is harder to achieve)

---

## Summary Table

### Fact Checker Calibration Anchors

| Article | File | technicalAccuracy | sourceFidelity | logicalConsistency | Total | Role |
|---------|------|-------------------|----------------|--------------------|-------|------|
| SP-14 | `ai-assistance-coding-skills.mdx` | 9 | 9 | 9 | 27 | **High anchor (9/10)** |
| CP-153 | `cp-153-20260312-nvidia-nemotron3-super-120b-mamba-moe.mdx` | 8 | 8 | 9 | 25 | **Medium anchor (8/10)** |
| SP-81 | `sp-81-20260222-citrini-2028-global-intelligence-crisis.mdx` | 7 | 8 | 8 | 23 | **Edge case (fiction framing)** |
| Hypothetical | — | 4 | 4 | 5 | 13 | **Low anchor pattern (5–6)** |

### EN Scoring Adjustments

| Dimension | zh-tw Rule | EN Adjustment |
|-----------|-----------|---------------|
| Persona | LHY oral markers, PTT vibe | LHY warmth + universal analogies, oral but not culturally specific |
| ClawdNote | Same | Same — humor bar doesn't change by language |
| Vibe | Same | Same |
| Clarity | 你/我 prohibition in body | Referent clarity (who is "I"/"you"?) — pronoun use allowed but must be clear |
| Cultural Accessibility | N/A (zh-tw assumes TW reader) | **New dimension (recommended)** — global reader accessibility |

---

*Research complete. Next step: planner-metrics to decide which findings become schema decisions.*
