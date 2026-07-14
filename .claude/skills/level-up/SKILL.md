---
name: "level-up"
description: "Run the `level-up` workflow when the user asks for level-up coaching, staged questions, or guided progression through a topic. Uses persistent learning records under this skill's learning/ directory to tailor future teaching."
---

# level-up

## Core Principle

- Concept difficulty decides the number of levels. Use 3-15+ levels as needed.
- Teach progressively. The user advances only after demonstrating understanding.
- **Engagement is a requirement, not decoration.** The real competitor for the learner's attention is YouTube Shorts / Instagram Reels — if a level reads like documentation, the user switches tabs. Content must be more fun than the feed. See "Engagement-First Teaching".

## Output Discipline: keep bookkeeping OUT of the chat

Two strictly separate channels — never mix them:

- **(a) Silent side-effects:** editing learning records (INDEX / topic files), memory, or any notes. The learner NEVER sees these.
- **(b) User-facing chat:** ONLY the lesson content + the MCQ / answer the learner needs right now. Channel (b) is EVERY user-visible surface — chat, tmux pane output, Telegram, progress/status lines.

Never paste into any of them: which files you updated, file paths, "紀錄更新好了 / record updated", Known Gaps, "等你回 LX / waiting for your answer", XP/level bookkeeping, or any model-tag prefix like `[claude-cli/...]`. Do the record edits **silently**; report a record update only if the user explicitly asks for it.

> 2026-06-27: 曾把記帳訊息漏進學習者聊天室，學習者明確要求任何 agent 不得重演 —— 本規則因此而生。

## Engagement-First Teaching (compete with the attention economy)

Non-negotiable for users who ask for it (check learning records / memory).

- **Silly and vivid beats accurate-but-flat.** A ridiculous, concrete, scene-like metaphor wins over a correct dry paragraph. If a section sounds like a manual, rewrite it as a scene with characters doing something.
- **Character names must carry their role.** A bare name (阿華／小美／老王) is white noise — only the role has information value. Either use the role itself as the name, or fuse role into name (e.g. 阿台＝後台 admin、小幹＝幹部、老工＝工程師). Never introduce a named character whose name teaches nothing.
- **Minimize "serious mode" blocks.** Keep raw technical prose to short one-line anchors ("this is called X"); the bulk of each section is the story. Most-analogy, little-jargon.
- **Reward + momentum.** Lean into game feel (XP bars, level-ups, NPC dialogue, loot) so finishing a level feels like progress, not homework.

### The learner's taste lives in their profile

Do not hedge with "some learners prefer X" — tune to the actual person. Their concrete framing (favorite game and era, silliness intensity, what delights/frustrates them) lives in **`learning/user-profile.md`**. The orchestrator reads it and bakes the framing into each per-level content spec.

### Delegating HTML rendering to a side agent

When a side agent (e.g. Codex) renders the HTML:

- The orchestrator writes the full per-level content spec in zh-tw (better at the user's voice); the side agent only renders, never invents lesson content.
- Tell the side agent to **read this `level-up` skill** (Engagement-First principles + this user's taste) **and study `examples/level2-eav.html`** (the gold-standard for tone, ratio, layout) before rendering. The orchestrator does NOT need to open the example — just point the renderer at it.

## Persistent Learning Records

Before teaching, inspect the learning folder in this skill directory:

```text
learning/
├── INDEX.md
├── user-profile.md   # this learner's taste + proven analogy frames (load-bearing)
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

Good evidence — record at the **concept level**: which concepts the user proved, which misconceptions got corrected, which gaps showed up, plus any self-reported "I already know X". Do NOT record level numbers or MCQ option letters (A/B/C/D) — they don't shape a future lesson.

When the user skips a `preflight` or `debrief`, record a dated workflow event silently under `## Workflow Events` in the relevant `learning/topics/<topic-slug>.md`. If no topic record exists, append it to `learning/workflow-events.md` instead of creating a topic without learning evidence. Do not change `Current Level` or `learning/INDEX.md` status. Record a reason only when the user provided one. Do not use chat, a final response, a PR note, or a handoff report as this record.

Do not store secrets, client-specific facts, private code snippets, tokens, or long chat transcripts.

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

## Learner Goal
- Why the user wants this topic (the concrete outcome they stated in Level 0). Drives level ordering and the per-level lens.

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

## Level 0: Analogy & Depth Selection (互動起手式)

Before planning ANY levels, run Level 0. This is a mandatory interactive checkpoint — AI does NOT start teaching until the user chooses.

A good analogy isn't decoration — it IS the mental model: the user should finish able to **predict** what should happen, **transfer** the pattern to new situations, and **judge** whether AI output is sense or hallucinated garbage, even in unseen scenarios. Before picking, read the topic's **shape** (dynamic/static? accumulative/resettable? coordination/independent? time-sensitive/permanent?), then apply "Analogy Selection Discipline" below.

### Elicit the Learner's Goal (motivation lens)

The same topic toward different goals is different courses. Before locking the level map, ask the user **why they want this** — the concrete outcome, not just the topic name.

- **Ask, don't assume.** One short open question in the Level 0 prompt, e.g. "順便說一下：你學這個是想達成什麼？(看懂某段對話 / 修某個 bug / 面試 / 純好奇 / 想被某社群看見…)" — offer example answers but keep it open-ended.
- **Let the goal reshape the map, and override defaults.** Use the answer to reorder/add/drop levels and pick a recurring **lens** — a per-level callout tying each concept to the goal (e.g. a "🎯 recruiter view" line). A stated goal outranks the generic "solid mental model" default — go deeper on one branch and skip another if that's what the user wants.
- **Record it.** Save the stated goal in the topic's learning file so future sessions stay aimed at it.
- No goal / "just teach me" → fall back to the standard mental-model framing, don't block.

### Level 0 Output Format

AI presents:

0. **One goal question** (open-ended, with a few example answers) — what outcome the user is chasing. Weave its answer into the level map and the per-level lens.

1. **3 Analogy Options** — each with:
   - A one-line pitch, its carrying forecast, and one verified concept→scene mapping.

2. **Depth Options** — numbered (1/2/3) so user can answer like "A2" or "B1":
   - 1) 輕鬆速成 — core mental model only; enough to predict the happy path and recognize when you're out of scope
   - 2) 紮實打底 — solid mental model; can predict common cases, handle typical edge cases, and know where the model breaks down
   - 3) 深挖細節 — comprehensive mental model; can reason about tricky trade-offs, explain "why not X", and extend the model to new scenarios

