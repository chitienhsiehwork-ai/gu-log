# Tribunal operations runbook

> gu-log tribunal runtime is a quota-aware, graceful-stop daemon running on clawd-vm. It runs 4 judges (Librarian / FactChecker / FreshEyes / VibeScorer) against unscored posts and auto-rewrites failures. This doc covers the day-to-day operational moves.

**Canonical specs (archived)**
- `openspec/changes/archive/2026-04-23-tribunal-graceful-run-control/` — Phase 1, stop contract
- `openspec/changes/archive/2026-04-23-tribunal-safe-parallelism/` — Phase 2, 2-worker pool

**Key files**
- `scripts/tribunal-quota-loop.sh` — the daemon / supervisor. SSOT for long-running runtime.
- `scripts/tribunal-all-claude.sh` — per-article worker (4 stages).
- `scripts/tribunal-run-control.sh` — shared stop / claim / flock helpers.
- `scripts/tribunal-worker-bootstrap.sh` — manage worker worktrees.
- `scripts/tribunal-batch-runner.sh` — bounded one-shot (cron / manual). **Not a daemon** — use `tribunal-quota-loop.sh` for daemon.
- `scripts/tribunal-loop.service` — systemd unit (user-scope).
- `scripts/cc-tribunal-loop-wrapper.sh` — loads CLAUDE_CODE_OAUTH_TOKEN, exec's the loop.

## Deploy

VPS path: `~/clawd/projects/gu-log` (main worktree) + `~/clawd/projects/gu-log-worker-{a,b}` (worker worktrees).

```bash
# On Mac: push the change
git push origin main

# On VPS
ssh clawd-vm
cd ~/clawd/projects/gu-log
git stash push -m "wip" --include-untracked        # uncommitted tribunal rewrites live here
git checkout main && git pull
git stash pop

# If scripts/tribunal-loop.service changed, redeploy + reload:
cp scripts/tribunal-loop.service ~/.config/systemd/user/tribunal-loop.service
systemctl --user daemon-reload

# If tribunal code changed AND workers are running:
#   option A (preferred, no token waste) — drain + restart
touch .score-loop/control/stop-graceful
# wait for service inactive (minutes → up to 60min if article is mid-stage)
until [ "$(systemctl --user is-active tribunal-loop)" != "active" ]; do sleep 10; done
systemctl --user start tribunal-loop   # supervisor auto-syncs worker worktrees at startup

#   option B (if drain stalls) — kill workers, let supervisor exit
pkill -TERM -f tribunal-all-claude.sh
# supervisor exits on next iteration (top-of-loop stop check)
systemctl --user start tribunal-loop
```

## Worker worktree gotcha

**Worker worktrees don't auto-update when main advances.** `git worktree add <path> origin/main` checks out whatever origin/main was at that moment. Subsequent `git pull` in the main worktree does **not** propagate to worker worktrees. Running workers keep executing their stale snapshot until explicitly synced.

Symptoms:
- Merged a bug fix to main, restarted service, workers still show old behavior.
- `cat ~/clawd/projects/gu-log/scripts/<file>` shows new code; `cat ~/clawd/projects/gu-log-worker-a/scripts/<same-file>` shows old code.

Fix:
```bash
# Sync all worker worktrees to origin/main, with pnpm install if deps changed
scripts/tribunal-worker-bootstrap.sh sync

# Or specific worker
scripts/tribunal-worker-bootstrap.sh sync a
```

The supervisor (`tribunal-quota-loop.sh`) runs `sync` automatically at every startup (in `ensure_worktrees`), so a clean restart cycle always picks up the latest code. Manual `sync` is only needed if you want to refresh worktrees without restarting (e.g. before the next article dispatch, without draining current articles).

## Graceful stop

Two channels, same semantics (see `tribunal-run-control.sh`):
- **Signal** — `systemctl --user stop tribunal-loop` sends SIGTERM. With `KillMode=mixed`, only the supervisor gets the signal; the in-flight per-article subprocess is left alive to finish its current article.
- **File flag** — `touch .score-loop/control/stop-graceful`. Supervisor and workers poll in 15s slices, both notice within a slice and enter drain.

Safe boundary = **article**, not stage. A stop during a judge call waits for the stage + rewrite + build to finish, then the next article won't be dispatched. Worst case ~60min per article (systemd `TimeoutStopSec=3600`).

Restart after stop: `systemctl --user start tribunal-loop`. `rc_exit_stopped` removes the flag file on clean exit, so there's no sticky stop-state to clear.

## Observability

