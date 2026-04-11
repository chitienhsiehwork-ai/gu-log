# Tribunal v2 Implementation Spec

> **Priority**: P1
> **Requested by**: CEO
> **Date**: 2026-04-08
> **Spec by**: Planner (Opus)
> **Status**: PENDING CTO REVIEW

## Overview

Tribunal v2 addresses 6 issues identified through real-world data (4 PASS / 8 FAILED / 27 pending after 14 hours). The core problems:

1. **FactChecker accuracy=7 can pass** — the `floor(avg)` composite lets a 7 slip through (bug)
2. **FAILED articles retry forever** — no cross-run cap, infinite token burn on articles that can't pass Vibe
3. **No regression check** — Vibe rewrites (the most invasive) can damage earlier stages' work without detection
4. **Writer lacks Vibe-specific context** — writer gets generic SSOT but not the scorer's detailed rubric
5. **Binary quota pacing** — GO/STOP lacks nuance; burns tokens too aggressively above floor, no gradual pacing
6. **Monitoring requires CC sessions** — no zero-token heartbeat; Monitor agent runs cost sessions every 50 min

---

## Change 1: FactChecker Accuracy Floor (Bug Fix)

**Priority**: P0 (data integrity bug)
**Files to modify**: `scripts/ralph-all-claude.sh`

### What to change

In the `check_pass_bar()` function, `fact-checker` case (lines 170-178):

**Current logic:**
```python
composite = math.floor(sum(vals) / len(vals))
sys.exit(0 if composite >= 8 else 1)
```

**New logic — add accuracy floor check before composite check:**
```python
accuracy = dims.get('accuracy', 0)
if accuracy < 8:
    sys.exit(1)
composite = math.floor(sum(vals) / len(vals))
sys.exit(0 if composite >= 8 else 1)
```

### Rationale

Real data: `cp-pending-*` passed with accuracy=7, fidelity=8, consistency=9 → floor(24/3) = 8 → PASS. A fact checker that lets accuracy=7 through is not doing its job. The reviewer report flagged this as High severity.

### Acceptance Criteria

- [ ] `check_pass_bar "fact-checker"` with `{"accuracy":7,"fidelity":9,"consistency":9}` returns exit code 1 (FAIL)
- [ ] `check_pass_bar "fact-checker"` with `{"accuracy":8,"fidelity":8,"consistency":8}` returns exit code 0 (PASS)
- [ ] `check_pass_bar "fact-checker"` with `{"accuracy":8,"fidelity":7,"consistency":9}` returns exit code 0 (PASS) — only accuracy has a floor, other dims still use composite
- [ ] Existing Librarian, FreshEyes, and Vibe pass bars unchanged

### Out of Scope

- No accuracy floor for Librarian or FreshEyes (their dimensions are less critical individually)
- No retroactive re-check of already-passed articles

---

## Change 2: Cross-Run Retry Cap

**Priority**: P0 (prevents infinite token burn)
**Files to modify**: `scripts/ralph-all-claude.sh`, `scripts/tribunal-quota-loop.sh`

### What to change

#### 2a. Track failure count in progress JSON (`ralph-all-claude.sh`)

In `mark_article_failed()` (lines 132-141), increment a `failureCount` field:

```bash
mark_article_failed() {
  local article="$1" failed_stage="$2"
  local tmp
  tmp="$(mktemp)"
  jq --arg a "$article" \
     --arg s "$failed_stage" \
     --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
     '.[$a].status = "FAILED"
      | .[$a].failedStage = $s
      | .[$a].finishedAt = $ts
      | .[$a].failureCount = ((.[$a].failureCount // 0) + 1)' \
     "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
}
```

After `mark_article_failed`, check failureCount. If >= 3, upgrade status to `NEEDS_REVIEW`:

```bash
# After mark_article_failed in the main loop (around line 445):
local failure_count
failure_count="$(jq -r --arg a "$POST_FILE" '.[$a].failureCount // 0' "$PROGRESS_FILE")"
if [ "$failure_count" -ge 3 ]; then
  tlog "=== NEEDS_REVIEW: $POST_FILE failed $failure_count times across runs ==="
  tmp="$(mktemp)"
  jq --arg a "$POST_FILE" '.[$a].status = "NEEDS_REVIEW"' \
     "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  commit_progress "tribunal(${POST_FILE%.mdx}): NEEDS_REVIEW after $failure_count failures"
fi
```

#### 2b. Reset stage progress on re-run (`ralph-all-claude.sh`)

When `init_article_progress()` finds an existing entry with status=FAILED, it must **clear all stage statuses** so the pipeline runs from stage 1 again (not crash-resume from a passed stage that may have been damaged by a prior Vibe rewrite):

In `init_article_progress()` (lines 115-130), add:

```bash
# If article previously FAILED, reset stages for fresh run
local existing_status
existing_status="$(jq -r --arg a "$article" '.[$a].status // "pending"' "$PROGRESS_FILE")"
if [ "$existing_status" = "FAILED" ]; then
  jq --arg a "$article" \
     --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
     '.[$a].stages = {} | .[$a].status = "in_progress" | .[$a].restartedAt = $ts' \
     "$PROGRESS_FILE" > "$tmp" && mv "$tmp" "$PROGRESS_FILE"
  tlog "Reset stages for previously FAILED article $article (re-run from stage 1)"
fi
```

#### 2c. Skip NEEDS_REVIEW in `get_unscored_articles()` (`tribunal-quota-loop.sh`)

In `get_unscored_articles()` (lines 91-119), change the skip condition from:

```bash
if [ "$status" = "PASS" ]; then
  continue
fi
```

To:

```bash
if [ "$status" = "PASS" ] || [ "$status" = "NEEDS_REVIEW" ]; then
  continue
fi
```

### Acceptance Criteria

- [ ] `tribunal-progress.json` gains `failureCount` field, incremented on each FAILED mark
- [ ] After 3rd failure on same article, status changes to `NEEDS_REVIEW`
- [ ] `get_unscored_articles()` skips both `PASS` and `NEEDS_REVIEW` articles
- [ ] A FAILED article (failureCount < 3) is retried with all stages cleared (fresh run)
- [ ] A NEEDS_REVIEW article is NOT retried by the quota loop
- [ ] Commit message clearly indicates NEEDS_REVIEW status
- [ ] Existing PASS articles unaffected

### Out of Scope

- No notification to CEO for NEEDS_REVIEW articles (heartbeat in Change 6 will handle alerting)
- No automatic recovery from NEEDS_REVIEW (requires human intervention or manual reset)

---

## Change 3: Vibe Regression Check

**Priority**: P1 (prevents cross-stage damage)
**Files to modify**: `scripts/ralph-all-claude.sh`

### What to change

After a Vibe rewrite (inside `run_stage` when `stage_key == "vibe"`, after the writer completes and build check passes), re-run Librarian and FactChecker as regression checks.

This is best implemented as a new function `run_vibe_regression_check()` called from within `run_stage()` after a successful Vibe rewrite + build pass.

#### New function: `run_vibe_regression_check()`

```bash
# Returns 0 = regression check passed, 1 = regression detected
run_vibe_regression_check() {
  local post_file="$1"
  local regression_attempt="$2"  # 1 or 2
  local score_tmp

  tlog "  Regression check $regression_attempt/2 after Vibe rewrite..."

  # Re-run Librarian
  score_tmp="$(mktemp /tmp/tribunal-regression-librarian-XXXXXX.json)"
  tlog "    Re-running Librarian (regression check)..."
  local judge_out judge_rc
  judge_out="$(mktemp)"
  judge_rc=0
  timeout 300 claude -p \
    --agent librarian \
    --dangerously-skip-permissions \
    "Score this post: src/content/posts/$post_file
Write your JSON result to: $score_tmp" \
    > "$judge_out" 2>&1 || judge_rc=$?
  rm -f "$judge_out"

  if ! validate_judge_score_json "librarian" "$score_tmp" || \
     ! check_pass_bar "librarian" "$score_tmp"; then
    tlog "    Librarian regression FAILED"
    rm -f "$score_tmp"
    return 1
  fi
  tlog "    Librarian regression PASSED"
  rm -f "$score_tmp"

  # Re-run FactChecker
  score_tmp="$(mktemp /tmp/tribunal-regression-factchecker-XXXXXX.json)"
  tlog "    Re-running FactChecker (regression check)..."
  judge_out="$(mktemp)"
  judge_rc=0
  timeout 300 claude -p \
    --agent fact-checker \
    --dangerously-skip-permissions \
    "Score this post: src/content/posts/$post_file
Write your JSON result to: $score_tmp" \
    > "$judge_out" 2>&1 || judge_rc=$?
  rm -f "$judge_out"

  if ! validate_judge_score_json "fact-checker" "$score_tmp" || \
     ! check_pass_bar "fact-checker" "$score_tmp"; then
    tlog "    FactChecker regression FAILED"
    rm -f "$score_tmp"
    return 1
  fi
  tlog "    FactChecker regression PASSED"
  rm -f "$score_tmp"

  return 0
}
```