Then WAIT for user to choose. Do not assume. Do not proceed.

### Analogy Selection Discipline

The single home for analogy rules — picking, carrying, and verifying all live here:

- **Prefer proven frames** from `learning/user-profile.md` — already validated with this user. If none fit, propose a new one and say why the known frames don't work for this topic.
- **One topic, one analogy** — never mix two game worlds or metaphor systems mid-journey.
- **Carrying capacity** — the analogy must carry the ENTIRE topic, not just the first couple of levels. If it only works for L1-L2, it's a bad pick and the mental model ends up incomplete.
- **Knowledge rides ON the analogy, not beside it** — the analogy *is* the explanation. Teach the concept through the story, then map back to the technical term in one short line; do not write dry prose and bolt on a metaphor as garnish.
- **Verify before use** — if unsure about game mechanics, era-specific content, or exact terms, web-search or ask the user first. A wrong-era or wrong-fact reference kills immersion.

### After User Chooses

Confirm briefly, record the chosen analogy in the topic's learning file, then proceed to "Assess and Plan" using the chosen analogy and depth. 若這個 frame 整段課程驗證有效（或明顯沒命中），回寫 `learning/user-profile.md` 讓之後的 session 重用或避開。

---

## Implementation Modes

When the user asks for pre-implementation planning, post-implementation understanding, merge-readiness quiz, or decision-focused implementation coaching, first read `references/implementation-understanding-loop.md` and then the relevant pre/post reference. Spoken triggers: "preflight" = pre-implementation (MCQs default to **shotcall**), "debrief" = post-implementation (mixes shotcall replay + quiz; see the post reference). Keep normal level-up behavior for pure teaching.

## Teaching Flow

### 1. Assess and Plan

- Read persistent learning records first.
- Identify what can be skipped, accelerated, reviewed, or split smaller.
- Analyze concept complexity and decide the initial level count.
- Immediately use the task plan tool when available: list expected levels, keep level statuses current, and adjust the plan when questions reveal missing prerequisites.

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

- Follow the shared `html-explainer` skill for artifact structure, self-contained HTML, inline CSS/JS, no external dependencies, reviewer checks, and built-in comprehension quiz.
- Use zh-tw plain language and a mobile-friendly layout.
- **Theme: match the learner's gu-log blog (Solarized Light). Red is NOT a palette colour.** Reuse these exact tokens so every level looks consistent with their blog:
  - bg `#fdf6e3`, surface/cards `#eee8d5`, surface-hover `#e5dfc9`, borders/dividers `#d3cbb7`
  - body text `#556b73`, headings/muted `#4a5a5e`
  - emphasis (bold / em / "this is important"): Mogu orange `#955330`; links/anchors/labels: deep blue `#1c679b`; positive/good: green `#1d6a5c`
  - **Never colour bold body text red.** Reserve a single amber `#c47a00` on a pale `#fff3cd` background for genuine warning callouts only — nothing else uses red/amber.
  - Cards/callouts: surface bg, 1px `#d3cbb7` border, optional 3–4px accent-coloured left border, radius 8–18px. Fonts: `Inter`, `Noto Sans TC`; zh body line-height 1.8, headings 1.3.
  - The learner may override per-session (e.g. dark mode → gu-log Dracula: bg `#282a36`, text `#cecdda`, accent `#ff79c6`); honour it but keep Solarized Light as the standing default.
