# Test Report: Tribunal Component Functions

**Date**: 2026-04-08  
**Script**: `scripts/ralph-all-claude.sh`  
**Tester**: tester-tribunal (local component tests only)

## Environment
- macOS Darwin 25.2.0 (Apple Silicon M1)
- Bash 3.2.57 / zsh 5.9
- jq 1.7.1-apple, python3
- Tests run locally in `/tmp/claude/test-tribunal/`

## 1. Pass Bar Checks (check_pass_bar)

Python logic extracted from lines 155-212, tested with temp JSON files.

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Lib: all 8s | PASS | PASS | PASS |
| Lib: 9,8,8,7 → floor(32/4)=8 | PASS | PASS | PASS |
| Lib: 7,8,8,7 → floor(30/4)=7 | FAIL | FAIL | PASS |
| Lib: 8,8,8,7 → floor(31/4)=7 | FAIL | FAIL | PASS |
| Lib: 9,9,7,7 → floor(32/4)=8 | PASS | PASS | PASS |
| FC: 8,8,8 | PASS | PASS | PASS |
| FC: 9,8,7 → floor(24/3)=8 | PASS | PASS | PASS |
| FC: 7,7,7 | FAIL | FAIL | PASS |
| FE: 9,8 | PASS | PASS | PASS |
| FE: 8,8 | PASS | PASS | PASS |
| FE: 9,7 → floor(16/2)=8 | PASS | PASS | PASS |
| FE: 7,8 → floor(15/2)=7 | FAIL | FAIL | PASS |
| Vibe: 9,8,8,8,8 | PASS | PASS | PASS |
| Vibe: 10,9,8,8,8 | PASS | PASS | PASS |
| Vibe: 8,8,8,8,8 (no dim>=9) | FAIL | FAIL | PASS |
| Vibe: 9,7,8,8,8 (min<8) | FAIL | FAIL | PASS |
| Vibe: all 9s | PASS | PASS | PASS |
| Vibe: all 0s | FAIL | FAIL | PASS |

**18/18 PASS**

## 2. Progress Tracking (jq)

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Init empty progress | {} | {} | PASS |
| Init article | test-post.mdx | test-post.mdx | PASS |
| Init stages empty | 0 | 0 | PASS |
| Write stage status | pass | pass | PASS |
| Write stage model | sonnet | sonnet | PASS |
| Write stage score | 8 | 8 | PASS |
| Get existing stage | pass | pass | PASS |
| Get missing stage → pending | pending | pending | PASS |
| Multi: librarian intact | pass | pass | PASS |
| Multi: factChecker added | fail | fail | PASS |
| Multi: 2 stages total | 2 | 2 | PASS |
| Corrupt JSON recovery | {} | {} | PASS |
| mark_article_passed | PASS | PASS | PASS |
| mark_article_failed status | FAILED | FAILED | PASS |
| mark_article_failed stage | vibe | vibe | PASS |

**15/15 PASS**

## 3. Quiet Hours

Current TST at test time: Wed hour=03 → not quiet (correct).

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Weekday h=20 | quiet | quiet | PASS |
| Weekday h=21 | quiet | quiet | PASS |
| Weekday h=23 | quiet | quiet | PASS |
| Weekday h=0 | quiet | quiet | PASS |
| Weekday h=1 | quiet | quiet | PASS |
| Weekday h=2 (boundary) | not_quiet | not_quiet | PASS |
| Weekday h=10 | not_quiet | not_quiet | PASS |
| Weekday h=19 | not_quiet | not_quiet | PASS |
| Sat h=22 | not_quiet | not_quiet | PASS |
| Sun h=21 | not_quiet | not_quiet | PASS |
| Sat h=1 | not_quiet | not_quiet | PASS |
| Sun h=0 | not_quiet | not_quiet | PASS |

**12/12 PASS**

## 4. Edge Cases

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| bash -n syntax check | ok | ok | PASS |
| No args → usage message | yes | yes | PASS |
| Missing post → error | yes | yes | PASS |
| Missing dim → treated as 0 | FAIL | FAIL | PASS |
| Empty dimensions → all 0 | FAIL | FAIL | PASS |
| No dimensions key → defaults 0 | FAIL | FAIL | PASS |
| validate rejects missing dim | rejected | rejected | PASS |
| validate rejects score>10 | rejected | rejected | PASS |
| validate accepts valid JSON | accepted | accepted | PASS |

**9/9 PASS**

## Summary

**54/54 tests passed. 0 failures. 0 bugs found.**

All pass bar arithmetic, progress tracking, quiet hours logic, and edge cases work correctly. The `check_pass_bar` Python snippets use `math.floor()` which correctly implements integer division for composite scoring. Missing dimensions default to 0 via `dict.get(k, 0)`, and `validate_judge_score_json` properly rejects incomplete score JSON.