```bash
# Live state
cat .score-loop/state/runtime.json
# Expected states: running / draining / idle_wait / stopped_by_request / stopped_by_quota

# Active claims (one per in-flight article)
ls .score-loop/claims/

# Tail supervisor log
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs tail -f

# Tail per-article log (inside a worker worktree)
ls -t ~/clawd/projects/gu-log-worker-a/.score-loop/logs/tribunal-*.log | head -1 | xargs tail -f

# Process tree
ps -ef --forest | grep -E "tribunal|bash scripts/tribunal"
```

Exit code conventions (from `tribunal-all-claude.sh`):
- `0` — all 4 stages passed
- `1` — stage failed (normal failure, will be retried on next dispatch)
- `2` — EXHAUSTED (hit `MAX_TOP_ATTEMPTS=5`; will NOT be retried automatically)
- `75` — skipped (per-article lock held by another instance)
- `77` — stopped_by_request (graceful stop propagated from a long wait)

## Worktree lifecycle cheat sheet

```bash
# Provision
scripts/tribunal-worker-bootstrap.sh create a
scripts/tribunal-worker-bootstrap.sh create b

# Inspect
scripts/tribunal-worker-bootstrap.sh status

# Sync to latest main (safe — detached HEAD, no local work preserved)
scripts/tribunal-worker-bootstrap.sh sync          # all workers
scripts/tribunal-worker-bootstrap.sh sync a        # just worker-a

# Remove (e.g. disk pressure, or reverting to --workers 1)
scripts/tribunal-worker-bootstrap.sh remove a
scripts/tribunal-worker-bootstrap.sh remove-all
```

Disk cost: ~500MB per worker (pnpm `node_modules` per worktree). On clawd-vm (75GB, historically ~45GB used) this is fine for 2–3 workers.

## Auto scale-down / up (memory throttle)

When `--workers > 1`, the supervisor samples its own cgroup memory each loop
iteration and adjusts a soft cap on the active worker count. Keeps the
service from OOM-killing itself when five parallel `pnpm build`s burst.

**Decision ladder** (per iteration):

| Signal | Action |
|---|---|
| `oom-kill` event in journal within 10min | Hard-cap `worker-limit` to 2 |
| MemoryCurrent ≥ 85% of MemoryMax | Step `worker-limit` down by 1 (floor 1) |
| MemoryCurrent < 50% for 5 consecutive samples | Step `worker-limit` up by 1 (ceiling `$WORKERS`) |
| 50–84% | No change (hysteresis band to avoid flapping) |

**Plus a spawn pre-check**: before forking a new worker, the supervisor
estimates `MemoryCurrent + 400MB` — if that would cross 85%, the spawn is
held for one iteration. Protects against fork-time bursts that a 30s
sampling cadence can't catch in time.

**Observability**:

```bash
# Current effective limit + last scaling event
cat .score-loop/state/autoscale.json
# { effective_workers, configured_workers, memory_pct, last_reason, updatedAt }

# Recent autoscale events in the supervisor log
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs grep 'AUTOSCALE:'
```

**Operator override**: planning a planned burn that you want to run hot
without autoscale interference? Pin the limit manually:

```bash
echo 5 > .score-loop/control/worker-limit   # peg at 5, autoscaler still
                                            # writes over this if OOM or
                                            # memory crosses scale-down
```

The autoscaler treats the file as a read-with-floor source: it respects any
integer `<= $WORKERS`. Delete the file to fall back to the `$WORKERS` CLI
arg. Tune thresholds in `tribunal-quota-loop.sh` (search `AUTOSCALE_*`).

## Quota Controller (closed-loop)

The supervisor uses a closed-loop feedback controller instead of the old binary GO/STOP. For each Anthropic quota window (5-hour and 7-day), it computes an ideal consumption rate:

```
rate = (remaining_pct - QUOTA_FLOOR) / time_until_refresh_sec
cooldown = ARTICLE_COST_PCT / rate
output = max(cooldown_5hr, cooldown_7day)   # conservative: whichever is tighter
```

**Key constants** (in `tribunal-quota-loop.sh`):

| Constant | Default | Description |
|---|---|---|
| `QUOTA_FLOOR` | 3% | Human reserve — never burn below this |
| `MIN_COOLDOWN` | 10s | Floor for inter-article wait |
| `MAX_COOLDOWN` | 1800s (30min) | Ceiling / hard stop |
| `ARTICLE_COST_PCT` | 5.0% | Cold start default (auto-calibrated via EMA) |
| `EMA_ALPHA` | 0.3 | Calibration smoothing factor |
| `EXTRA_USAGE_LIMIT` | 0.8 | Extra usage safety valve threshold (80%) |