#### Integration into `run_stage()`

After the build check passes inside the Vibe stage rewrite loop (after line 388 `tlog "  Build passed after rewrite."`), add:

```bash
# Regression check only for Vibe stage
if [ "$stage_key" = "vibe" ]; then
  local regression_ok=false
  for reg_attempt in 1 2; do
    if run_vibe_regression_check "$post_file" "$reg_attempt"; then
      regression_ok=true
      break
    fi
    tlog "  Regression check $reg_attempt FAILED. Reverting and retrying Vibe rewrite..."
    git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
    local en_file="src/content/posts/en-$post_file"
    [ -f "$en_file" ] && git checkout -- "$en_file" 2>/dev/null || true
    # Don't break — let the Vibe rewrite loop retry
  done
  if [ "$regression_ok" = false ]; then
    tlog "  Regression check failed after 2 attempts. Counting as Vibe failure."
    # This attempt is consumed; the outer loop will retry or fail
  fi
fi
```

**Key design decisions:**
- Max 2 regression attempts per Vibe rewrite attempt
- Regression failure = revert to pre-rewrite state + count as Vibe attempt consumed
- Regression re-runs Librarian (cheapest, catches broken links) AND FactChecker (catches fact damage)
- Fresh Eyes is NOT re-run (its 2 dimensions are least likely to be damaged by structural rewrites)

### Acceptance Criteria

- [ ] After Vibe rewrite + build pass, Librarian and FactChecker re-run automatically
- [ ] If regression passes, Vibe re-scoring proceeds normally
- [ ] If regression fails, article is reverted to pre-rewrite state
- [ ] Max 2 regression attempts per Vibe rewrite attempt
- [ ] Regression failure consumes a Vibe attempt (counted toward max_loops=3)
- [ ] Regression results are logged with `tlog`
- [ ] Non-Vibe stages (Librarian, FactChecker, FreshEyes) do NOT trigger regression checks

### Out of Scope

- No regression check after non-Vibe rewrites (Librarian/FactChecker/FreshEyes rewrites are low-risk)
- No regression scoring stored in progress JSON (only pass/fail matters for gating)

---

## Change 4: Judge Improvement Feedback + Writer Prompt Redesign

**Priority**: P1 (improves convergence rate for ALL stages, not just Vibe)
**Files to modify**:
- `.claude/agents/vibe-opus-scorer.md` — add improvement output instructions
- `.claude/agents/librarian.md` — add improvement output instructions
- `.claude/agents/fact-checker.md` — add improvement output instructions
- `.claude/agents/fresh-eyes.md` — add improvement output instructions
- `scripts/ralph-all-claude.sh` — simplify writer prompt
- `scripts/ralph-vibe-scoring-standard.md` — document new output schema

### Design Philosophy

**Old approach (rejected):** stuff the judge's raw prompt into the writer, let writer infer what to fix.
**New approach:** judges output actionable improvement feedback on FAIL. Writer reads judge feedback directly — no guessing, no context rot.

### 4a. Judge Output Schema Change

**Current schema** (5 fields):
```json
{
  "judge": "vibe",
  "dimensions": { "persona": 6, "clawdNote": 5, ... },
  "score": 6,
  "verdict": "FAIL",
  "reasons": { "persona": "One-sentence assessment.", ... }
}
```

**New schema** (7 fields — 2 new, only present on FAIL):
```json
{
  "judge": "vibe",
  "dimensions": { "persona": 6, "clawdNote": 5, "vibe": 7, "clarity": 8, "narrative": 4 },
  "score": 6,
  "verdict": "FAIL",
  "reasons": {
    "persona": "LHY feel present in analogies but skeleton is a linear report — Decorative Persona Trap.",
    "clawdNote": "All 6 notes are explain-only. Zero opinion stance detected.",
    "vibe": "Readable but not shareable. Bullet-dump ending kills momentum.",
    "clarity": "Body text avoids 你/我. Speaker attribution clean.",
    "narrative": "Strip analogies and kaomoji: remaining skeleton is intro → expand → expand → conclude. Linear."
  },
  "improvements": {
    "persona": "Open with the twist about agent traces being 'AI diary entries' (paragraph 7) instead of the context-setting intro. Move current intro to paragraph 2.",
    "clawdNote": "Notes at lines 45, 78, 112 are explain-only. Convert to opinion-first: 'I think the author underestimates X because...' or 'This is wrong — here's why...'",
    "vibe": "Replace bullet-dump ending (lines 180-195) with a callback to the opening hook. One memorable line > five summary bullets.",
    "narrative": "Current structure: linear (intro→A→B→C→conclusion). Restructure: hook with the trace visualization surprise (section 3) → flashback to why traces matter → build to the 'aha' moment → callback ending."
  },
  "critical_issues": [
    "Decorative Persona Trap — surface features present (analogies, kaomoji, callbacks) but skeleton is a linear report. This caps persona ≤ 5 and narrative ≤ 5. Root cause: must restructure, not decorate.",
    "All ClawdNotes are explain-only — no opinion, no stance, no challenge to the source. This caps clawdNote ≤ 6."
  ]
}
```

**Schema rules:**
- `improvements` — object keyed by dimension name. **Only include dimensions that scored below the stage's pass threshold.** Each value is 1-3 actionable sentences citing specific locations (line numbers, paragraphs, section names) in the article. Prescriptive ("do X") not suggestive ("consider X").
- `critical_issues` — array of 1-3 strings, ordered by severity. These are **root causes**, not symptoms. If fixing one issue would raise 2+ dimensions, it belongs here. First issue = highest priority for the writer.
- Both fields are **omitted on PASS** (saves tokens).
- `reasons` stays as-is (one-sentence diagnostic per dimension, present on both PASS and FAIL).

**Pass threshold per stage** (judge uses these to decide which dims get improvements):
| Stage | Threshold | Rule |
|-------|-----------|------|
| Librarian | dim contributes to composite < 8 | Improve any dim that drags composite below 8 |
| FactChecker | accuracy < 8 OR composite < 8 | Improve accuracy if < 8 (hard floor), plus any dim dragging composite |
| FreshEyes | dim contributes to composite < 8 | Improve any dim that drags composite below 8 |
| Vibe | any dim < 8 OR no dim >= 9 | Improve all dims < 8; if no dim >= 9, suggest which dim to push to 9 |

### 4b. Judge Agent Prompt Changes

Add the following section to **each judge agent prompt** (before the Output section):

#### Shared addition (all 4 judges):

```markdown
## Improvement Feedback (FAIL only)

When verdict is FAIL, add two extra fields to your output JSON:

### improvements
Object keyed by dimension name. Only include dimensions below the pass threshold.
Each value: 1-3 actionable sentences telling the writer EXACTLY what to fix.
- **Be specific**: cite line numbers, paragraph positions, specific text from the article
- **Be prescriptive**: "Move paragraph 7 to the opening" not "Consider restructuring"
- **Reference the rubric**: "This is the Decorative Persona Trap (caps persona at 5)"
- **Give concrete examples**: "Convert 'Transformer is a neural network architecture' to 'I think the author oversells Transformers here — they're not magic, they're just matrix multiplication with attention'"

### critical_issues
Array of 1-3 strings, ordered by severity. Root causes only.
A root cause = one fix that would raise 2+ dimensions. Put it here, not in per-dim improvements.
Example: "Decorative Persona Trap — skeleton is linear report. Must restructure, not decorate. Caps persona ≤ 5 AND narrative ≤ 5."

When verdict is PASS, omit both fields entirely.
```

#### Judge-specific improvement guidance:

**Librarian** — append to improvement instructions:
```markdown
Librarian improvements should be mechanical and precise:
- glossary: "Link term [X] to /glossary#x in paragraph N (line M)"
- crossRef: "Add ShroomDog → /about link at first mention (line M). Add thematic link to /posts/slug/ in section N."
- sourceAlign: "Section N drifts from source topic — source discusses X but post discusses Y"
- attribution: "Quote in paragraph N (line M) needs speaker attribution — who said this?"
```

**FactChecker** — append to improvement instructions:
```markdown
FactChecker improvements should cite specific claims:
- accuracy: "Claim 'X outperforms by 40%' (line M) — source says 'approximately 30%'. Correct the number or add hedge 'roughly'."
- fidelity: "Paragraph N converts 'might revolutionize' to '將會革命' — restore uncertainty hedge to '可能會改變'"
- consistency: "Conclusion in paragraph N contradicts claim in paragraph M — resolve by [specific suggestion]"
```

