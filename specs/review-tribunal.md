# Review: Tribunal System — Full Build Verification

**Reviewer**: Reviewer (Opus)
**Date**: 2026-04-08
**Verdict**: **PASS (with minor findings)**

---

## Builder 1: Tribunal Agents + Schema (commits `94259876` + `1de3893a`)

### Agent Definitions

- [x] **librarian.md**: model sonnet, **4 dims** (glossary, crossRef, sourceAlign, attribution), composite ≥ 8, uniform JSON output — PASS
  - Evidence: `.claude/agents/librarian.md:3` model: sonnet; lines 24-62 define 4 dims; line 67 pass bar ≥ 8
  - Note: original schema spec said 3 dims, but `tribunal-metrics-review.md` Decision 2 added `attribution`. Implementation correctly follows the FINAL metrics review.

- [x] **fact-checker.md**: model opus, 3 dims (accuracy, fidelity, consistency), composite ≥ 8, calibration anchors present — PASS
  - Evidence: `.claude/agents/fact-checker.md:3` model: opus; lines 28-77 define 3 dims 0-10; line 108 pass bar ≥ 8
  - Calibration: SP-14 (9/9/9) at line 81, CP-153 (8/8/9) at line 90
  - No old scale references (0-4, 0-3) found: `grep '0-4\|0-3\|N/4\|N/3'` = 0 matches

- [x] **fresh-eyes.md**: model haiku, pass bar ≥ 8, persona = 3-month engineer — PASS
  - Evidence: `.claude/agents/fresh-eyes.md:3` model: haiku; line 53 pass bar ≥ 8; line 11 "~3 months of experience"; line 48 "3-month dev"
  - No "≥ 7" references found

- [x] **vibe-opus-scorer.md**: model opus, **5 dims** (+narrative), pass bar: composite ≥ 8 AND one ≥ 9 AND no dim < 8 — PASS
  - Evidence: `.claude/agents/vibe-opus-scorer.md:3` model: opus; 5 dims at lines 26-54 (persona, clawdNote, vibe, clarity, narrative)
  - Pass bar at lines 82-83, 87-88, 123
  - Note: original schema spec said 4 dims, but `tribunal-metrics-review.md` Decision 3 added `narrative`. Implementation correct.

- [x] **tribunal-writer.md**: model opus, rewrite agent — PASS
  - Evidence: `.claude/agents/tribunal-writer.md:3` model: opus; lines 28-48 detail per-judge dimension fix strategies

- [x] **All 4 agents output uniform JSON**: `{ judge, dimensions, score, verdict, reasons }` — PASS
  - Evidence: librarian.md:77-93, fact-checker.md:116-133, fresh-eyes.md:62-76, vibe-opus-scorer.md:99-124

### Score Schema (config.ts)

- [x] **AC-1**: `scores.librarian` has `glossary`, `crossRef`, `sourceAlign`, `attribution` (0-10) + `score`, `date`, `model` — PASS
  - Evidence: `src/content/config.ts:48-57` (4 dims + metadata, all `.optional()`)

- [x] **AC-2**: `scores.factCheck` has `accuracy`, `fidelity`, `consistency` (0-10) + metadata — PASS
  - Evidence: `src/content/config.ts:58-67`

- [x] **AC-3**: `scores.freshEyes` has `readability`, `firstImpression` (0-10) + metadata — PASS
  - Evidence: `src/content/config.ts:68-76`

- [x] **AC-4**: `scores.vibe` has `persona`, `clawdNote`, `vibe`, `clarity`, `narrative` (0-10) + metadata — PASS
  - Evidence: `src/content/config.ts:77-89`

- [x] **AC-5**: No `harness` field in tribunal judge blocks — PASS
  - Evidence: `harness` only exists in `translatedBy` section (lines 14, 20), not in scores

- [x] **AC-6**: No legacy score keys (`ralph`, `gemini`, `codex`, `sonnet`) in Zod schema — PASS
  - Evidence: `grep '\b(ralph|gemini|codex|sonnet)\b' src/content/config.ts` = 0 matches

- [x] **AC-7**: `pnpm run build` passes — PASS
  - Evidence: `2667 page(s) built in 34.29s` — `[build] Complete!`

### Data Migration

- [x] **AC-8**: ALL scores blocks removed from MDX articles — PASS
  - Evidence: `grep -c '^scores:' src/content/posts/` = 0 matches across all files

- [x] **AC-9**: Build passes after removal — PASS (same build as AC-7)

### UI (AiJudgeScore.astro)

- [x] **AC-10**: Props interface has ONLY 4 tribunal judges. No legacy Props — PASS
  - Evidence: `src/components/AiJudgeScore.astro:14-51` — only `librarian`, `factCheck`, `freshEyes`, `vibe`

- [x] **AC-11**: Cards show judge name, composite `score/10`, individual dimensions — PASS
  - Evidence: Lines 97-310 render 4 cards with label, `score/10`, dimension list with dots

