# Spec: Tribunal System — All-Claude Sequential Migration

**Author**: Planner (Opus)
**Date**: 2026-04-07
**Status**: DRAFT — pending Reviewer approval
**Requested by**: CEO

## Background

The tribunal system (4-judge quality gate) has been stopped since 2026-03-22. Only the inline single-scorer (Vibe Scorer in sp-pipeline.sh Step 4.7) is active. The full 4-judge orchestrator was never cron'd.

Current codebase uses Gemini CLI and Codex CLI for some judges — these introduce external dependencies and cost. CEO wants to consolidate to all-Claude using existing $200/month Anthropic Max quota, starting with cheap models and tuning up only if quality is insufficient.

## Model Assignments (CEO's choice: start cheap)

| Judge | Model | Rationale |
|---|---|---|
| Librarian | **Sonnet** | Cross-ref/glossary checks — structured task, Sonnet sufficient |
| Fact Checker | **Opus** | Needs deep reasoning for technical accuracy |
| Fresh Eyes | **Haiku** | First-impression readability — fast, cheap, fresh perspective |
| Vibe Scorer | **Opus** | Persona/voice quality needs nuanced judgment |
| Writer (rewrite) | **Opus** | Writing quality must be high |

Tuning policy: if a judge's output quality is noticeably bad, upgrade Haiku→Sonnet or Sonnet→Opus. Don't upgrade preemptively.

## 4-Stage Sequential Loop

Each stage: judge scores → if fail → writer rewrites with feedback → judge re-scores → repeat until pass or max loops.

```
Stage 1: Librarian (Sonnet) ↔ Writer (Opus)
  Pass bar: Librarian composite ≥ 8
  Max loops: 2

Stage 2: Fact Checker (Opus) ↔ Writer (Opus)
  Pass bar: Fact Check score ≥ 8
  Max loops: 2

Stage 3: Fresh Eyes (Haiku) ↔ Writer (Opus)
  Pass bar: floor(avg(readability, firstImpression)) ≥ 8
  Max loops: 2

Stage 4: Vibe Scorer (Opus) ↔ Writer (Opus)
  Pass bar: At least one dimension ≥ 9 AND rest ≥ 8
  Max loops: 3
```

**Fail behavior**: If any stage exhausts max loops without passing → STOP. Mark article as FAILED with stage name. Don't waste tokens on later stages.

**Stage order rationale**: Librarian first (structural fixes), then Fact Checker (accuracy), then Fresh Eyes (readability), then Vibe Scorer (voice/persona — most subjective, goes last).

## Implementation Changes

### A. Agent definition updates
- `.claude/agents/librarian.md`: keep model: sonnet (already correct)
- `.claude/agents/fresh-eyes.md`: keep model: haiku — update pass bar from ≥ 7 to ≥ 8
- `.claude/agents/fact-checker.md`: keep model: opus (already correct)
- `.claude/agents/vibe-opus-scorer.md`: keep model: opus — update pass bar to "one ≥ 9 AND rest ≥ 8"
- **NEW** `.claude/agents/tribunal-writer.md`: model: opus — rewrite agent for all stages
- Update `scripts/ralph-vibe-scoring-standard.md` Stage 4 bar to match: one ≥ 9 AND rest ≥ 8
- Update `CLAUDE.md` Fresh Eyes bar from 7 to 8

### B. New orchestrator script: `scripts/ralph-all-claude.sh`
- Replaces the old `ralph-orchestrator.sh` fan-out architecture
- Sequential 4-stage loop (not parallel)
- Each stage invokes judge via `claude -p --agent <name> --dangerously-skip-permissions` (model set in agent frontmatter, NOT via --model CLI flag)
- Writer invoked via `claude -p --agent tribunal-writer --dangerously-skip-permissions` with judge's feedback + scoring standard SSOT
- Use `--dangerously-skip-permissions` (matches existing VM cron pattern), NOT `--permission-mode bypassPermissions`
- Timeouts: scorer 5min, writer 15min
- Build check (`pnpm run build`) after every writer rewrite, git revert on failure

