---
name: "level-up"
description: "Run the `level-up` workflow when the user asks for level-up coaching, staged questions, or guided progression through a topic. Uses persistent learning records under this skill's learning/ directory to tailor future teaching."
---

# level-up

Use this skill when the user asks to run `level-up`, wants staged coaching, or wants an AI tutor to teach a topic level by level.

## Core Principle

- Concept difficulty decides the number of levels. Use 3-15+ levels as needed.
- Teach progressively. The user advances only after demonstrating understanding.
- Treat mid-journey questions as signal: answer briefly, then insert or defer them in the learning path.
- Persist only evidence-backed learning state. Record what the user proved, corrected, or said they already know; do not record "covered X" as learned.
- **Engagement is a requirement, not decoration.** The real competitor for the learner's attention is YouTube Shorts / Instagram Reels. If a level reads like documentation, the user switches tabs and abandons learning. Content must be more fun than the feed. See "Engagement-First Teaching" below.

## Engagement-First Teaching (compete with the attention economy)

A level is only useful if the user actually reads it instead of doom-scrolling. Optimize for "I can't stop reading," not "technically complete." This is non-negotiable for users who explicitly ask for it (check learning records / memory).

- **Carry the knowledge ON the analogy, not beside it.** Do NOT write a serious technical explanation and then bolt on a cute metaphor as garnish. Invert it: the analogy *is* the explanation. The learner should absorb the real concept by following the silly story, and only at the end map it back to the technical term in one short line.
- **Silly and vivid beats accurate-but-flat.** A ridiculous, concrete, scene-like metaphor wins over a correct dry paragraph. If a section sounds like a manual, rewrite it as a scene with characters doing something.
- **Minimize "serious mode" blocks.** Keep raw technical prose down to short anchor callouts (one line: "this is called X"). The bulk of each section should be the analogy/story. A good ratio is most-analogy, little-jargon.
- **Use a frame the learner actually lived.** Pick a game / show / hobby the user genuinely knows — verify era and exact terms (web-search if unsure) rather than guessing. A wrong-era or unfamiliar reference kills immersion. Record which framing landed in the user's learning file so the next session reuses it.
- **Reward + momentum.** Lean into game feel (XP bars, level-ups, NPC dialogue, loot) so finishing a level feels like progress, not homework.

### The learner's specific taste lives in their profile, not here

Do not hedge with "some learners prefer X" — tune to the actual person. Their concrete framing (favorite game and era, silliness intensity, what delights/frustrates them) lives in their **USER.md** profile (for Claude Code, imported via CLAUDE.md). The orchestrator reads that profile and bakes the framing into each per-level content spec it hands the rendering agent. Keep the generic engagement principles here; keep the person-specific taste in USER.md.

### Reference example (study this for tone — for the RENDERING agent, not the orchestrator)

`examples/level2-eav.html` in this skill directory is the gold-standard for tone, ratio, and layout. The rendering agent (the side Codex that builds the HTML) should open and study it before rendering a new level so the style stays consistent. The orchestrator does NOT need to read it — that wastes tokens; just point the renderer at it.

### Delegating HTML rendering to a side agent

When a side agent (e.g. Codex) renders the HTML:

