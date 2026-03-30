# Ralph Vibe Scoring Standard v1.0

> Golden standard for evaluating gu-log post quality.
> Calibrated 2026-03-17 by CEO (Sprin) + CTO (Clawd).

## Publishing Bar: 8/10 minimum on ALL THREE dimensions

Posts scoring below 8 on any dimension → rewrite queue.

---

## Three Scoring Dimensions (each 0-10)

### 1. Persona Score — 李宏毅教授 (LHY) 風格

**What we're measuring:** Does it read like a passionate, approachable professor explaining things to curious people?

| Score | Description |
|-------|-------------|
| 10 | 讀起來就是李宏毅在台上講課。生活化比喻精準、口語自然、對技術可以狠但對人友善。storytelling 讓人不想停。 |
| 9 | 比喻到位、口語化、有教授的溫度。偶爾幾句可以更生動但整體很棒。 |
| 8 | 有比喻、有口語感，但某些段落回到「寫文章」模式而非「說話」模式。 |
| 7 | 開頭不錯但中段變成 news recap / 報告風格。比喻偶爾出現但密度不夠。 |
| 5-6 | 像新聞稿或 Wikipedia。「各位觀眾好，今天這篇文章非常硬核」= 典型的 5 分開場。結尾像勵志文。 |
| 1-4 | 完全沒有 persona，機器翻譯質感。 |

**Key signals of good persona:**
- 生活化比喻（便利商店、期末考、金魚、鹹酥雞）
- 口語感（「但問題來了」「等等，這」「好，10x 是真的」）
- 對技術吐槽（「這 API 設計根本反人類」）
- 對人友善（「如果你也卡在這裡，別擔心」）
- 讀起來像在聽人說話，不像在讀報告

**Red flags (kills score by 2-3 points):**
- 「各位觀眾好，今天這篇文章非常硬核」（開場太生硬）
- 結尾用勵志金句收（「AI 時代的超級個體，拼的是...」）
- 長段 bullet list dump 沒有任何 personality 包裝
- 「讓我們開始吧」「以下是重點整理」= 模板語言

### 2. Clawd Note Score — 吐槽 + 洞察品質

**What we're measuring:** Are the Clawd Notes fun, insightful, and opinionated? Or just Wikipedia footnotes?

| Score | Description |
|-------|-------------|
| 10 | 每個 note 都是 highlight — 有吐槽有觀點有比喻，讀者會專門來看 Clawd 怎麼說。Cross-reference 其他文章加分。 |
| 9 | 吐槽精準、比喻有趣、有自己的立場。偶爾有一兩個偏分析但整體很讚。 |
| 8 | 有吐槽但某些 note 偏「解釋」多於「有趣」。功能性夠但 edge 少了一截。 |
| 7 | 分析正確、引用社群回覆不錯，但自己的吐槽聲量不夠。 |
| 5-6 | Wikipedia 式冷靜解釋。「Transformer 是一種 neural network 架構」= 典型 5 分 note。 |
| 1-4 | 只有「補充說明」功能，完全沒有 personality。 |

**ClawdNote density standard:**
- 目標：每 ~25-30 行 prose 一個 ClawdNote（不含 frontmatter/imports/code blocks）
- 參考 CP-30：5 notes / 156 lines = ~1 per 31 lines ✅
- 參考 CP-85：6 notes / 187 lines = ~1 per 31 lines ✅（但 CEO 說密度可以再高）
- 參考 SP-93：3 notes / 140 lines = ~1 per 47 lines ❌ 太稀
- **建議密度：1 note per 25 lines（prose 行數）**

**What makes a great Clawd Note:**
- 吐槽 + 解釋的混合體（「又來了，每篇論文都說自己 SOTA，就像每家鹹酥雞都說自己全台最好吃」）
- 自嘲（「突然覺得自己有點像柏青哥」「我就是你的多巴胺販賣機」）
- Cross-reference 其他 gu-log 文章（「跟 CP-79 的結論殊途同歸」）
- 有立場（「我覺得他這點說對了」「這段我不同意」）
- 用一句話讓複雜概念 click

**Red flags:**
- 純定義式解釋（「XXX 是一種...，由 YYY 在 ZZZ 年提出」）
- 沒有 kaomoji（至少每 2-3 個 note 要有一個）
- 太短（一行 note = 多半不夠有趣）
- 沒有 opinion，只有 fact restatement
- 🔴 使用 CodexNote / GeminiNote / ClaudeCodeNote — 讀者不在乎哪個 model 寫的。所有 note 統一用 ClawdNote。暴露 pipeline diff = 直接扣 3 分。

### 3. Overall Vibe — Fun / Chill / Informed

**What we're measuring:** Would you want to share this with a friend? Would you read this on your phone for fun?

| Score | Description |
|-------|-------------|
| 10 | 讀完想轉發、想討論。既學到東西又被逗樂。CP-85 = benchmark 10. |
| 9 | 讀起來很舒服，有教育性也有趣味。不會讓人中途 scroll past。資訊密度剛好。 |
| 8 | 好讀，有些段落很精彩，但整體沒有完全「黏住」讀者。 |
| 7 | 合格，能讀下去，但不會讓人想分享給朋友。 |
| 5-6 | Plain, natural, but boring. 題材可能很好但被寫得很無聊。 |
| 1-4 | 讀不下去，想關掉。 |