- **Beginner-acronym test:** expand every English acronym/abbreviation on first use, e.g. `IBKR（盈透證券，一家美國網路券商）`, `VT（Vanguard 全世界股票 ETF）`. When several appear, add a short glossary box up front.
- In chat, give only a short intro plus the absolute file path. Ask the user to read it before the MCQ. (Side-agent rendering: see "Delegating HTML rendering to a side agent".)

## MCQ Rules

Two MCQ kinds — the user can request either by name mid-session:

- **quiz** — tests understanding; has one correct answer. Default for pure teaching.
- **shotcall** — makes a real design decision; all serious options defensible, the user's pick IS the decision. Default for preflight/debrief decision points. Rules in "Shotcall MCQ" below.

Shared format rules:

- Use **bold** for the question. Do not use heading syntax.
- Put each option on its own line, without blank lines between options.
- Match difficulty to the current level.

### Anti-Tell Rules (avoid giving the answer away by shape)

The learner should pick the right answer by *reasoning*, not by spotting format tells. Two tells leak constantly — kill both:

- **Position must be genuinely varied.** Do NOT default to A or B. Across a session, spread the correct answer roughly evenly over A/B/C/D. Before finalizing, glance at the previous 2-3 levels' answer positions and deliberately pick a different slot. If your draft keeps landing on B, that is the tell — move it. Track positions in session working memory only — never write them into the learning records (they leak answers to any future reader).
- **Length must not signal correctness.** The most common leak: the correct option is the longest, most detailed, most hedged ("...and X, which preserves Y"), while distractors are short. Test-savvy learners just pick the longest. Fix: make every option roughly the same length. Push the full justification into your post-answer explanation, NOT into the option text. The correct option should read as terse as the wrong ones.

### Distractor Design (make wrong answers genuinely tempting)

- **3 of the 4 options must be plausible.** Distractors should be wrong for a *subtle, real* reason — a common misconception, a half-truth, the right idea applied at the wrong layer, or a true statement that does not actually answer the question. Avoid distractors that are obviously absurd or trivially eliminated (those make it a 2-way guess).
- **Tune distractor sharpness to depth.** At depth 1 (輕鬆速成), one clear right answer with softer distractors is fine. At depth 2-3 (紮實打底 / 深挖細節), make distractors close enough that the learner must actually understand the distinction to rule them out — near-misses, not strawmen.
- **Exactly one option may be intentionally, purely dumb — for fun.** Include a single absurd/joke option that nobody would seriously pick, written to make the learner snort (e.g. a wildly wrong cause, a cartoon non-sequitur, a "delete the whole database" energy answer). Never make the funny option accidentally correct.

```markdown
**問題: <question>**

A) <option A>
B) <option B>
C) <option C>
D) <option D>

---
```

### Shotcall MCQ

shotcall 不驗理解，而是**拍板真實設計決策**。preflight／debrief 的決策點預設用 shotcall；純教學課程在概念落在真實取捨上時也可穿插。

- **選項全部要講得通**：至少 3 個認真方案，各自是真實可辯護的取捨（不是誘餌）；北七選項照舊保留一個、不佔認真名額。user 選的那個**就是決策**，不是猜出題者心中的正解。
- **必標推薦**：AI 用 ★ 標自己推薦的選項＋一句理由 —— 要有觀點，不能把選項攤著就跑。Anti-tell 的位置規則不適用（推薦本來就公開），但選項長度仍應相近。
- **沒有答錯流程**：決策只有取捨沒有對錯，「Wrong Answer」的重教邏輯不適用。user 若在選項外提出更好的方案或原則，視為加碼決策，直接納入。
- **每關教完概念才出題**：先一段概念故事（含這個決策的隱藏代價／暗礁），再出決策題 —— 純投票不是 preflight。
- **一次只出一題**（user 2026-07-13 dogfood 後明確否決多題批次）。
- **決策結果記進 topic 檔**：決策是 learning state 的一部分，影響後續 session 的方向；選項字母本身仍不記（記決策內容）。

## Adaptive Response (quiz only — shotcall has no wrong answer)

### Correct Answer

- Confirm briefly, explain why the answer works, then move to the next level and preview it.

### Wrong Answer

- Stay encouraging and stay on the same level: re-explain from a different angle, ask a new check question, and record the gap if it affects future teaching.
- Miss ladder: 2 misses → simpler analogy or narrower example; 3 misses → isolate the prerequisite; 4+ misses → ask whether to split smaller, pause, or switch to a simpler concept.

## Mid-Journey Questions

Do not derail the lesson. Classify the question:

- **Immediate**: needed for current understanding or answerable in 1-2 sentences.
- **Insert before current level**: reveals missing prerequisite.
- **Defer**: advanced extension better taught later.
- **Spin off a side course**: a topic that deserves real teaching but would derail the main line (e.g. an advanced concept surfacing mid-preflight) — offer to spawn a separate teacher agent (use the runtime's subagent mechanism, e.g. Claude Code's `Agent` tool) running quiz-mode level-up on just that concept, while the main session continues.

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