**Modes** (visible in `quota-controller.json`):

| Mode | Meaning |
|---|---|
| `pacing` | Normal closed-loop operation |
| `floor_stop` | One or both windows at/below floor — MAX_COOLDOWN, 0 workers |
| `extra_limit` | Extra usage >80% of budget — hard stop to prevent bill overrun |
| `fallback` | usage-monitor.sh unavailable — conservative 600s cooldown, 1 worker |

**Observability**:

```bash
# Current controller state
cat .score-loop/state/quota-controller.json
# { mode, five_hr_pct, seven_day_pct, cooldown_sec, recommended_workers, binding_constraint, article_cost_pct, updatedAt }

# Full history (JSONL, one entry per tick + dispatch + complete)
tail -20 .score-loop/state/quota-history.jsonl | python3 -m json.tool

# Recent controller decisions in supervisor log
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs grep 'CONTROLLER:'

# Calibration events
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs grep 'CALIBRATE:'
```

**Self-calibration**: After each article completes (in single-worker mode), the controller computes the actual quota delta and updates `ARTICLE_COST_PCT` via exponential moving average (alpha=0.3). Cold start uses 5.0% (deliberately conservative). With sufficient history (≥5 entries), EMA converges to the true average cost.

**Startup rotation**: At daemon startup, entries older than 7 days are pruned from `quota-history.jsonl`.

**Feedforward compensation**: Before computing rates, the controller subtracts `active_workers * ARTICLE_COST_PCT` from the remaining % to account for the 2-minute cache delay in usage-monitor. This prevents over-commitment when multiple workers are dispatched in quick succession.

**Legacy fallback**: Start with `--legacy-quota` to revert to the old binary GO/STOP behavior:

```bash
# Edit the systemd unit or wrapper to add the flag
ExecStart=... --workers 2 --legacy-quota
```

Legacy mode disables: controller, quota-history.jsonl, quota-controller.json, calibration.

**Rollback procedure**:

```bash
# 1. Stop the daemon
systemctl --user stop tribunal-loop

# 2. Add --legacy-quota to the ExecStart line
vi ~/.config/systemd/user/tribunal-loop.service

# 3. Reload and restart
systemctl --user daemon-reload
systemctl --user start tribunal-loop
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Workers dispatched but log stays quiet for >1min | Worker sleeping inside `wait_for_*` (quota/quiet-hours left over from old code) | `sync` workers + restart |
| Service inactive, `rc_exit_stopped` in log, flag still present | Someone touched the flag manually; supervisor cleared it on exit | `systemctl --user start tribunal-loop` |
| Same article claimed by a dead pid, new workers blocked | Worker crashed without releasing claim | `scripts/tribunal-worker-bootstrap.sh status` to confirm workers are alive; supervisor runs `rc_gc_stale_claims` at startup; to force now: `rm -rf .score-loop/claims/<slug>.claim` |
| `git pull failed: unstaged changes` warning in supervisor log | Dirty tribunal rewrites in main worktree from an earlier partial run | Non-fatal; supervisor continues with its current checkout. Clean up via `git stash` or `git checkout -- .` when safe. |
| New code on main isn't reaching running workers | Worker worktrees are stale (see "Worker worktree gotcha" above) | `scripts/tribunal-worker-bootstrap.sh sync` — or restart (supervisor auto-syncs) |
| Article marked EXHAUSTED after 5 attempts | Real content / scoring issue, or model-induced flakiness | Open the stage log, look at scorer reasons; rewrite manually or flag for human review |
| Controller stuck in `floor_stop` even though quota looks OK | usage-monitor cache stale, or feedforward over-counting | Check `quota-controller.json` for `five_hr_pct` / `seven_day_pct`; force cache refresh: `rm /tmp/usage-monitor-cache/claude.json` |
| `ARTICLE_COST_PCT` too high/low | Calibration EMA hasn't converged (cold start), or multi-worker noise | Check `quota-history.jsonl` for recent deltas; controller will self-correct after ~5 single-worker articles |
| Controller in `fallback` mode | usage-monitor.sh returns error (OAuth token expired, API down) | SSH to VM, run `~/clawd/scripts/usage-monitor.sh --json` manually to diagnose |
| Extra usage alarm (`extra_limit` mode) | Extra usage approaching monthly cap | Check `extra_used_usd` / `extra_limit_usd` in quota-controller.json; adjust limit in Anthropic console if intentional |