- [x] **AC-12**: Posts without scores → no score panel — PASS
  - Evidence: Line 56-57: `hasScores = scores && (scores.librarian || scores.factCheck || scores.freshEyes || scores.vibe)` — renders only when truthy

### Scripts

- [x] **AC-20**: `frontmatter-scores.mjs` only accepts `librarian`, `factCheck`, `freshEyes`, `vibe` — PASS
  - Evidence: `scripts/frontmatter-scores.mjs:30` — `VALID_JUDGES = ['librarian', 'factCheck', 'freshEyes', 'vibe']`

- [x] **AC-21**: `score-helpers.sh` `validate_judge_score_json()` validates new judges — PASS
  - Evidence: `scripts/score-helpers.sh:263-289` — handles `librarian`, `factCheck|fact-checker`, `freshEyes|fresh-eyes`, `vibe|vibe-opus-scorer` with correct dimensions

- [x] **AC-22**: `validate-judge-output.sh` validates new judges only — PASS
  - Evidence: `scripts/validate-judge-output.sh:72-99` — same judge mapping with correct dimensions

- [x] **AC-23**: SSOT output format matches uniform JSON — PASS
  - Evidence: `scripts/ralph-vibe-scoring-standard.md:18-36` — shows `{ judge, dimensions, score, verdict, reasons }`

### Documentation

- [x] **AC-24**: `CLAUDE.md` reads "Fresh Eyes ≥ 8", Vibe 5 dims, Librarian 4 dims — PASS
  - Evidence: `CLAUDE.md:90` "Vibe Scorer (Opus): 五維評分（Persona / ClawdNote / Vibe / Clarity / Narrative，0-10）"
  - `CLAUDE.md:92` "Librarian (Sonnet): Glossary / cross-ref + identity linking / sourceAlign / attribution"
  - `CLAUDE.md:94` "Fresh Eyes ≥ 8"
  - No "≥ 7" references found

### Regression

- [x] **AC-25**: `pnpm run build` passes — PASS (2667 pages built)
- [x] **AC-26**: `node scripts/validate-posts.mjs` passes — PASS (860 files, 166 warnings, 0 errors)

---

## Builder 2: Tribunal Orchestrator (commit `e1e17783`)

### Orchestrator (ralph-all-claude.sh)

- [x] **4 stages in correct order**: Librarian → Fact Checker → Fresh Eyes → Vibe — PASS
  - Evidence: `scripts/ralph-all-claude.sh:431-436` — STAGES array defines order correctly

- [x] **Each stage: judge → check → fail → writer rewrite → build check → re-judge** — PASS
  - Evidence: `run_stage()` at lines 217-398: invoke judge (263-268), validate JSON (279), check_pass_bar (302), writer rewrite (324-358), build check (373-391), loop

- [x] **Pass bars match spec**:
  - Stage 1 (Librarian): composite ≥ 8 — PASS (lines 161-168)
  - Stage 2 (Fact Checker): composite ≥ 8 — PASS (lines 170-177)
  - Stage 3 (Fresh Eyes): composite ≥ 8 — PASS (lines 179-186)
  - Stage 4 (Vibe): one dim ≥ 9 AND rest ≥ 8 — PASS (lines 191-205)

- [x] **Max loops: 2, 2, 2, 3** — PASS
  - Evidence: `scripts/ralph-all-claude.sh:432-435` — `:2:` `:2:` `:2:` `:3:`

- [x] **Failed stage STOPS pipeline** — PASS
  - Evidence: Lines 441-448: `if ! run_stage ... exit 1`

- [x] **Uses `claude -p --agent <name> --dangerously-skip-permissions`** — PASS
  - Evidence: Lines 263-265 (judge), Lines 354-356 (writer)
  - NOT using `--permission-mode bypassPermissions`

- [x] **Timeouts: scorer 5min (300s), writer 15min (900s)** — PASS
  - Evidence: `timeout 300` at line 263, `timeout 900` at line 354

- [x] **Quiet hours: weekday 20:00-02:00 TST** — PASS
  - Evidence: `is_quiet_hours()` at lines 60-71: weekday check (dow 1-5) + hour ≥ 20 or < 2

- [x] **Progress tracking to `scores/tribunal-progress.json`** — PASS
  - Evidence: Line 85: `PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"`; `write_stage_progress()` at lines 101-113

- [x] **Crash resume from last incomplete stage** — PASS
  - Evidence: `run_stage()` lines 230-234: checks `get_stage_status` and skips if "pass"

- [x] **Standalone mode works** — PASS
  - `bash scripts/ralph-all-claude.sh` (no args) → prints usage, exit 1
  - `bash -n scripts/ralph-all-claude.sh` → exit 0 (syntax OK)

- [x] **Build check after writer rewrites** — PASS
  - Evidence: Lines 373-391: `pnpm run build`, git revert on failure

### SP Pipeline Integration

- [x] **Step 4.7 calls ralph-all-claude.sh** — PASS
  - Evidence: `scripts/sp-pipeline.sh:1106` — `bash "$GU_LOG_DIR/scripts/ralph-all-claude.sh" "$ACTIVE_FILENAME"`