**FreshEyes** — append to improvement instructions:
```markdown
FreshEyes improvements should be blunt and reader-focused:
- readability: "Paragraph N is a jargon dump — explain 'MoE' before using it, or link to glossary"
- firstImpression: "Lost interest at paragraph N — boring stretch. What's the hook? Lead with it."
Keep suggestions simple — you're a 3-month dev, suggest fixes a 3-month dev would appreciate.
```

**Vibe** — append to improvement instructions:
```markdown
Vibe improvements should reference the specific scoring traps and rubric:
- persona: Reference Decorative Persona Trap if applicable. Suggest specific structural changes, not surface edits.
- clawdNote: Tag which notes are explain-only vs opinion. Suggest specific opinion conversions.
- vibe: Identify the specific vibe killer (bullet-dump ending? template structure? motivational closing?)
- clarity: Cite specific 你/我 instances in body text with line numbers.
- narrative: Describe the current skeleton structure (e.g., "intro→A→B→C→conclusion = linear"). Suggest an alternative arc (e.g., "hook with C → flashback to A → build through B → callback ending").
If no dimension ≥ 9, suggest which dimension is closest and what would push it over.
```

### 4c. Writer Prompt Simplification

In `run_stage()`, replace the current writer prompt (lines 329-349) with a streamlined version that relies on judge feedback instead of embedded SSOT:

```bash
writer_prompt="$(cat <<PROMPT
You are the tribunal-writer for gu-log. The $label judge reviewed this post and it FAILED.

## Post to rewrite
src/content/posts/$post_file

## Judge Feedback
\`\`\`json
$score_json
\`\`\`

## Instructions

1. Read the post at src/content/posts/$post_file
2. Read WRITING_GUIDELINES.md and scripts/ralph-vibe-scoring-standard.md (scoring rubric)
3. Read the judge feedback above. Focus on:
   - **critical_issues** (fix these FIRST — they are root causes)
   - **improvements** (per-dimension fixes — follow these prescriptions)
   - **reasons** (diagnostic context for each dimension)
4. Rewrite the post to address ALL issues. Write it back in-place.
5. Also rewrite the EN counterpart at src/content/posts/en-$post_file if it exists.

## Rules
- Fix what's broken, preserve what's working. Don't rewrite passing dimensions.
- Follow the judge's specific improvement suggestions — they cite exact locations.
- Do NOT change frontmatter fields (title, ticketId, dates, sourceUrl).
- Follow WRITING_GUIDELINES.md style rules.

PROMPT
)"
```

**Key changes from old prompt:**
1. **Removed embedded SSOT** (`$ssot_content` no longer inlined). Writer reads it from file via step 2. Saves ~3000-4000 tokens per writer invocation.
2. **Added explicit hierarchy**: critical_issues → improvements → reasons. Writer knows what to fix first.
3. **No judge prompt injection** (the rejected approach). Writer gets judge's output, not judge's instructions.
4. **Works for ALL stages**, not just Vibe. Librarian failures get Librarian-specific improvements, etc.

### 4d. Scoring SSOT Update

Add the new schema fields to `scripts/ralph-vibe-scoring-standard.md` in the "Uniform Agent Output JSON" section:

```markdown
## Uniform Agent Output JSON

All judges output the same structure:

\`\`\`json
{
  "judge": "<judge-name>",
  "dimensions": { "<dim1>": 8, "<dim2>": 9 },
  "score": 8,
  "verdict": "PASS",
  "reasons": { "<dim1>": "One sentence with specific evidence.", "<dim2>": "..." }
}
\`\`\`

### On FAIL — two additional fields:

\`\`\`json
{
  "judge": "<judge-name>",
  "dimensions": { "<dim1>": 6, "<dim2>": 9 },
  "score": 7,
  "verdict": "FAIL",
  "reasons": { "<dim1>": "Assessment.", "<dim2>": "Assessment." },
  "improvements": { "<dim1>": "Specific, actionable fix with line numbers." },
  "critical_issues": ["Root cause that affects multiple dimensions."]
}
\`\`\`

- `improvements` — only dimensions below pass threshold. 1-3 sentences per dim, prescriptive, citing specific locations.
- `critical_issues` — 1-3 root causes ordered by severity. Omit on PASS.
```

### 4e. Validation — No Changes Needed

`validate_judge_score_json()` in `score-helpers.sh` only validates `score` (0-10 integer) and `dimensions` (per-judge dimension keys, 0-10 integers). It does NOT validate `reasons`, `verdict`, `improvements`, or `critical_issues`. The new fields are additive and **do not require validation changes**.

`check_pass_bar()` only reads `dimensions`. Unaffected.

`write_score_to_frontmatter()` extracts only numeric dimensions via `frontmatter-scores.mjs`. The new text fields are ignored during frontmatter persistence.

### 4f. Token Cost Analysis

**Judge output increase (on FAIL only):**
- `improvements`: ~50-100 tokens per failing dimension. Typical: 2-3 failing dims = ~150-300 tokens
- `critical_issues`: ~50-100 tokens (1-3 items)
- **Total per FAIL judgment: +200-400 tokens**

**Writer prompt decrease:**
- Removed embedded SSOT: **-3000-4000 tokens per writer invocation**
- Writer reads SSOT from file (already does this per its own agent prompt)

**Net cost per failed stage: approximately -2600-3600 tokens (net savings)**

For a typical article with 1-2 rewrites: saves ~5,000-7,000 tokens.
For a Vibe-heavy article with 3 attempts: saves ~8,000-11,000 tokens.

**On PASS: zero token cost change** (no improvements/critical_issues output).

### 4g. Interaction with Change 3 (Regression Check)

