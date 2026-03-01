# SP-94 Draft Review (`draft-v1.mdx`)

## Findings (ordered by severity)

1. **Medium — Frontmatter `summary` does not match style-guide sentence-count requirement**  
   - File: `draft-v1.mdx:12`  
   - Issue: Embedded style guide requires `summary` to be **2-3 句摘要**, but current value is one long sentence.  
   - Why it matters: This is a direct format mismatch against the required frontmatter spec.
   - Actionable fix:
     - Replace with 2-3 short sentences, e.g.  
       `summary: "大家都在追最強 Model，但真正決定 Agent 好不好用的其實是 Harness。本文拆解 Claude Code、Cursor、Manus、SWE-Agent 的共通架構。重點是：Progressive disclosure 才是 production 成敗分水嶺。"`

2. **Low — One added concrete entity is outside source context (`GPT-5`)**  
   - File: `draft-v1.mdx:54`  
   - Issue: Source context does not mention `GPT-5`; this is added by the draft in ClawdNote.  
   - Why it matters: Your checklist asks for no hallucinated claims beyond source context. Even as rhetorical phrasing, this introduces a new named model not grounded in source material.
   - Actionable fix:
     - Change `就算接上 GPT-5` to a source-grounded generic phrase like `就算換成更強的模型`.

3. **Low — High-impact numeric claims are not locally attributed in the draft body**  
   - Files: `draft-v1.mdx:24-26`, `draft-v1.mdx:80`, `draft-v1.mdx:98`, `draft-v1.mdx:112`, `draft-v1.mdx:116`, `draft-v1.mdx:128`  
   - Issue: Numbers appear accurate relative to provided source context, but the draft drops explicit source labels/links that existed in source material.
   - Why it matters: Not a hallucination by itself, but it weakens verifiability and future editorial review.
   - Actionable fix:
     - Add concise attributions inline (e.g. `（依 LangChain 2026-02 文）`, `（依 Cursor 2026 A/B 測試）`) or append a short `## 參考資料` section.

## Checklist Pass/Fail

1. **Fact-check: no hallucinated claims beyond source context**  
   - **Mostly pass, with 1 minor exception**: `GPT-5` mention is outside source context (`draft-v1.mdx:54`).

2. **Style alignment: matches `sp-style-guide.md` requirements**  
   - **Mostly pass**: zh-tw tone, clear `##` structure, `---` separators, has `## 結語`, no markdown table, ClawdNote tone is on-spec.  
   - **Fail point**: frontmatter `summary` sentence count requirement not met.

3. **Frontmatter accuracy: ticketId/source/sourceUrl/dates/tags format**  
   - **Pass** for `ticketId`, `source`, `sourceUrl`, `originalDate`, `translatedDate`, and `tags` list format.  
   - **Needs tweak** only for `summary` format requirement (2-3 sentences).

4. **ClawdNote usage and kaomoji requirements**  
   - **Pass**: ClawdNote imported correctly (`draft-v1.mdx:15`), used 3 times (`53-55`, `70-72`, `90-92`), no forbidden `Clawd 補充` prefix, kaomoji present multiple times.

5. **Clear actionable fixes**  
   - Provided above with exact replacement guidance.

## Assumptions / Notes

- `sp-style-guide.md` is not present in this workspace. This review used the embedded “Style guide” section in `gemini-write-prompt.txt` as the operative standard.

## Suggested minimal patch set

1. Update frontmatter `summary` to 2-3 sentences.
2. Replace `GPT-5` mention with generic `更強的模型` wording.
3. Add brief source attribution for key numeric claims (inline or references section).
