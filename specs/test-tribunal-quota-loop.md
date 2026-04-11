# Test Report: tribunal-quota-loop.sh

**Date**: 2026-04-08
**Tester**: tester-quota-loop
**Files tested**: `scripts/tribunal-quota-loop.sh`, `scripts/cc-tribunal-loop-wrapper.sh`, `scripts/tribunal-loop.service`

## Summary

**37/37 tests PASS. 0 FAIL. 1 minor doc bug found.**

## Results

### 1. Syntax Checks

| Test | Command | Result |
|------|---------|--------|
| tribunal-quota-loop.sh | `bash -n` | PASS |
| cc-tribunal-loop-wrapper.sh | `bash -n` | PASS |

### 2. Float Bug Fix (CRITICAL)

`get_effective_remaining()` returns INTEGER via `int(val)` in Python. Verified with 6 float inputs.

| Input (five_hr, weekly) | Expected | Actual | Status |
|------------------------|----------|--------|--------|
| 13.7, 45.2 | 13 | 13 | PASS |
| 99.9, 50.1 | 50 | 50 | PASS |
| 2.3, 80.0 | 2 | 2 | PASS |
| 0.0, 100.0 | 0 | 0 | PASS |
| 100.0, 0.0 | 0 | 0 | PASS |
| 0.5, 0.5 | 0 | 0 | PASS |

All results are clean integers (0 decimal points). Bash arithmetic `(( pct > 50 ))` works correctly.

### 3. Sleep Tier Logic (15 boundary tests)

| pct | Expected Tier | Actual Tier | Expected Sleep | Actual Sleep | Status |
|-----|--------------|-------------|----------------|--------------|--------|
| 75 | BURN | BURN | 0 | 0 | PASS |
| 51 | BURN | BURN | 0 | 0 | PASS |
| 50 | CRUISE | CRUISE | 300 | 300 | PASS |
| 49 | CRUISE | CRUISE | 300 | 300 | PASS |
| 21 | CRUISE | CRUISE | 300 | 300 | PASS |
| 20 | CONSERVE | CONSERVE | 1800 | 1800 | PASS |
| 19 | CONSERVE | CONSERVE | 1800 | 1800 | PASS |
| 11 | CONSERVE | CONSERVE | 1800 | 1800 | PASS |
| 10 | SCARCE | SCARCE | 7200 | 7200 | PASS |
| 9 | SCARCE | SCARCE | 7200 | 7200 | PASS |
| 4 | SCARCE | SCARCE | 7200 | 7200 | PASS |
| 3 | STOP | STOP | -1 | -1 | PASS |
| 2 | STOP | STOP | -1 | -1 | PASS |
| 1 | STOP | STOP | -1 | -1 | PASS |
| 0 | STOP | STOP | -1 | -1 | PASS |

### 4. Hysteresis (STOP/Resume)

| Scenario | pct | Expected | Actual | Status |
|----------|-----|----------|--------|--------|
| Enter STOP | 2% | STOP | STOP | PASS |
| Enter STOP | 3% | STOP | STOP | PASS |
| Enter STOP | 0% | STOP | STOP | PASS |
| Recovery check | 8% | Still stopped | Still stopped | PASS |
| Recovery check | 9% | Still stopped | Still stopped | PASS |
| Recovery check | 10% | RESUME | RESUME | PASS |
| Recovery check | 11% | RESUME | RESUME | PASS |

Resume threshold = 10% (inclusive). Hysteresis gap = 3-10% prevents flapping.

### 5. Error Handling

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| usage-monitor.sh not found | return -1 | -1 | PASS |
| usage-monitor.sh exits non-zero | return -1 | -1 (via `\|\| { echo -1; return; }`) | PASS |
| Invalid JSON | return -1 | -1 | PASS |
| Empty output | return -1 | -1 | PASS |
| Quota unreadable in main loop | sleep 10min, continue | sleep 600 (line 174) | PASS |
| No claude provider in JSON | return -1 | -1 | PASS |
| Claude status=error | return -1 | -1 | PASS |
| Multi-provider JSON | pick claude | 22 (correct) | PASS |

### 6. Article List

| Check | Result | Status |
|-------|--------|--------|
| Progress file exists | Yes, 28 entries | PASS |
| Filters out `en-*` prefix | Yes | PASS |
| Filters out `demo*` prefix | Yes | PASS |
| Filters out deprecated articles | 8 skipped | PASS |
| Filters out PASS articles | 1 skipped | PASS |
| Final unscored count | 433 | PASS |

### 7. Git Pull Failure

| Scenario | Handling | Status |
|----------|----------|--------|
| Pull succeeds | Normal flow | PASS |
| Pull fails (rebase conflict) | `git rebase --abort`, warn, continue | PASS |
| Pull fails (no rebase) | `rebase --abort` silently fails, warn, continue | PASS |
| set -e protection | `\|\|` prevents loop exit | PASS |

### 8. VM Dry Run

| Test | Result | Status |
|------|--------|--------|
| `git pull origin main` on VM | Fast-forward success | PASS |
| `--dry-run` mode | Ran successfully | PASS |
| Article queue listed | 433 articles, newest first | PASS |
| Quota tier displayed | 11% remaining, CONSERVE, 1800s sleep | PASS |

### 9. Service File

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| WorkingDirectory | %h/clawd/projects/gu-log | Match | PASS |
| ExecStart | wrapper script path | Match | PASS |
| Restart | on-failure | on-failure | PASS |
| RestartSec | 60 | 60 | PASS |
| Wrapper cd matches service WD | Both → clawd/projects/gu-log | Match | PASS |
| Token loading | CLAUDE_CODE_OAUTH_TOKEN from ~/.cc-cron-token | Correct | PASS |

## Bugs Found

### BUG-1: Minor — Comment/code boundary mismatch (cosmetic)

**Severity**: Low (cosmetic, does not affect behavior)

**Description**: Header comments (lines 7-12) describe tier boundaries slightly off from actual code behavior:

| Tier | Comment says | Code actually does |
|------|-------------|-------------------|
| BURN | >50% | >50% (correct) |
| CRUISE | 20-50% | 21-50% |
| CONSERVE | 10-20% | 11-20% |
| SCARCE | 3-10% | 4-10% |
| STOP | <3% | <=3% |

**Root cause**: All comparisons use strict `>`, so the lower bound of each range is exclusive. Comment implies inclusive ranges.

**Suggested fix**: Update comments to:
```
#   BURN     (>50%)  : 0s
#   CRUISE   (21-50%): 5min
#   CONSERVE (11-20%): 30min
#   SCARCE   (4-10%) : 2hr
#   STOP     (<=3%)  : halt, check every 30min, resume at >=10%
```

**Repro**: `pct=3` → code returns STOP, comment says SCARCE (3-10%).
