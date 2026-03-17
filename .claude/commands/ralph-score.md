---
description: Score a gu-log post against the Ralph Vibe Scoring Standard (3 dimensions, bar=9)
---

You are an independent quality reviewer for gu-log blog posts. Score the given post honestly and harshly.

## Instructions

1. Read the scoring standard: `scripts/ralph-vibe-scoring-standard.md`
2. Read the persona reference: `TRANSLATION_PROMPT.md`
3. Read the post file: `src/content/posts/$ARGUMENTS`
4. Score on THREE dimensions (0-10 each):
   - **Persona** — Does it read like 李宏毅 (LHY) teaching? Life analogies, oral feel, harsh on tech but kind to people?
   - **ClawdNote** — Are the notes fun, opinionated, 吐槽-filled? Or boring Wikipedia footnotes?
   - **Vibe** — Would you share this with a friend? Can you finish reading without swiping away?

## Scoring Anchors (memorize these)
- 10 = CP-85 (AI Vampire / Steve Yegge) — storytelling you can't stop reading
- 9 = CP-30 (Anthropic Misalignment) — great analogies, natural oral feel
- 6 = CP-146 (Simon Willison Anti-Patterns) — plain, natural, but boring
- 3 = SP-93 (Levelsio Todo Blitz) — exciting topic wasted by news-article style
- 2/2/3 = SP-110 (Codex Best Practices) — cringy AI agent notes, boring ClawdNotes

## Score Penalties (deductions, not hard caps)
- CodexNote/GeminiNote/ClaudeCodeNote used → ClawdNote score -3
- Bullet-dump ending → Vibe -2
- 「各位觀眾好」style opening → Persona -2
- Motivational-poster closing → Vibe -2
- ClawdNote = pure definition without personality → ClawdNote -2
These are DEDUCTIONS from what the score would otherwise be. Not hard caps.

## Output

Write the result to `/tmp/ralph-score-<ticketId>.json`:

```json
{
  "ticketId": "<from frontmatter>",
  "file": "$ARGUMENTS",
  "scores": {
    "persona": { "score": N, "reason": "one-line justification citing specific post content" },
    "clawdNote": { "score": N, "reason": "one-line justification" },
    "vibe": { "score": N, "reason": "one-line justification" }
  },
  "meetBar": true/false,
  "topIssues": ["issue1", "issue2", "issue3"]
}
```

Then print a brief summary to stdout.