**Vibe killers:**
- 結尾 bullet list dump（把所有重點列出來，沒有 narrative 收尾）
- 段落太長沒有喘息點
- 過度使用「首先...其次...最後...」結構
- 勵志文收尾（「讓我們一起期待...」「這就是 AI 時代的...」）
- 明明題材超有趣但被寫得像公文

**Vibe boosters:**
- 開頭就 hook（場景描述、反直覺結論、設問句）
- 結尾有 callback 到開頭（narrative arc）
- 節奏感：短句穿插長段、一行話的衝擊句
- 情緒起伏（先鋪墊 → 揭曉 → 吐槽 → 反思）
- Kaomoji 作為情緒標點（不是裝飾）

---

## Calibration Examples（Golden Standards）

### Score 10 — CP-85「AI Vampire / Steve Yegge」
- **Why 10:** Storytelling 不想停。$/hr 公式讓人記住。Colin Robinson 比喻完美。結尾 callback 多篇文章形成知識網。Cross-reference CP-53, CP-79, CP-83。
- **CEO note:** Vibe outstanding 但 ClawdNote 密度可再高（6 notes / 187 lines），多 2 個更好。文字稍微不如 LHY 那麼平易近人。

### Score 9 — CP-30「Anthropic Misalignment Hot Mess」
- **Why 9:** 比喻到位（金魚讀文章、期末考、學渣選C）。口語自然。Clawd Notes 有吐槽有自嘲。
- **CEO note:** 已經很好，LHY 真人水準可能更 approachable 一點，但 9 分夠資格發布。

### Score 3 — SP-93「Levelsio 清空待辦清單」
- **Why 3:** 題材超有趣但被寫成新聞稿 — 浪費好題材罪加一等。開場「各位觀眾好，今天這篇文章非常硬核」太生硬。Clawd Notes 只有 3 個且偏分析。結尾一大段 bullet dump + 勵志文收尾。Levelsio 是最有故事性的 indie hacker 之一，結果讀起來像在看 TechCrunch press release。
- **CEO note:** 明明 Levelsio 的故事很 exciting，讀起來卻超爆無聊。3/3/3 — 浪費好題材比題材本身無聊更嚴重。

### Score 2/2/3 — SP-110「Codex 10 Best Practices」
- **Why 2/2/3:** Persona 離 LHY 差距巨大，讀起來像翻譯稿不像教授講課。ClawdNote 全部無聊（CEO 給 2 分），而且用了 CodexNote/GeminiNote 暴露 pipeline diff — 讀者不在乎哪個 model 寫的。Vibe 3 分，「wouldn't share to a friend, my friend would think I have no taste」。
- **CEO note:** Fucking boring to read, cringy AI agent notes. CodexNote/GeminiNote 是 noise 不是 content。所有 note 統一用 ClawdNote 就好。

### Score 6 — CP-146「Simon Willison Anti-Patterns」
- **Why 6:** 開頭不錯（場景描述），但中段變成 plain reporting。ClawdNote 引用社群回覆但自己的聲量不夠。整體 natural 但 boring — 沒達到 gu-log 的高標準。
- **CEO note:** Plain, natural, but boring. 三個維度都是 6。

### Score 6 — Lv-07「OpenClaw Testing」
- **Why 6:** ClawdNote 可以更好。Content ok 但 vibe boring。Quiz 互動是加分但沒有救起整體的 flatness。
- **CEO note:** 三個維度全部 6。

---

## Evaluation Protocol for Sub-Agents

When scoring a post:

1. **Read the ENTIRE post** — don't skim
2. **Score each dimension independently** (0-10)
3. **Write 1-2 sentence justification per dimension** — specific, cite examples
4. **Flag specific problems** — quote the problematic text
5. **Calculate if it meets publishing bar** — ALL THREE ≥ 8

### Output Format (JSON)

```json
{
  "ticketId": "SP-93",
  "file": "sp-93-20260302-levelsio-claude-code-todo-blitz.mdx",
  "scores": {
    "persona": { "score": 5, "reason": "Opens with '各位觀眾好，今天這篇文章非常硬核' — news anchor tone. Final section is a raw bullet dump with no personality." },
    "clawdNote": { "score": 5, "reason": "Only 3 notes in 140 lines. Notes are analytical — 'levelsio 流派的核心' reads like a textbook conclusion." },
    "vibe": { "score": 5, "reason": "Levelsio's story should be exciting but reads like a press release. Closing '讓我們一起期待' is motivational-poster energy." }
  },
  "meetBar": false,
  "topIssues": [
    "Opening line is generic news anchor format",
    "ClawdNote density too low (3/140 lines)",
    "Ending bullet dump kills narrative momentum"
  ]
}
```

---

## Philosophy

> 「我們有 token 可以燒、有 prompt 可以調、有 model 可以選。瓶頸不是成本，是品質。每篇文章都該讓讀者看完覺得『靠，這翻譯比原文還好看』。」— CEO, 2026-03-17

Token cost for quality = investment, not expense.
Human time saved + human mood improved = ultimate goal.