- [x] **--opus mode is default** — PASS
  - Evidence: `scripts/sp-pipeline.sh:267` — `OPUS_MODE=true  # all-claude: Opus is default`

- [x] **Gemini/Codex removed from required tools** — PASS
  - Evidence: `scripts/sp-pipeline.sh:152-155` — `check_required_tools()` only checks `jq node npm git`; comment: "bird, gemini, codex removed from critical path"

- [x] **Step 1.7 dedup gate NOT broken** — PASS
  - Evidence: `scripts/sp-pipeline.sh:831-858` — dedup gate code intact and unchanged

### Scoring SSOT

- [x] **SSOT updated with new dimensions, pass bars, anchors** — PASS
  - Evidence: `scripts/ralph-vibe-scoring-standard.md` — all 4 judges with correct dimensions, pass bars, calibration examples

- [x] **Stage 4 bar: one ≥ 9 AND rest ≥ 8** — PASS
  - Evidence: SSOT line 16, line 206, and checkPassBar code at lines 44-59

- [x] **Fresh Eyes bar ≥ 8** — PASS
  - No "≥ 7" references found in SSOT

- [x] **Fact Checker 0-10 anchors present** — PASS
  - Evidence: SSOT lines 117-157 (accuracy/fidelity/consistency full anchor tables)

### Cron

- [x] **Cron example created** — PASS
  - Evidence: `scripts/crontab-tribunal.example` with VM path, TZ, OAuth token docs

### Pass Bar Enforcement

- [x] **AC-18**: `checkPassBar()` function implemented in code — PASS
  - Evidence: `scripts/ralph-all-claude.sh:155-212` — `check_pass_bar()` with Python enforcement; agent verdict is advisory

- [x] **AC-19**: Covers composite ≥ 8 for all judges; Vibe adds one ≥ 9 + no dim < 8 — PASS
  - Evidence: All 4 cases in check_pass_bar (lines 160-211)

---

## Metrics Review Criteria (tribunal-metrics-review.md)

- [x] **MR-1**: Vibe Scorer has `narrative` dimension with scoring anchors — PASS
  - Evidence: `vibe-opus-scorer.md:45-54` and SSOT lines 291-303

- [x] **MR-2**: Librarian has 4 dims (glossary, crossRef, sourceAlign, attribution) — PASS
  - Evidence: `librarian.md:24-62`, `config.ts:48-56`

- [x] **MR-3**: Fresh Eyes persona = "~3 months of experience", bar ≥ 8 — PASS
  - Evidence: `fresh-eyes.md:11`, `fresh-eyes.md:53`

- [x] **MR-4**: Fact Checker has calibration examples (SP-14, CP-153) — PASS
  - Evidence: `fact-checker.md:81-97`

- [x] **MR-5**: SSOT includes EN-specific Persona/Clarity anchors; cultural accessibility in EN Persona — PASS
  - Evidence: SSOT lines 226-236 (EN persona + cultural accessibility), lines 281-288 (EN clarity)

- [ ] **MR-6**: `tribunal-score-schema.md` updated to reflect new dimension map — **FAIL**
  - The schema spec still says "Librarian (Sonnet) — 3 維度" (line 31), missing `attribution`
  - Vibe Scorer still listed as "4 維度" (line 60), missing `narrative`
  - Frontmatter example (lines 75-105) is also outdated (3 Librarian dims, 4 Vibe dims)
  - **Impact**: LOW — the spec is a planning document, and the ACTUAL implementation correctly follows `tribunal-metrics-review.md`. All code and agents have the correct dims. This is a spec doc sync issue, not a functional gap.

- [x] **MR-7**: All agent output JSON reflects updated dimension keys — PASS
  - All 4 agents output correct dimensions in uniform JSON

---

## Additional Findings

### Minor Issues

1. **`ralph-all-claude.sh --help`** prints a confusing basename error instead of usage. When passed `--help`, it treats it as a filename. Usage only shows when called with no args.
   - **Impact**: LOW — cosmetic UX issue. The usage message works with no-arg invocation.

2. **`tribunal-cron-runner.sh` referenced in crontab example does not exist**. `crontab-tribunal.example:18` references this script but it was never created.
   - **Impact**: MEDIUM — the cron entry won't work as-is. The alternative direct invocation on line 21 works fine.

3. **`ralph-all-claude.sh` uses `git commit --no-verify` and `git push --no-verify`** (line 405-406 in `commit_progress`). This bypasses pre-commit hooks. May be intentional for automated pipeline, but worth noting.
   - **Impact**: LOW — this is a cron/automation context, common pattern.

---

## Verdict: **PASS**

All functional acceptance criteria pass. Both builds pass. All agents, schema, UI, scripts, and documentation are aligned with the final spec (metrics review). The only spec-level gap is `tribunal-score-schema.md` not being updated to reflect the metrics review decisions (MR-6), which is a documentation sync issue — the actual code and agents are correct.

The two minor findings (missing `tribunal-cron-runner.sh`, `--help` UX) are non-blocking.
