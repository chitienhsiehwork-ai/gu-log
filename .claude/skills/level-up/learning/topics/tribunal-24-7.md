# Tribunal 24/7 Readiness (gu-log)

## Current Level
- Status: mastered (Lv.1–9, full clear, zero misses)
- Last updated: 2026-06-19
- Confidence: high — strong systems intuition, made correct scope-cutting decisions unprompted

## Evidence
- 2026-06-19: 9/9 MCQ correct first try, no misses. Topics proven:
  - Lv.1 continuous quota-aware loop vs one-shot batch (not `while true`).
  - Lv.2 worktree isolation; understood "dirty worktree" = drift from main, cured by reset-to-ref.
  - Lv.3 the `GP_WRITER_MODE=none` bomb — scores-but-never-rewrites → EXHAUSTED, zero improvement.
  - Lv.4 atomic `mkdir` claims prevent double-scoring. **Deduced unprompted** that the claim dir must be shared/outside each worktree — correctly reasoned to the `RC_ROOT_DIR=main repo` design before being told.
  - Lv.5 two dispatch paths; per-role model split only on Go-writer + CCC-claude fallback, production VM hardcodes gpt-5.5 (`helpers.sh:358`).
  - Lv.6 multi-host double-claim via PID-based staleness misread; chose single-machine to skip it.
  - Lv.7 mac fallback trap (missing usage-monitor.sh → 1-worker/600s); chose the single Tribunal VM to skip it.
  - Lv.8 burst default under-spends a 48h deadline (paces to 7d window, 10% floor, WORKERS=1).
  - Lv.9 observability gap (osascript no-op on Linux, stale monitor skill, reboot needs enable+linger).
- Asked sharp clarifying questions mid-journey: "dispatch vs 啟動" (frequency distinction), "which dir, outside git repo?" (claim location). Both showed real understanding, not guessing.

## Known Gaps
- None on concepts. Open WORK items (not learner gaps) = the deploy punch-list below.

## Teaching Notes
- Vainglory framing lands hard and the learner explicitly wants MORE of it — carry the knowledge ON the analogy (grinder-bots, ranked vs scrim client, arcade seats/PID, stadium move, farm with alarm in empty building). Keep technical prose to short anchor lines + file:line.
- Learner makes strong architecture decisions to AVOID work (a single Tribunal VM) rather than build features — reward that as high-skill play.
- One MCQ per level, vary correct-answer position, kaomoji throughout.

## Deploy punch-list (decided target: the operator-configured Tribunal VM, deploy via codex goal-mode + 6h monitor)
- P0: set `GP_WRITER_MODE=subagent` in systemd unit (else score-only).
- P0: per-role model routing — drop hardcoded `--model gpt-5.5` (helpers.sh:358), route writer/vibe→Opus 4.5, judges+orchestrator→gpt-5.5.
- P0: reboot persistence — `systemctl --user enable` + `loginctl enable-linger`.
- P1: real alert channel (Telegram/host notifier) replacing osascript.
- P1: fix tribunal-monitor skill to parse `CONTROLLER:` + quota-controller.json + 10% floor.
- Burst: `--workers N`, `QUOTA_FLOOR=0`, `QUOTA_BURST_ALLOWANCE`↑, `MIN_COOLDOWN`↓; cgroup autoscaler caps at 2 under RAM pressure; Claude quota invisible to controller.
- P2: doc/spec drift (runbook quota section; archive tribunal-closed-loop-quota-controller 0/29).

## Next Suggested Levels
- Hands-on: actually implement the P0 fixes as a PR / OpenSpec change.
- New topic: the quota burn-rate controller math (ideal-burn-line, debt sleep) in depth.