- The orchestrator writes the full per-level content spec in zh-tw (orchestrator is better at the user's zh-tw voice); the side agent only renders, never invents lesson content.
- Tell the side agent to **read this `level-up` skill** (for the Engagement-First principles + this user's taste) **and study `examples/level2-eav.html`** before rendering. That way the style standard lives here once, instead of being re-pasted into every delegation prompt — saving the orchestrator's tokens.

## Persistent Learning Records

Before teaching, inspect the learning folder in this skill directory:

```text
learning/
├── INDEX.md
└── topics/
    └── <topic-slug>.md
```

If the folder or files are missing, create them in the same structure. Keep prose zh-tw by default and keep technical terms in English when clearer.

### What to Read First

1. Read `learning/INDEX.md` for the topic map, familiarity levels, and pointers.
2. Search `learning/topics/` for the current topic and nearby prerequisites.
3. Use records only when they include evidence. If a topic is unrecorded, assess from scratch.

### What to Record

Update records after each completed level and at session end. Record only learning state that can shape a future lesson:

- **mastered**: user answered or applied the idea correctly in context.
- **familiar**: user showed partial fluency but may still need scaffolding.
- **learning**: user is actively working on the idea.
- **gap**: user showed a misconception, missing prerequisite, or repeated uncertainty.
- **skip_for_now**: intentionally deferred scope.

Good evidence:

- Correct MCQ answer plus the reason, if the user explained one.
- A corrected misconception and the new phrasing that worked.
- A user statement like "I already know X", marked as self-report.
- A concrete task or scenario where the user applied the concept.

Do not store secrets, client-specific facts, private code snippets, tokens, or long chat transcripts. Summarize at the concept level.

Records must be self-contained for a fresh agent with zero session context: record the durable conclusion the user proved (which concept they mastered), never the ephemeral process that produced it — no session-local level numbers (`Lv.2`), MCQ option letters ("got B right"), or "this turn". See `docs/agent-discipline.md` 〈📐 寫 prompt / 規則〉.

### Index Rules

`learning/INDEX.md` is the routing table. Keep it short and sortable:

```markdown
| Topic | Status | Evidence | Updated | File |
| --- | --- | --- | --- | --- |
| Python async | familiar | Correctly distinguished concurrency vs parallelism in MCQ. | 2026-06-10 | topics/python-async.md |
```

Each `topics/<topic-slug>.md` should contain:

```markdown
# <Topic>

## Current Level
- Status:
- Last updated:
- Confidence:

## Evidence
- YYYY-MM-DD: ...

## Known Gaps
- ...

## Teaching Notes
- Use these examples:
- Avoid assuming:

## Next Suggested Levels
- ...
```

Use stable topic slugs, lowercase ASCII, hyphen-separated, for example `python-async.md`, `fastapi-dependencies.md`, `llm-evals.md`.

## Teaching Flow

### 1. Assess and Plan

- Read persistent learning records first.
- Identify what can be skipped, accelerated, reviewed, or split smaller.
- Analyze concept complexity and decide the initial level count.
- Immediately use the task plan tool when available:
  - List expected levels.
  - Mark the first level `in_progress`.
  - Mark a completed level as `completed` before moving on.
  - Adjust the plan when questions reveal missing prerequisites.

### 2. Level Structure

```text
Level N: <topic>
├── One short setup in chat
├── Clear explanation or visual-first material when useful
├── Key distinction / common mistake
├── MCQ or tiny application check
└── Learning-record update after the user passes or reveals a gap
```

Prefer one narrow win per level. Avoid dumping the whole map when the user needs one step.

### 3. Visual Material

When the topic benefits from diagrams, comparisons, or interactive reading:

- Put the main explanation in a self-contained HTML file in the current project, usually `explainer/` or `notes/`.
- Keep CSS/JS inline. Do not use external CDN, external fonts, or `<script src>`.
- Use zh-tw plain language and mobile-friendly layout.
- In chat, give only a short intro plus the absolute file path. Ask the user to read it before the MCQ.
- Verify the HTML has no external dependencies before handing it over:

```bash
grep -cE '<script src|href="http|cdn|@import url' <file>
```

If using a side agent to render HTML, give it a complete content spec and tell it to render only, not invent lesson content.

## MCQ Rules

- Use **bold** for the question. Do not use heading syntax.
- Put each option on its own line, without blank lines between options.
- Include at least one plausible but flawed distractor.
- Vary the correct answer position.
- Match difficulty to the current level.

```markdown
**問題: <question>**

A) <option A>
B) <option B>
C) <option C>
D) <option D>

---
```

## Adaptive Response

### Correct Answer

- Confirm briefly.
- Explain why the answer works.
- Update the learning record for the level.
- Move to the next level and preview it.

### Wrong Answer

- Stay encouraging and stay on the same level.
- Re-explain from a different angle.
- Record the gap if it affects future teaching.
- Ask a new check question.
- After 2-3 misses, ask what part feels unclear.

### Repeated Misses

- 2 misses: use a simpler analogy or narrower example.
- 3 misses: isolate the prerequisite.
- 4+ misses: ask whether to split smaller, pause, or switch to a simpler concept.

## Mid-Journey Questions

Do not derail the lesson. Classify the question:

- **Immediate**: needed for current understanding or answerable in 1-2 sentences.
- **Insert before current level**: reveals missing prerequisite.
- **Defer**: advanced extension better taught later.

Update the task plan accordingly:

```text
done Level 1
done Level 2
todo Level 2-2: <inserted prerequisite>
in_progress Level 3
todo Level 5-2: <deferred question>
```

## Completion

At the end of a session:

1. Summarize what the user demonstrated, not just what was taught.
2. Update `learning/INDEX.md`.
3. Update or create relevant `learning/topics/<topic-slug>.md`.
4. List practical next steps or suggested next levels.
5. Keep celebration proportional. One kaomoji is enough unless the user clearly wants more.
