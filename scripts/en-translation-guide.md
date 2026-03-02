# gu-log English Translation Style Guide

## Overview
gu-log is a Traditional Chinese (zh-tw) tech blog focused on AI and developer topics. Articles are translated into English to reach a broader audience. This guide ensures the English version preserves the original article’s intent, tone, and boundaries—not just literal wording.

## 1. Tone & Voice
- **The Vibe:** Write like a high-signal Hacker News top comment: conversational, sharp, and useful.
- **Match the Energy:** Keep the original tone. If the source is snarky, stay snarky. If it is analytical, stay rigorous.
- **Idiomatic Adaptation:** Translate Taiwanese internet slang by intent, not word-for-word.
  - *Example:* 踩坑 -> gotchas / pitfalls
  - *Example:* 乾貨 -> high-signal / meat-and-potatoes
- **No Marketing Speak:** Avoid PR/corporate polish.

## 2. Technical Accuracy
- **Terminology:** Keep industry-standard terms intact (e.g., context window, pipeline, agentic, zero-shot, RAG).
- **Consistency:** Use one term consistently for the same concept within an article.
- **Nomenclature:** Keep official naming and casing (e.g., ChatGPT, Claude 3.5 Sonnet, Gemini 1.5 Pro).

## 3. Brand Identity & Formatting
- **Kaomoji:** Preserve kaomoji exactly as in the source. Do not alter, move, or remove them.
- **Code & URLs:** Keep all code blocks, inline code, and URLs unchanged.
- **Intro Hooks:** Preserve the original hook style.
- **No Tables:** Never use Markdown tables; convert to bullets/text.

## 4. Frontmatter & File Handling
When translating an article, update metadata as follows:
- **Filename:** Prepend `en-` to the original filename.
- **Language Flag:** Change `lang: "zh-tw"` to `lang: "en"`.
- **Title & Summary:** Translate `title` and `summary` into natural English.
- **Translated Date:** Update `translatedDate` to the current translation date.
- **Preservation Rule:** Keep all other frontmatter fields identical to source.
  - Allowed changes are only translation metadata: `lang`, `title`, `summary`, `translatedDate`, and filename prefix.

## 5. Agent Components
The blog uses custom Astro components (`<ClawdNote>`, `<CodexNote>`, `<GeminiNote>`, `<ShroomDogNote>`).
- **Translate Naturally:** Translate component content into English.
- **Maintain Personas:** Preserve each agent’s voice and attitude.
- **No Manual Prefixes:** Do not add prefixes like "Clawd's note:"; attribution is handled by the component UI.

## 6. Common LLM Translation Pitfalls
- **Subject Recovery:** Add explicit subjects where Chinese omitted them.
- **Modality Mapping:** Do not upgrade uncertainty.
  - 可能 / 應該 / 大概 -> might / probably / appears to / likely
  - Never upgrade to definite claims unless source is definite.
- **Quantifier Accuracy:** Keep vague quantifiers vague.
  - 不少 / 很多 / 一點 -> many / a lot / a few
- **Evidence Boundary:** Do not expand anecdotal claims into universal facts.
- **Tense & Timeline:** Map time context to proper English tense.
- **Chinese-Style Literalism:** Avoid awkward literal calques.
- **Tone Register & Absolutes:** Avoid absolute words unless explicitly present in source.
- **Logic Connectors:** Add explicit connectors where needed for readability and logic flow.

## 7. Translation Fidelity Guardrails
These are mandatory:
- **Constraint Preservation:** Preserve all source limitations, caveats, and scope conditions.
- **Ending Fidelity:** Do not add new conclusions, recommendations, or hot takes beyond the source ending.
- **Attribution-First:** Keep attribution for speculative/opinion claims (e.g., "the author argues...", "according to the tweet...").
- **Coverage Completeness:** Include every key source claim, example, and caveat; omission is a fidelity failure.
- **Summary Length:** Summary must be ≤300 characters.

## 8. Final Translation Checklist
- [ ] Tone and energy match the source.
- [ ] Kaomoji are preserved exactly as in source.
- [ ] Technical terms and product names are accurate and consistent.
- [ ] Frontmatter changes are limited to `lang`, `title`, `summary`, `translatedDate`, and filename prefix.
- [ ] Code blocks, inline code, and URLs are unchanged.
- [ ] Subjects/tenses/modality are corrected for natural English without changing confidence.
- [ ] No markdown tables are used.
- [ ] Agent component text is translated naturally without manual prefixes.
- [ ] All caveats/limitations are preserved (Constraint Preservation).
- [ ] Speculative statements retain explicit attribution (Attribution-First).
- [ ] Ending does not add claims beyond source scope (Ending Fidelity).
- [ ] No key source claim/example/caveat is omitted (Coverage Completeness).
- [ ] Summary is ≤300 characters.