### C. Remove Gemini/Codex dependencies from critical path
- `sp-pipeline.sh`: make `--opus` mode the default (skip Gemini/Codex fallback chain)
- `check_required_tools()`: remove `bird`, `gemini`, `codex` from required list
- Keep old code as dead code for now (don't delete)

### D. Integration
- **New articles**: Replace sp-pipeline.sh Step 4.7 with 4-stage loop call
- **Backlog**: `ralph-all-claude.sh <filename>` standalone mode
- **Cron on VM**: Add entry following existing CC cron pattern (OAuth token, TZ, logging)
- Quiet hours preserved: weekday 20:00-02:00 TST pause

### E. Progress tracking
- `scores/tribunal-progress.json`: written after EACH stage (enables crash resume)
- Per-stage results: stage name, model used, score JSON, pass/fail, attempt count
- Each article gets a stage-by-stage audit trail
- On restart, check progress file and resume from last incomplete stage (not start over)

### F. Fix Reviewer-identified gaps
- Update `scripts/score-helpers.sh` `validate_judge_score_json()`: add cases for `librarian`, `fact-checker`, `fresh-eyes`, `vibe-opus-scorer` judge names with their respective JSON schemas
- Update rate-limit backoff defaults to include haiku/sonnet judge names
- VM gu-log repo path is `/home/clawd/clawd/projects/gu-log/` (NOT `~/gu-log/`)

### G. Frontmatter score format
- Each judge writes its own block in frontmatter (4 blocks total)
- **Schema TBD** — CEO will design with Planner via Agent Team

## Cost Estimate

| Scenario | claude -p calls | Rate limit impact |
|---|---|---|
| Best case (all pass first try) | 4 | Minimal |
| Typical | 8-10 | ~5-7 articles/week |
| Worst case (all max loops) | 14 | ~4 articles/week |

Mixed models (Haiku + Sonnet + Opus) will be cheaper and faster than all-Opus. Haiku and Sonnet calls don't count toward Opus rate limits.

## Acceptance Criteria

- [ ] All 4 judge agents use `claude -p` (no Gemini CLI, no Codex CLI)
- [ ] Models match CEO's assignment: Librarian=Sonnet, FactChecker=Opus, FreshEyes=Haiku, VibeScorer=Opus, Writer=Opus
- [ ] 4 stages run sequentially in specified order
- [ ] Each stage implements judge→fail→writer rewrite→re-judge loop
- [ ] Pass bars match spec (Stage 1: ≥8, Stage 2: ≥8, Stage 3: avg≥8, Stage 4: one≥9+rest≥8)
- [ ] Max loops enforced (2, 2, 2, 3)
- [ ] Failed stage stops pipeline for that article
- [ ] Writer receives judge feedback + scoring standard SSOT
- [ ] Progress tracking records per-stage results
- [ ] Standalone mode works: `bash scripts/ralph-all-claude.sh <filename>`
- [ ] Integration with sp-pipeline.sh Step 4.7
- [ ] Build check after every rewrite
- [ ] Cron entry on VM with OAuth token, TZ, logging
- [ ] Quiet hours: weekday 20:00-02:00 TST pause
- [ ] Scorer timeout: 5min, Writer timeout: 15min
- [ ] Scoring standard SSOT updated: Stage 4 bar = one ≥ 9 AND rest ≥ 8, Fresh Eyes bar = ≥ 8
- [ ] CLAUDE.md updated: Fresh Eyes bar from 7 to 8
- [ ] `score-helpers.sh` `validate_judge_score_json()` handles all new judge names
- [ ] `.claude/agents/tribunal-writer.md` created (model: opus)
- [ ] Progress written after each stage (enables crash resume)
- [ ] Uses `--dangerously-skip-permissions` (not `--permission-mode bypassPermissions`)
- [ ] Frontmatter score format per CEO design (TBD)

## Out of Scope
- Modifying the scoring rubric itself
- Migrating historical scores from gemini/codex JSON files
- Removing old Gemini/Codex code entirely (leave as dead code)
- Changing sp-pipeline.sh writer/review/refine stages (Steps 2-4)

## Dependencies
- Anthropic Max plan active
- `claude` CLI on VM with valid OAuth token
- VM gu-log repo up-to-date

## Key files reference
- `scripts/ralph-orchestrator.sh` — current orchestrator (to be replaced)
- `scripts/score-loop-engine.sh` — generic judge loop engine
- `scripts/tribunal-gate.sh` — convergence rewrite loop
- `scripts/judges/{gemini,codex,opus,sonnet}.sh` — per-judge scripts
- `scripts/vibe-scorer.sh` — Opus vibe scorer wrapper
- `scripts/ralph-vibe-scoring-standard.md` — scoring SSOT
- `.claude/agents/{librarian,fact-checker,fresh-eyes,vibe-opus-scorer}.md` — agent definitions