Regression checks run Librarian and FactChecker as pass/fail gates after Vibe rewrite. The judge will output improvements on FAIL (it's part of its output format now), but the regression handler **ignores them** — it only calls `validate_judge_score_json` + `check_pass_bar`.

No special handling needed. The regression code path in Change 3 does not read improvements or pass them to a writer.

### 4h. Schema Persistence

| Field | Progress JSON | Frontmatter | Notes |
|-------|:---:|:---:|-------|
| dimensions | yes | yes | Numeric scores |
| score | yes | yes | Composite |
| reasons | yes | no | Diagnostic text — transient |
| improvements | yes | no | Writer feedback — transient |
| critical_issues | yes | no | Writer feedback — transient |

`src/content/config.ts` Zod schema: **no changes needed**. New fields are transient and never written to frontmatter.

### Acceptance Criteria

- [ ] All 4 judge agent prompts include improvement feedback instructions
- [ ] Judge output on FAIL includes `improvements` (per-dim, actionable) and `critical_issues` (root causes)
- [ ] Judge output on PASS omits `improvements` and `critical_issues`
- [ ] `improvements` only includes dimensions below the stage's pass threshold
- [ ] `critical_issues` contains 1-3 items ordered by severity
- [ ] Improvement text cites specific locations (line numbers, paragraphs, section names)
- [ ] Writer prompt no longer embeds SSOT content (reads from file instead)
- [ ] Writer prompt references critical_issues → improvements → reasons hierarchy
- [ ] Writer prompt works for ALL 4 stages (not Vibe-specific)
- [ ] `validate_judge_score_json()` still passes (new fields are additive, not validated)
- [ ] `check_pass_bar()` still passes (only reads dimensions)
- [ ] Frontmatter schema unchanged — new fields not persisted
- [ ] `ralph-vibe-scoring-standard.md` documents the new FAIL-only fields

### Out of Scope

- No changes to `validate_judge_score_json()` (new fields are best-effort, not validated)
- No changes to `frontmatter-scores.mjs` or `config.ts`
- Writer agent prompt file (`.claude/agents/tribunal-writer.md`) unchanged — runtime prompt handles the new flow
- No judge-to-judge feedback (each judge still scores independently)

---

## Change 5: Headroom-Based Quota Pacing

**Priority**: P1 (prevents token waste + respects CEO personal use)
**Files to modify**: `scripts/tribunal-quota-loop.sh`

### What to change

Replace the binary GO/STOP logic with headroom-based pacing.

#### 5a. New `get_quota_data()` function

Replace `get_effective_remaining()` with a function that returns both 5hr and weekly percentages:

```bash
# Returns JSON: {"five_hr_pct": N, "weekly_pct": N} or {"error": true}
get_quota_data() {
  if [ ! -x "$USAGE_MONITOR" ]; then
    echo '{"error": true}'
    return
  fi
  local json
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null) || { echo '{"error": true}'; return; }
  python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    for p in data:
        if p.get('provider') == 'claude' and p.get('status') == 'ok':
            print(json.dumps({
                'five_hr_pct': p['five_hr_remaining_pct'],
                'weekly_pct': p['weekly_remaining_pct']
            }))
            sys.exit(0)
    print(json.dumps({'error': True}))
except Exception:
    print(json.dumps({'error': True}))
" "$json" 2>/dev/null || echo '{"error": true}'
}
```

#### 5b. Headroom calculation

```bash
FIVE_HR_FLOOR=20   # Reserve 20% of 5hr window for CEO personal use
WEEKLY_FLOOR=3     # Reserve 3% of weekly for safety
MIN_QUOTA_CHECK_INTERVAL=300  # 5 minutes between usage-monitor.sh calls

last_quota_check=0  # epoch timestamp of last check

# Returns: "go", "sleep:SECONDS", or "error"
compute_headroom_decision() {
  local five_hr_pct="$1"
  local weekly_pct="$2"

  python3 -c "
import json, sys, math

five_hr = float(sys.argv[1])
weekly = float(sys.argv[2])
five_hr_floor = float(sys.argv[3])
weekly_floor = float(sys.argv[4])

effective_five = five_hr - five_hr_floor
effective_weekly = weekly - weekly_floor
effective_remaining = min(effective_five, effective_weekly)

# time_remaining_pct: how much of the current 5hr window is left
# We don't have this from usage-monitor, so we use effective_remaining as headroom
# headroom = effective_remaining (positive = go, negative/zero = sleep)

if effective_remaining > 0:
    print('go')
else:
    # Estimate sleep: 5hr window = 18000s
    # If effective_five is the bottleneck, wait for 5hr window to refresh
    # If effective_weekly is the bottleneck, wait longer
    if effective_five <= 0 and effective_weekly <= 0:
        # Both exhausted — sleep 30 min and re-check
        print('sleep:1800')
    elif effective_five <= 0:
        # 5hr window exhausted — estimate refresh
        # deficit% of 5hr window = deficit * 18000 / 100 seconds to wait
        deficit = abs(effective_five)
        wait = max(300, int(deficit * 18000 / 100))
        print(f'sleep:{min(wait, 3600)}')  # cap at 1hr
    else:
        # Weekly exhausted — sleep 30 min
        print('sleep:1800')
" "$five_hr_pct" "$weekly_pct" "$FIVE_HR_FLOOR" "$WEEKLY_FLOOR" 2>/dev/null || echo "error"
}
```

#### 5c. Rate-limited quota checking

```bash
# Wrapper that enforces minimum interval between usage-monitor calls
get_quota_data_rate_limited() {
  local now
  now=$(date +%s)
  local elapsed=$((now - last_quota_check))

  if [ "$elapsed" -lt "$MIN_QUOTA_CHECK_INTERVAL" ]; then
    local wait_for=$((MIN_QUOTA_CHECK_INTERVAL - elapsed))
    tlog "  Quota check rate-limited. Waiting ${wait_for}s..."
    sleep "$wait_for"
  fi

  last_quota_check=$(date +%s)
  get_quota_data
}
```

#### 5d. Replace main loop quota logic

Replace lines 162-205 (the current quota check + STOP mode + tier sleep) with:

```bash
# ── Check quota ────────────────────────────────────────────────────
local quota_json five_hr_pct weekly_pct
quota_json=$(get_quota_data_rate_limited)

if echo "$quota_json" | jq -e '.error' >/dev/null 2>&1; then
  tlog "Cannot read quota. Sleeping 10min."
  sleep 600
  continue
fi

five_hr_pct=$(echo "$quota_json" | jq -r '.five_hr_pct')
weekly_pct=$(echo "$quota_json" | jq -r '.weekly_pct')
local decision
decision=$(compute_headroom_decision "$five_hr_pct" "$weekly_pct")

tlog "Quota: 5hr=${five_hr_pct}%, weekly=${weekly_pct}%, decision=${decision}"

case "$decision" in
  go)
    tlog "Headroom positive — processing immediately"
    ;;
  sleep:*)
    local sleep_secs="${decision#sleep:}"
    tlog "Headroom non-positive — sleeping ${sleep_secs}s"
    sleep "$sleep_secs"
    continue  # re-enter loop to re-check quota
    ;;
  *)
    tlog "Quota decision error. Sleeping 10min."
    sleep 600
    continue
    ;;
esac
```

#### 5e. Remove old constants and functions

Remove:
- `QUOTA_FLOOR=3` → replaced by `FIVE_HR_FLOOR=20` and `WEEKLY_FLOOR=3`
- `RESUME_THRESHOLD=10` → no longer needed (headroom handles hysteresis)
- `get_effective_remaining()` → replaced by `get_quota_data()`
- `compute_sleep()` → replaced by `compute_headroom_decision()`
- `compute_tier_name()` → replaced by headroom decision

### Acceptance Criteria

- [ ] Quota decisions use headroom = min(five_hr - 20%, weekly - 3%) instead of binary GO/STOP
- [ ] Headroom > 0 → process immediately
- [ ] Headroom <= 0 → sleep for estimated refresh duration (not fixed 30min)
- [ ] `usage-monitor.sh` is never called more frequently than every 5 minutes
- [ ] Sleep duration is capped at reasonable bounds (300s min, 3600s max for 5hr, 1800s for weekly)
- [ ] Log output clearly shows five_hr_pct, weekly_pct, and decision
- [ ] Dry-run mode (`--dry-run`) shows headroom calculation instead of old tier display
- [ ] Old RESUME_THRESHOLD hysteresis logic is removed (headroom replaces it)

### Out of Scope

- No changes to `score-helpers.sh` quota functions (those serve a different purpose — per-judge rate limiting)
- No changes to quiet hours logic (orthogonal to quota pacing)

---

## Change 6: Heartbeat + 3x/Day Monitor

**Priority**: P1 (operational visibility)

### 6a. Heartbeat Script

**New file**: `scripts/tribunal-heartbeat.sh` (on VM at `~/gu-log/scripts/`)
**Also creates**: `.score-loop/heartbeat.json`, `.score-loop/heartbeat-alert.json` (on alert)

#### Script design

Pure bash, zero CC tokens. Cron every 15 min.

```bash
#!/bin/bash
# tribunal-heartbeat.sh — Zero-token health check for tribunal loop
# Cron: */15 * * * * bash ~/gu-log/scripts/tribunal-heartbeat.sh
set -uo pipefail
export TZ=Asia/Taipei

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEARTBEAT_FILE="$ROOT_DIR/.score-loop/heartbeat.json"
ALERT_FILE="$ROOT_DIR/.score-loop/heartbeat-alert.json"
PROGRESS_FILE="$ROOT_DIR/scores/tribunal-progress.json"
LOG_DIR="$ROOT_DIR/.score-loop/logs"
LOCK_PATTERN="/tmp/tribunal-all-claude-*.lock"
```

#### 6 checks:

**Check 1: Service alive**
```bash
check_service() {
  if systemctl --user is-active tribunal-loop.service >/dev/null 2>&1; then
    echo '{"status":"ok","detail":"service active"}'
  else
    echo '{"status":"critical","detail":"service not active"}'
  fi
}
```

**Check 2: Progress JSON freshness**
```bash
check_progress_freshness() {
  if [ ! -f "$PROGRESS_FILE" ]; then
    echo '{"status":"warn","detail":"progress file missing"}'
    return
  fi
  local mtime_epoch now_epoch age_sec max_age
  mtime_epoch=$(stat -c %Y "$PROGRESS_FILE" 2>/dev/null || stat -f %m "$PROGRESS_FILE" 2>/dev/null)
  now_epoch=$(date +%s)
  age_sec=$((now_epoch - mtime_epoch))

  # Quiet hours (weekday 20:00-02:00): allow up to 8hr staleness
  local hour dow
  hour=$(date +%H)
  dow=$(date +%u)
  if [ "$dow" -ge 1 ] && [ "$dow" -le 5 ] && { [ "$hour" -ge 20 ] || [ "$hour" -lt 2 ]; }; then
    max_age=28800  # 8 hours
  else
    max_age=7200   # 2 hours
  fi

  if [ "$age_sec" -gt "$max_age" ]; then
    echo "{\"status\":\"warn\",\"detail\":\"progress stale (${age_sec}s, max ${max_age}s)\"}"
  else
    echo "{\"status\":\"ok\",\"detail\":\"progress fresh (${age_sec}s)\"}"
  fi
}
```

**Check 3: Lock file staleness**
```bash
check_lock_staleness() {
  local lock_files stale_found=false
  lock_files=$(ls $LOCK_PATTERN 2>/dev/null)
  if [ -z "$lock_files" ]; then
    echo '{"status":"ok","detail":"no lock files"}'
    return
  fi
  for lock in $lock_files; do
    local mtime_epoch now_epoch age_sec
    mtime_epoch=$(stat -c %Y "$lock" 2>/dev/null || stat -f %m "$lock" 2>/dev/null)
    now_epoch=$(date +%s)
    age_sec=$((now_epoch - mtime_epoch))
    if [ "$age_sec" -gt 3600 ]; then
      stale_found=true
    fi
  done
  if [ "$stale_found" = true ]; then
    echo '{"status":"warn","detail":"lock file older than 60min"}'
  else
    echo '{"status":"ok","detail":"lock files fresh"}'
  fi
}
```

**Check 4: Disk usage**
```bash
check_disk() {
  local usage
  usage=$(df -h / | awk 'NR==2 {gsub(/%/,""); print $5}')
  if [ "$usage" -gt 90 ]; then
    echo "{\"status\":\"critical\",\"detail\":\"disk at ${usage}%\"}"
  elif [ "$usage" -gt 80 ]; then
    echo "{\"status\":\"warn\",\"detail\":\"disk at ${usage}%\"}"
  else
    echo "{\"status\":\"ok\",\"detail\":\"disk at ${usage}%\"}"
  fi
}
```

**Check 5: Consecutive failures**
```bash
check_consecutive_failures() {
  if [ ! -f "$PROGRESS_FILE" ] || ! jq empty "$PROGRESS_FILE" 2>/dev/null; then
    echo '{"status":"ok","detail":"no progress data"}'
    return
  fi
  local consecutive
  consecutive=$(jq '[to_entries | sort_by(.value.finishedAt // "") | reverse | .[].value | select(.status == "FAILED")] | length' "$PROGRESS_FILE" 2>/dev/null || echo 0)
  # Count consecutive FAILED from most recent
  consecutive=$(jq '
    [to_entries | sort_by(.value.finishedAt // "") | reverse | .[].value.status // "pending"]
    | reduce .[] as $s (0; if $s == "FAILED" then . + 1 else . end)
  ' "$PROGRESS_FILE" 2>/dev/null || echo 0)
  if [ "$consecutive" -ge 5 ]; then
    echo "{\"status\":\"alert\",\"detail\":\"${consecutive} consecutive failures\"}"
  else
    echo "{\"status\":\"ok\",\"detail\":\"${consecutive} recent failures\"}"
  fi
}
```

**Check 6: Git health**
```bash
check_git_health() {
  cd "$ROOT_DIR"
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    echo '{"status":"critical","detail":"mid-rebase detected"}'
  elif ! git status --porcelain >/dev/null 2>&1; then
    echo '{"status":"warn","detail":"git status failed"}'
  else
    echo '{"status":"ok","detail":"git clean"}'
  fi
}
```

#### Aggregation + alerting

```bash
main() {
  local timestamp checks service progress lock disk failures git_health
  timestamp=$(date -Iseconds)

  service=$(check_service)
  progress=$(check_progress_freshness)
  lock=$(check_lock_staleness)
  disk=$(check_disk)
  failures=$(check_consecutive_failures)
  git_health=$(check_git_health)

  # Determine overall status
  local overall="ok"
  for check in "$service" "$progress" "$lock" "$disk" "$failures" "$git_health"; do
    local status
    status=$(echo "$check" | jq -r '.status')
    case "$status" in
      critical) overall="critical" ;;
      alert) [ "$overall" != "critical" ] && overall="alert" ;;
      warn) [ "$overall" = "ok" ] && overall="warn" ;;
    esac
  done

  # Write heartbeat JSON
  jq -n \
    --arg ts "$timestamp" \
    --arg overall "$overall" \
    --argjson service "$service" \
    --argjson progress "$progress" \
    --argjson lock "$lock" \
    --argjson disk "$disk" \
    --argjson failures "$failures" \
    --argjson git_health "$git_health" \
    '{
      timestamp: $ts,
      overall: $overall,
      checks: {
        service: $service,
        progress: $progress,
        lock: $lock,
        disk: $disk,
        failures: $failures,
        git_health: $git_health
      }
    }' > "$HEARTBEAT_FILE"

  # Alert on critical/alert
  if [ "$overall" = "critical" ] || [ "$overall" = "alert" ]; then
    cp "$HEARTBEAT_FILE" "$ALERT_FILE"
    send_telegram_alert "$overall" "$HEARTBEAT_FILE"
  else
    # Clear alert file if status recovered
    rm -f "$ALERT_FILE"
  fi

  # Log rotation: keep last 100 log files
  ls -t "$LOG_DIR"/tribunal-*.log 2>/dev/null | tail -n +101 | xargs rm -f 2>/dev/null || true
}
```

#### Telegram alerting

```bash
send_telegram_alert() {
  local severity="$1"
  local heartbeat_file="$2"
  # Builder must discover the existing Telegram bot token + chat ID
  # from /home/clawd/clawd/ on the VM
  # Expected: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in env or config file
  local config_file="$HOME/clawd/config/telegram.env"
  if [ ! -f "$config_file" ]; then
    return  # No telegram config, skip alerting
  fi
  source "$config_file"
  local message
  message="[Tribunal ${severity^^}] $(date '+%Y-%m-%d %H:%M TST')
$(jq -r '.checks | to_entries[] | select(.value.status != "ok") | "- \(.key): \(.value.status) — \(.value.detail)"' "$heartbeat_file")"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${message}" \
    -d "parse_mode=HTML" >/dev/null 2>&1 || true
}
```

#### Cron setup

```
# On VM: crontab -e
*/15 * * * * bash ~/gu-log/scripts/tribunal-heartbeat.sh
```

### 6b. Full Monitor (3x/day cron)

**New file**: `scripts/tribunal-monitor-cron.sh` (on VM)

This script is invoked by cron and calls CC for a full analysis session.

```bash
#!/bin/bash
# tribunal-monitor-cron.sh — 3x/day full monitor using CC session
# Cron: 55 3 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh   # 11:55 TST
#       0 10 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh    # 18:00 TST
#       0 15 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh    # 23:00 TST
# (Cron times are UTC; TST = UTC+8)
set -uo pipefail
export TZ=Asia/Taipei

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALERT_FILE="$ROOT_DIR/.score-loop/heartbeat-alert.json"
HEARTBEAT_FILE="$ROOT_DIR/.score-loop/heartbeat.json"

# Build monitor prompt
PROMPT="You are the tribunal monitor. Analyze system health and report.

## Check Priority
$(if [ -f "$ALERT_FILE" ]; then
  echo "ALERT FILE EXISTS — prioritize this:"
  cat "$ALERT_FILE"
else
  echo "No active alerts."
fi)

## Heartbeat Status
$(cat "$HEARTBEAT_FILE" 2>/dev/null || echo "No heartbeat file found")

## Tasks
1. Check quota: run \$HOME/clawd/scripts/usage-monitor.sh --json
2. Read scores/tribunal-progress.json — summarize: total PASS, FAILED, NEEDS_REVIEW, pending
3. For FAILED articles: what stage failed? How many retries?
4. Check service: systemctl --user status tribunal-loop.service
5. Check disk: df -h /
6. Report: overall health, immediate issues, recommendations

Be concise. Output a structured report."

claude -p --dangerously-skip-permissions "$PROMPT" \
  > "$ROOT_DIR/.score-loop/logs/monitor-$(date +%Y%m%d-%H%M%S).log" 2>&1 || true
```

#### Cron schedule (VM, UTC for cron):

```
# 11:55 TST = 03:55 UTC
55 3 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh
# 18:00 TST = 10:00 UTC
0 10 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh
# 23:00 TST = 15:00 UTC
0 15 * * * bash ~/gu-log/scripts/tribunal-monitor-cron.sh
```

### Acceptance Criteria (6a — Heartbeat)

- [ ] `tribunal-heartbeat.sh` runs pure bash, zero CC token cost
- [ ] 6 checks: service alive, progress freshness, lock staleness, disk usage, consecutive failures, git health
- [ ] Output written to `.score-loop/heartbeat.json`
- [ ] CRITICAL/ALERT status writes `heartbeat-alert.json` + sends Telegram message
- [ ] Progress freshness threshold: 2hr normal, 8hr during quiet hours (weekday 20-02 TST)
- [ ] Lock file staleness threshold: 60min = WARN
- [ ] Disk usage: >90% = CRITICAL, >80% = WARN
- [ ] Consecutive failures: 5+ = ALERT
- [ ] Git mid-rebase = CRITICAL
- [ ] Log rotation: heartbeat cleans log files, keeps last 100
- [ ] Cron: every 15 minutes

### Acceptance Criteria (6b — Full Monitor)

- [ ] `tribunal-monitor-cron.sh` runs 3x/day at 11:55, 18:00, 23:00 TST
- [ ] Checks `heartbeat-alert.json` first — prioritizes active alerts
- [ ] Uses one CC session per invocation
- [ ] Reports: quota status, progress summary (PASS/FAILED/NEEDS_REVIEW/pending counts), failure analysis, service health
- [ ] Output logged to `.score-loop/logs/monitor-YYYYMMDD-HHMMSS.log`
- [ ] Replaces old "monitor every 50 min" approach

### Out of Scope (Change 6)

- Telegram bot setup (VM already has infrastructure — Builder discovers existing config)
- Dashboard UI (logs + heartbeat JSON are sufficient for now)
- PagerDuty/Slack integration (Telegram is the channel)

---

## Implementation Order

```
Phase 1 — Bug fixes (no architecture changes, safe to deploy independently):
  1. Change 1: FactChecker accuracy floor         [~15 min, 3 lines of code]
  2. Change 2: Cross-run retry cap                 [~45 min, modifies 2 files]

Phase 2 — Quality improvements (depends on Phase 1 being live):
  3. Change 4: Judge improvement feedback + writer  [~90 min, modifies 6 files: 4 judge prompts + SSOT + orchestrator]
     └── Do this BEFORE Change 3 so regression judges already output improvements
  4. Change 3: Vibe regression check               [~60 min, new function + integration]
     └── Depends on: Change 1 (regression re-runs FactChecker which now has accuracy floor)
     └── Depends on: Change 4 (regression judges output improvements, though handler ignores them)

Phase 3 — Operational improvements (independent of Phase 1-2):
  5. Change 5: Headroom-based quota pacing         [~45 min, replaces quota logic]
  6. Change 6a: Heartbeat script                   [~60 min, new file + cron setup on VM]
  7. Change 6b: Full monitor cron                  [~30 min, new file + cron setup on VM]
     └── Depends on: Change 6a (reads heartbeat.json)
```

**Suggested deploy strategy:**
- Phase 1 → commit, push, verify on VM
- Phase 2 → commit, push, run one article through pipeline to verify regression check works
- Phase 3 → commit, push, set up cron on VM

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Change 1 causes already-passing articles to now fail FactChecker | Medium | Only affects articles with accuracy < 8. These articles *should* fail. No rollback needed — this is correct behavior. |
| Change 2 stage reset causes longer processing (every retry runs all 4 stages) | Low | Correct behavior — prevents stale pass-through after Vibe damage. Extra cost is justified. |
| Change 3 regression check significantly increases token cost per Vibe rewrite | Medium | 2 extra CC sessions (Librarian + FactChecker) per Vibe rewrite attempt. Max 3 Vibe attempts × 2 regression = 6 extra sessions per article worst case. Trade-off: tokens vs. quality. |
| Change 4 judges don't output improvements in expected format | Medium | `validate_judge_score_json` doesn't validate improvements — they're best-effort. Writer falls back to `reasons` field if improvements is missing. Add a note in writer prompt: "If improvements field is present, use it. Otherwise, infer from reasons." |
| Change 4 writer can't find SSOT file (reads from file instead of embedded) | Low | Writer agent already has Read tool and its own prompt says to read the SSOT. This is a proven path. |
| Change 5 headroom calculation miscalibrated — either too aggressive or too conservative | Medium | Start with FIVE_HR_FLOOR=20%. Monitor via heartbeat. Adjust floors based on real data after 24hr. |
| Change 5 rate limit on usage-monitor.sh (5min interval) causes delayed quota response | Low | 5min is conservative. Can reduce to 3min if needed. Worse case: processes one extra article before detecting quota drop. |
| Change 6a heartbeat doesn't detect a failure mode | Low | 6 checks cover the known failure modes. Can add checks later. |
| Change 6a Telegram bot config not found on VM | Low | Script fails silently (no crash). Builder discovers existing config or sets up new one. |
| Change 6b full monitor CC session fails mid-run | Low | Non-critical — heartbeat provides baseline visibility. Monitor is enhancement. |

**Rollback plan for each change:**
- Changes 1-3: `git revert` the commit. Changes are in `ralph-all-claude.sh` only.
- Change 4: `git revert` the commit. Touches 6 files (4 judge prompts + SSOT + orchestrator) but all are backwards-compatible — old judge output (without improvements) still works with old writer prompt.
- Change 5: `git revert` the commit in `tribunal-quota-loop.sh`. Falls back to old GO/STOP.
- Change 6: Remove cron entries on VM. Delete new script files. Zero impact on existing pipeline.

---

## Testing Plan

### Change 1: FactChecker accuracy floor

```bash
# Create test JSON files
echo '{"dimensions":{"accuracy":7,"fidelity":9,"consistency":9},"score":8}' > /tmp/test-fc-fail.json
echo '{"dimensions":{"accuracy":8,"fidelity":8,"consistency":8},"score":8}' > /tmp/test-fc-pass.json
echo '{"dimensions":{"accuracy":8,"fidelity":7,"consistency":9},"score":8}' > /tmp/test-fc-comp-pass.json

# Source the script and test
source scripts/ralph-all-claude.sh  # (need to make check_pass_bar callable standalone)
# OR: extract check_pass_bar to a test harness

check_pass_bar "fact-checker" /tmp/test-fc-fail.json; echo "exit: $?"  # expect 1
check_pass_bar "fact-checker" /tmp/test-fc-pass.json; echo "exit: $?"  # expect 0
check_pass_bar "fact-checker" /tmp/test-fc-comp-pass.json; echo "exit: $?"  # expect 0
```

### Change 2: Cross-run retry cap

```bash
# Manually set a test article to failureCount=2, status=FAILED in tribunal-progress.json
# Run ralph-all-claude.sh on that article (it will re-run from stage 1)
# If it fails again, verify:
#   - failureCount incremented to 3
#   - status changed to NEEDS_REVIEW
# Run tribunal-quota-loop.sh --dry-run and verify the NEEDS_REVIEW article is NOT in the list
```

### Change 3: Vibe regression check

```bash
# Test on an article that's known to pass Librarian + FactChecker but fail Vibe
# Run the pipeline and observe:
#   1. Vibe fails → writer rewrites → build passes
#   2. Regression check runs Librarian and FactChecker
#   3. If regression passes → Vibe re-scores
#   4. If regression fails → article reverted, attempt consumed
# Check logs for "Regression check" entries
```

### Change 4: Judge improvement feedback + writer prompt

```bash
# 4a. Test judge output schema:
# Run a single judge (e.g., Vibe) on an article known to FAIL:
timeout 300 claude -p --agent vibe-opus-scorer --dangerously-skip-permissions \
  "Score this post: src/content/posts/sqaa-levelup-journey.mdx
Write your JSON result to: /tmp/test-vibe-output.json"
# Verify /tmp/test-vibe-output.json contains:
#   - "improvements" field with entries for dims below 8
#   - "critical_issues" array with 1-3 items
#   - "reasons" field still present (unchanged)
#   - improvements cite specific line numbers / paragraphs
jq '.improvements' /tmp/test-vibe-output.json   # should exist
jq '.critical_issues' /tmp/test-vibe-output.json # should exist, array

# 4b. Test judge PASS output (no improvements):
# Run on a known-passing article:
# Verify output does NOT contain "improvements" or "critical_issues"

# 4c. Test all 4 judges produce improvements on FAIL:
# Repeat above for librarian, fact-checker, fresh-eyes agents

# 4d. Test writer prompt:
# Temporarily add 'echo "$writer_prompt" | head -20' before writer invocation
# Run pipeline on a failing article. Verify:
#   - Writer prompt does NOT contain embedded SSOT content
#   - Writer prompt references critical_issues, improvements, reasons
#   - Writer prompt says to read SSOT from file

# 4e. Validate existing pipeline unchanged:
# validate_judge_score_json still passes (new fields are additive)
source scripts/score-helpers.sh
echo '{"judge":"vibe","dimensions":{"persona":6,"clawdNote":5,"vibe":7,"clarity":8,"narrative":4},"score":6,"verdict":"FAIL","reasons":{},"improvements":{},"critical_issues":[]}' > /tmp/test-schema.json
validate_judge_score_json "vibe-opus-scorer" /tmp/test-schema.json; echo "exit: $?"  # expect 0
```

### Change 5: Headroom quota pacing

```bash
# Dry-run test:
bash scripts/tribunal-quota-loop.sh --dry-run
# Should show: five_hr_pct, weekly_pct, headroom decision (not old tier)

# Edge case tests (mock usage-monitor output):
# 1. five_hr=25%, weekly=50% → effective=min(25-20, 50-3)=min(5,47)=5 → go
# 2. five_hr=18%, weekly=50% → effective=min(18-20, 50-3)=min(-2,47)=-2 → sleep
# 3. five_hr=50%, weekly=2%  → effective=min(50-20, 2-3)=min(30,-1)=-1 → sleep
# 4. five_hr=90%, weekly=90% → effective=min(70,87)=70 → go
```

### Change 6: Heartbeat + Monitor

```bash
# On VM:
# 1. Run heartbeat manually: bash scripts/tribunal-heartbeat.sh
# 2. Check .score-loop/heartbeat.json exists and has valid JSON
# 3. Verify all 6 checks present in output
# 4. Simulate failure: stop tribunal service → run heartbeat → verify CRITICAL status + alert file
# 5. Verify Telegram alert sent (check Telegram chat)
# 6. Add cron entry → wait 15 min → verify heartbeat.json updated

# For monitor:
# 1. Run manually: bash scripts/tribunal-monitor-cron.sh
# 2. Check .score-loop/logs/monitor-*.log exists with full report
# 3. Add cron entries → verify 3x/day execution
```

---

## Notes

- **Progress file dual schema**: The current `tribunal-progress.json` has two schemas — old entries use ticketId as key with `{iterations: N}`, new entries use filename as key with `{article, stages, status}`. Changes 2-3 only affect the new schema. Old entries are irrelevant to the tribunal pipeline.
- **VM deployment**: Changes 1-5 are pushed to git, VM picks up via `git pull`. Change 6 requires cron setup on the VM (`ssh clawd-vm`).
- **Builder should discover Telegram infrastructure**: Check `/home/clawd/clawd/` for existing bot token, chat ID, and any existing alerting scripts. Do NOT create a new bot if one exists.
- **Quiet hours interaction**: Changes 5 (headroom) and existing quiet hours are orthogonal. Quiet hours block processing during weekday 20-02 TST. Headroom decides whether to process when NOT in quiet hours. Both checks remain in place.

---

# Addendum A: Pipeline Architecture Redesign

> **Date**: 2026-04-09
> **Trigger**: CEO rethinking stage ordering, writer constraints, judge-as-fixer, git strategy, and writer model selection.
> **Status**: ANALYSIS — awaiting CTO/CEO decision before updating Changes 1-6.

## Question 1: 5-Stage vs 4-Stage (Final Vibe Pass Worth It?)

### Analysis

CEO proposal: Vibe → FreshEyes → FactChecker → Librarian → **Final Vibe (tone-only)**

The Final Vibe is insurance against tone damage from stages 3-4. Is it needed?

**When Final Vibe would catch something:**
- FactChecker writer changes a hedge that was also a persona element ("可能吧" → "可能")
- Librarian writer adds a clunky glossary link that breaks prose flow
- Both are small, surgical changes — unlikely to damage narrative structure

**When Final Vibe would NOT catch anything (wasted Opus session):**
- FactChecker and Librarian pass on first attempt (no rewrites) — most common case
- Writer constraints properly prevent tone damage

**Token cost:**
- +1 Opus session per article (even if it always passes)
- 435 articles × 1 Opus session = 435 extra Opus sessions
- If Final Vibe fails and triggers a rewrite, that's another Opus writer + Opus re-judge — very expensive

**Real data signal:** In the current (flawed) pipeline, 5/8 failures are at Vibe. The other 3 failures are NOT "tone damaged by earlier stages" — they're genuine FactChecker/Librarian failures. There's no evidence yet that small surgical fixes damage tone.

### Recommendation: 4-Stage, No Final Vibe — With Data Gate

```
Vibe (Opus, max 3) → FreshEyes (Haiku, max 2) → FactChecker (Opus, max 2) → Librarian (Sonnet, max 1)
```

**Why no Final Vibe:**
1. Writer constraints (CEO's idea #2) are the structural fix. If FactChecker/Librarian writers can't touch narrative/tone, they can't damage it.
2. Final Vibe adds 435 Opus sessions with near-zero expected failure rate.
3. **Change 3 (regression check) is ELIMINATED** — the stage flip removes the need entirely. Regression existed because Vibe (last stage) could damage earlier work. With Vibe first, there's nothing to regress.

**Data gate:** After processing 20 articles through the new pipeline, spot-check whether FactChecker/Librarian rewrites damaged Vibe dimensions. If damage rate > 10%, add Final Vibe as stage 5. This is a data-driven decision, not a guess.

**Savings from eliminating Change 3:**
- No regression check code (saves ~60 min implementation)
- No extra 2 sessions per Vibe rewrite attempt
- Simpler orchestrator logic

---

## Question 2: Judge-as-Fixer (FactChecker/Librarian Self-Fix)

### Analysis

**Current flow (all stages):**
```
Judge (score) → FAIL → Writer (Opus, rewrite) → Re-Judge (score) = 3 sessions per fail
```

**Proposed (judge fixes directly):**
```
Judge (score + fix) → Re-Judge (fresh session, score only) = 2 sessions per fail
```

#### Librarian Judge-as-Fixer: RECOMMENDED

Librarian fixes are highly mechanical:
- "Add link `/glossary#term` at first mention of 'term'" → string replacement
- "Add `/about` link for ShroomDog at line N" → insert markup
- "Add internal link to `/posts/slug/` in thematic context" → insert markup

The Librarian agent already has the **Write tool**. Its prompt just needs to say: "After scoring, if FAIL, fix the issues directly."

**Token savings:** Eliminates 1 Opus writer session per Librarian fail. Librarian reruns are Sonnet (cheap).

**Risk:** Librarian might over-edit when it has write access. **Mitigation:** Explicit constraint in prompt: "ONLY add/fix links and glossary references. Do NOT change prose, facts, narrative structure, or ClawdNote content."

**Implementation:**
1. Update `.claude/agents/librarian.md` — add "fix on FAIL" instructions with constraints
2. In `run_stage()`, for `stage_key == "librarian"`, skip the writer invocation entirely. The judge session both scores and fixes. Only re-invoke the judge for re-scoring.

#### FactChecker Judge-as-Fixer: NOT RECOMMENDED (yet)

FactChecker fixes are semi-mechanical but riskier:
- "Change '40%' to '30%'" → simple, but wrong correction = worse than no correction
- "Add hedge 'approximately'" → simple
- "Restore caveat from source" → requires reading source + careful insertion

FactChecker has **WebSearch and WebFetch tools** for verification. Mixing scoring + fixing + web research in one session increases complexity and risk of confused output.

**Recommendation:** Keep separate writer for FactChecker. Use **Sonnet writer** (CEO's suggestion) instead of Opus — fact corrections don't need creative restructuring.

#### Summary: Judge-as-Fixer Matrix

| Judge | Self-Fix? | Writer Model | Rationale |
|-------|-----------|-------------|-----------|
| Vibe | No | Opus | Creative restructuring, most complex |
| FreshEyes | No | Opus | Readability changes need nuance |
| FactChecker | No | **Sonnet** (downgrade from Opus) | Fact correction is mechanical |
| Librarian | **Yes (no writer)** | N/A | Link addition is purely mechanical |

### Orchestrator Changes for Judge-as-Fixer

In `run_stage()`, the stage definition needs a new field indicating whether the judge self-fixes:

```bash
# Extended format: stage_key:agent_name:validate_name:label:max_loops:model_label:writer_mode
# writer_mode: "opus" / "sonnet" / "haiku" / "self" (judge fixes directly)
declare -a STAGES=(
  "vibe:vibe-opus-scorer:vibe-opus-scorer:VibeScorer:3:opus:opus"
  "freshEyes:fresh-eyes:fresh-eyes:FreshEyes:2:haiku:opus"
  "factChecker:fact-checker:fact-checker:FactChecker:2:opus:sonnet"
  "librarian:librarian:librarian:Librarian:1:sonnet:self"
)
```

When `writer_mode == "self"`, `run_stage()` skips the writer invocation and loops directly back to re-judge.

**Librarian max_loops reduced to 1:** Librarian self-fixes are mechanical. If the fix doesn't work on the first try, a second self-fix is unlikely to help. Mark as stage failure and let cross-run retry cap handle it.

---

## Question 3: Git Commit Strategy

### Current Behavior (discovered from code)

**Important finding:** `commit_progress()` (line 401-408) only `git add`s the progress JSON file. **Article file changes from the writer stay as uncommitted working tree modifications.** They're never explicitly committed or staged by the orchestrator.

This means:
- Article rewrites accumulate as dirty working tree changes during the pipeline
- `git pull --rebase` in the quota loop (line 147) can fail if these dirty files conflict with remote
- If the orchestrator crashes, article changes are lost (only progress JSON is committed)
- The commit messages like `tribunal(slug): all 4 stages PASS` only contain progress JSON, not the article diffs

This is **already a bug** — article changes should be committed.

### Recommendation: One Commit Per Article on PASS, Revert on FAIL

```bash
commit_article() {
  local post_file="$1" msg="$2"
  local en_file="en-$post_file"

  # Stage article files
  git add "src/content/posts/$post_file" 2>/dev/null || true
  [ -f "src/content/posts/$en_file" ] && git add "src/content/posts/$en_file" 2>/dev/null || true

  # Stage progress file
  git add "$PROGRESS_FILE" 2>/dev/null || true

  if ! git diff --cached --quiet; then
    git commit -m "$msg" --no-verify >> "$LOG_FILE" 2>&1 || true
    git push --no-verify >> "$LOG_FILE" 2>&1 || tlog "WARN: git push failed"
  fi
}

revert_article() {
  local post_file="$1"
  local en_file="en-$post_file"
  git checkout -- "src/content/posts/$post_file" 2>/dev/null || true
  [ -f "src/content/posts/$en_file" ] && git checkout -- "src/content/posts/$en_file" 2>/dev/null || true
}
```

**Usage in main loop:**
```bash
# On PASS:
commit_article "$POST_FILE" "tribunal(${POST_FILE%.mdx}): all stages PASS"

# On FAIL:
revert_article "$POST_FILE"   # discard article changes
commit_progress "tribunal(${POST_FILE%.mdx}): FAILED at $label stage"  # commit only progress
```

**Benefits:**
- **One clean commit per article** — git log shows one entry per processed article
- **No intermediate rewrite commits** — zero git pollution from judge→writer→judge loops
- **Clean recovery** — FAIL reverts article to pre-pipeline state; only progress records the failure
- **git pull --rebase safety** — between articles, working tree is clean

**No per-stage commits.** All intermediate rewrites happen in working tree only.

### Recovery Implications

| Scenario | Current Behavior | New Behavior |
|----------|-----------------|-------------|
| Pipeline crashes mid-stage | Article changes lost (uncommitted) | Same — article changes are working tree only. Progress JSON tracks which stages passed. |
| Article FAIL | Article changes left in working tree (dangling) | Article reverted to pre-pipeline state. Clean. |
| Article PASS | Only progress JSON committed (article changes floating!) | Article + progress committed together. Correct. |
| `git pull --rebase` between articles | May fail due to dirty working tree | Working tree is clean between articles. Rebase succeeds. |

---

## Question 4: Impact on Existing Spec (Changes 1-6)

| Change | Impact | Details |
|--------|--------|---------|
| **Change 1: FactChecker accuracy floor** | **Unaffected** | Pass bar logic doesn't depend on stage order. |
| **Change 2: Cross-run retry cap** | **Unaffected** | Still needed regardless of pipeline architecture. |
| **Change 3: Vibe regression check** | **ELIMINATED** | With Vibe first + writer constraints, no earlier work to regress against. Major simplification. |
| **Change 4: Judge improvement feedback** | **Modified** | Core design (improvements + critical_issues fields) unchanged. Librarian judge-as-fixer needs additional prompt changes: "if FAIL, fix directly." Writer model becomes stage-specific (Opus/Sonnet/none). Writer prompt gains per-stage constraint blocks. |
| **Change 5: Headroom quota** | **Unaffected** | Quota logic is orthogonal to stage ordering. |
| **Change 6: Heartbeat + monitor** | **Unaffected** | Monitoring is orthogonal to pipeline internals. |

**Net effect:** Change 3 eliminated, Change 4 modified, everything else unchanged.

### Revised Implementation Order

```
Phase 1 — Bug fixes (unchanged):
  1. Change 1: FactChecker accuracy floor         [~15 min]
  2. Change 2: Cross-run retry cap                 [~45 min]
     + Fix: commit_article() on PASS, revert_article() on FAIL (git bug fix)

Phase 2 — Architecture redesign (replaces old Phase 2):
  3. Stage order flip: Vibe → FreshEyes → FactChecker → Librarian
     + STAGES array reorder
     + Stage definition extended with writer_mode field
     + Per-stage writer constraints in writer_prompt
     + Librarian judge-as-fixer (skip writer)
     + FactChecker writer downgraded to Sonnet
     + Progress JSON migration (reset non-PASS articles)
  4. Change 4: Judge improvement feedback          [~90 min]
     (same as before, but Librarian prompt also gets self-fix instructions)

Phase 3 — Operational (unchanged):
  5. Change 5: Headroom quota                      [~45 min]
  6. Change 6: Heartbeat + monitor                 [~90 min]
```

**Change 3 (regression check) is removed from the plan.**

---

## Question 5: Progress JSON Migration

### Problem

Existing `tribunal-progress.json` has articles with stage passes from the OLD order (Librarian → FactChecker → FreshEyes → Vibe). After flipping to Vibe → FreshEyes → FactChecker → Librarian, these partial passes are meaningless.

Example: `sqaa-levelup-journey.mdx` has librarian=pass, factChecker=pass, freshEyes=pass, vibe=fail. In the new order, Vibe is stage 1 — the Librarian/FactChecker/FreshEyes passes don't help.

### Migration Strategy

**One-time migration script** (run once during deployment):

```bash
#!/bin/bash
# migrate-progress-v2.sh — Reset non-PASS articles for new stage order
PROGRESS_FILE="scores/tribunal-progress.json"

# Keep PASS articles untouched. Reset everything else.
jq '
  to_entries | map(
    if .value.status == "PASS" then .
    elif (.value.stages // null) != null then
      # New schema: has stages. Reset stages, keep failureCount.
      .value.stages = {} |
      .value.status = "pending" |
      .value.note = "reset for tribunal-v2 stage reorder"
    else .  # Old schema (ticketId-based): leave as-is, not used by new pipeline
    end
  ) | from_entries
' "$PROGRESS_FILE" > "${PROGRESS_FILE}.tmp" && mv "${PROGRESS_FILE}.tmp" "$PROGRESS_FILE"

echo "Migration complete. PASS articles preserved. Non-PASS articles reset."
```

**Rules:**
- `status == "PASS"` → untouched (these articles are done)
- `status == "FAILED"` or `status == "pending"` with stages → clear stages, set status to "pending"
- `failureCount` preserved (cross-run retry cap still needs it)
- Old schema entries (ticketId-based, `{iterations: N}`) → untouched (not used by new pipeline)

**When to run:** Once, after deploying Phase 2 (stage reorder), before restarting the quota loop.

---

## Writer Constraints (Per-Stage "Do Not Touch" List)

This is the structural mechanism that makes the stage flip safe and eliminates the need for Final Vibe.

### Constraint Matrix

| Writer for | CAN change | CANNOT change |
|-----------|------------|---------------|
| **Vibe** | Everything — skeleton, narrative, persona, ClawdNote content, section order, opening/ending | Frontmatter fields |
| **FreshEyes** | Wording for readability, jargon explanations, paragraph breaks, transitions | Narrative skeleton, section order, ClawdNote opinion content, opening hook, ending punch |
| **FactChecker** | Factual claims, numbers, hedge words, source attribution, technical terminology | Narrative, readability, prose style, links, ClawdNote non-factual opinions |
| **Librarian** (self-fix) | Glossary links, internal post links, identity links (/about), link text | Prose content, facts, narrative, ClawdNote content, anything that's not a link |

### Implementation in Writer Prompt

Each stage's writer_prompt gets a constraint block. Example for FactChecker:

```bash
if [ "$stage_key" = "factChecker" ]; then
  writer_constraints="
## Writer Constraints (STRICT — violating these is worse than not fixing)
You are ONLY allowed to:
- Correct factual claims (wrong numbers, incorrect technical statements)
- Add or restore hedge words (might, could, approximately, 可能, 或許)
- Fix source attribution (who said what)
- Correct technical terminology

You MUST NOT change:
- Narrative structure or section ordering
- Prose style, readability, or paragraph structure
- Glossary links or internal cross-references
- ClawdNote opinions (unless they contain factual errors)
- Opening hook or ending punch line

If a factual fix requires changing more than one sentence, flag it in your summary but do not rewrite the surrounding paragraph."
fi
```

---

## Planner's Overall Recommendation

### ACCEPT with modifications:

1. **Stage flip: YES** — Vibe → FreshEyes → FactChecker → Librarian (4 stages)
2. **Final Vibe: NO (defer)** — writer constraints are the structural fix. Add Final Vibe only if data shows >10% tone damage after 20 articles.
3. **Judge-as-fixer: YES for Librarian only** — mechanical link additions don't need a separate writer. FactChecker stays with separate Sonnet writer.
4. **Git commit: One commit per article on PASS** — fix the existing bug where article changes are never committed. Revert on FAIL.
5. **Writer model: YES** — Opus for Vibe/FreshEyes, Sonnet for FactChecker, self-fix for Librarian.
6. **Change 3 (regression check): ELIMINATE** — the stage flip + writer constraints make it unnecessary.

### What this means for total pipeline cost:

**Before (current pipeline, typical article with 1 Vibe rewrite):**
- Librarian judge (Sonnet) + FactChecker judge (Opus) + FreshEyes judge (Haiku) + Vibe judge (Opus) + Vibe writer (Opus) + Vibe re-judge (Opus) = 6 sessions (2 Opus expensive)

**After (new pipeline, same scenario):**
- Vibe judge (Opus) + Vibe writer (Opus) + Vibe re-judge (Opus) + FreshEyes judge (Haiku) + FactChecker judge (Opus) + Librarian judge (Sonnet, self-fix) = 6 sessions (3 Opus)

**After with regression check eliminated:**
- Same 6 sessions but no regression overhead on Vibe rewrites. Currently Change 3 would add 2 sessions per Vibe rewrite. Eliminating Change 3 saves those 2 sessions.

**Net:** Similar base cost, but simpler architecture, better quality guarantees, and no regression check overhead.
