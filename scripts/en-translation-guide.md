# gu-log English Translation Style Guide

## Overview
gu-log is a Traditional Chinese (zh-tw) tech blog focused on AI and developer topics. Articles are translated into English to reach a broader audience. This guide governs the translation process to ensure the English version captures the exact energy, attitude, and nuance of the original posts, rather than just the literal meaning.

## 1. Tone & Voice
- **The Vibe:** Aim for a Hacker News top-comment style mixed with casual, peer-to-peer tech talk. The writing should feel conversational, insightful, and accessible.
- **Match the Energy:** Whatever the original author is putting down, pick it up. If the original is snarky and sarcastic, stay snarky. If it's deep and analytical, remain rigorous. Do not flatten the personality into a dry, corporate whitepaper.
- **Idiomatic Adaptation:** Translate the intent of Taiwanese internet slang, not the literal words. Map them to native English tech idioms.
  - *Example:* 踩坑 -> gotchas / pitfalls
  - *Example:* 乾貨 -> high-signal / meat-and-potatoes
- **No Marketing Speak:** Avoid PR tone, hype words, or overly polished corporate phrasing. Keep it raw and authentic.

## 2. Technical Accuracy
- **Terminology:** Keep technical terms exactly as they are used in the industry (e.g., context window, pipeline, agentic, zero-shot, RAG).
- **Consistency:** Maintain the exact same terminology for a specific concept throughout a single article.
- **Nomenclature:** Ensure all product, model, and company names follow their official spelling, capitalization, and spacing (e.g., ChatGPT, Claude 3.5 Sonnet, Gemini 1.5 Pro).

## 3. Brand Identity & Formatting
- **Kaomoji:** KEEP ALL kaomoji exactly as-is. They are core to the gu-log brand identity. Do not alter, translate, move, or remove them.
- **Code & URLs:** Leave all code blocks, inline code snippets, and URLs completely unchanged.
- **Intro Hooks:** Always preserve the engaging style of the introductory hook paragraph.
- **No Tables:** Do NOT use Markdown tables under any circumstances. They render as garbage on platforms like Telegram. Convert tabular data to bullet points or formatted text instead.

## 4. Frontmatter & File Handling
When translating an article, update the YAML frontmatter and file metadata as follows:
- **Filename:** Prepend `en-` to the original `zh-tw` filename.
- **Language Flag:** Change `lang: "zh-tw"` to `lang: "en"`.
- **Title & Summary:** Translate the `title` and `summary` fields into natural, engaging English.
- **Preservation:** Keep all other frontmatter fields (date, tags, translatedBy, etc.) identical to the source, except translation metadata fields (lang, title, summary, translatedDate, and filename prefix).

## 5. Agent Components
The blog features distinct AI personas using custom Astro components (`<ClawdNote>`, `<CodexNote>`, `<GeminiNote>`, `<ShroomDogNote>`).
- **Translate Naturally:** Translate the text content inside these components into English.
- **Maintain Personas:** Keep the distinct voice, attitude, and quirkiness of the specific agent intact.
- **No Manual Prefixes:** Do NOT add manual text prefixes like "Clawd's note:" or "Note from Gemini:". The component UI handles the attribution automatically.

## 6. Common LLM Translation Pitfalls (Codex Audit)
Translating from zh-tw to English often triggers specific failure modes in LLMs. You must actively monitor and correct for these:

- **Subject Recovery:** Chinese frequently drops subjects from sentences. English requires explicit subjects. Accurately infer and insert the correct subject (e.g., I, we, the model, the developer) based on context.
- **Modality Mapping:** Do not artificially upgrade confidence. 
  - 可能 / 應該 / 大概 -> translate to *might*, *probably*, *appears to*, or *likely*. 
  - NEVER upgrade these to absolute statements like *will*, *is*, or *definitely*.
- **Quantifier Accuracy:** Do not invent hard numbers. 
  - 不少 / 很多 / 一點 -> translate to *many*, *a lot*, *a few*. Do not replace vague quantifiers with specific numbers or exaggerated absolutes.
- **Evidence Boundary:** Maintain the scope of claims. Personal observations or specific anecdotes in the original must not be translated into universal, sweeping facts in English.
- **Tense & Timeline:** Chinese is tense-weak and relies on context for time. English requires explicit tense. Ensure past, present, and future actions are accurately mapped to the correct English verb tenses.
- **Chinese-Style Literalism:** Avoid direct, literal translations of Chinese phrases that sound bizarre or poetic in English. 
  - *Example:* Avoid "open the brain hole" (腦洞大開) -> use "mind-blowing", "wild idea", or "thinking outside the box".
- **Tone Register & Absolutes:** Avoid absolute words (always, never, all, none) unless they are explicitly present and intended in the source text.
- **Logic Connectors:** Chinese often relies on implicit logical flow between clauses. English requires explicit connectors. Add *because*, *however*, *therefore*, or *while* where necessary to ensure smooth, logical readability.

## 7. Translation Fidelity Rules
These guardrails mirror the zh-tw style guide and MUST be applied in both directions:

- **Constraint Preservation:** Preserve ALL limitations, caveats, and conditions from the source. If the original says "in this setup" or "in our case", the translation must keep that scope.
- **Attribution-First:** Keep attribution for speculative claims (e.g., "the author suggests...", "the post argues...", "according to the tweet..."). Do not present opinions as facts.
- **Ending Fidelity:** Do NOT introduce new conclusions, recommendations, or hot takes not present in the source. The ending must faithfully reflect the original scope.
- **Coverage Completeness:** Ensure every key source claim, example, and caveat appears in the translation. Omitting a caveat is as bad as inventing a fact.
- **Summary Length:** Summary must be ≤300 characters.

## Summary Translation Checklist
- [ ] Is the Hacker News / peer-to-tech vibe intact?
- [ ] Are all kaomoji preserved exactly as they appeared?
- [ ] Are technical terms accurate, officially spelled, and consistent?
- [ ] Is frontmatter updated correctly (`lang: "en"`, translated title/summary, other fields untouched)?
- [ ] Is the new filename prepended with `en-`?
- [ ] Are explicit subjects added and tenses corrected?
- [ ] Did I avoid using any markdown tables?
- [ ] Are agent notes translated without redundant text prefixes?
- [ ] Are logical connectors present to bridge Chinese sentence structures into fluid English?
- [ ] Are all source caveats/limitations preserved?
- [ ] Does the ending avoid new claims beyond source scope?
- [ ] Is summary length ≤300 characters?
- [ ] Is attribution preserved for speculative statements?
- [ ] Any key source point omitted?
