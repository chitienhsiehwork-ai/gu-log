## Tribunal Quota-Aware Continuous Loop
**Priority**: P1
**Requested by**: CEO
**Scope**: Replace dumb 2h cron with a continuous loop that adapts tribunal processing speed to Claude API quota availability. Never burn below 3% floor (CEO personal use reserve).

### Background

Current approach: cron every 2h → `cc-cron-tribunal.sh` → `tribunal-batch-runner.sh --max 3`.
Problems:
- Sits idle for up to 2 hours even when quota is abundant
- `tribunal-batch-runner.sh` quota check uses non-existent `claude --usage` flag (always falls through to "continue optimistically")
- Doesn't adapt to quota scarcity — burns 3 articles then waits regardless
- Previous attempt at `ralph-daemon.service` (transient systemd unit) failed on 2026-03-28

### Quota Infrastructure (Verified on VM)

**SSOT**: `/home/clawd/clawd/scripts/usage-monitor.sh --json`

Returns JSON array with Claude entry:
```json
{
  "provider": "claude",
  "status": "ok",
  "plan": "max",
  "five_hr_used_pct": 85.0,
  "five_hr_remaining_pct": 15.0,
  "five_hr_reset": "47 分鐘",
  "weekly_used_pct": 87.0,
  "weekly_remaining_pct": 13.0,
  "weekly_reset": "18.8 小時",
  "extra_usage_enabled": true,
  "extra_used": 3127.0,
  "extra_limit": 10000
}
```

Key fields:
- `five_hr_remaining_pct` — 5-hour rolling window (binding constraint for burst)
- `weekly_remaining_pct` — 7-day window (binding constraint for sustained)
- `five_hr_reset` / `weekly_reset` — human-readable time until reset (for logging, not parsing)
- Has 2-minute file cache (cross-process) — safe to call frequently
- Extra usage is enabled (billing overflow) but we still respect the floor to avoid surprise costs

**Effective remaining** = `min(five_hr_remaining_pct, weekly_remaining_pct)`

### Architecture

```
┌─────────────────────────────────────────────────┐
│           tribunal-quota-loop.sh                │
│  (systemd user service, auto-restart on crash)  │
├─────────────────────────────────────────────────┤
│                                                 │
│  while true:                                    │
│    1. git pull --rebase origin main             │
│    2. get_unscored_articles (newest→oldest)     │
│    3. if none → sleep 30min, continue           │
│    4. check_quota() via usage-monitor.sh        │
│    5. if effective_remaining < 3% → STOP mode   │
│    6. compute sleep_duration from tier table    │
│    7. sleep(sleep_duration)                     │
│    8. run ralph-all-claude.sh on next article   │
│    9. git add + commit + push results           │
│   10. loop back to step 1                       │
│                                                 │
└─────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
  usage-monitor.sh          ralph-all-claude.sh
  (quota JSON)              (4-stage tribunal)
```

### Adaptive Sleep Strategy

| Effective Remaining | Tier    | Sleep Before Next Article | Rationale |
|--------------------:|---------|---------------------------|-----------|
| > 50%              | BURN    | 0s (immediate)            | Plenty of quota, maximize throughput |
| 20–50%             | CRUISE  | 5 min                     | Comfortable buffer, light pacing |
| 10–20%             | CONSERVE| 30 min                    | Getting tight, let 5hr window recover |
| 3–10%              | SCARCE  | 2 hours                   | Near floor, wait for significant recovery |
| < 3%               | STOP    | Check every 30 min, don't process | Floor reached — only resume when > 10% |

**STOP → resume hysteresis**: When in STOP mode, don't resume at 3.1%. Wait until effective remaining > 10% to avoid bouncing in and out of STOP. This prevents thrashing when quota hovers near the floor.

**5hr window awareness**: If `five_hr_remaining_pct < 3%` but `weekly_remaining_pct > 10%`, the 5hr window is the bottleneck. Log this clearly — it will recover within hours. Don't treat it as a weekly exhaustion.

### Loop Pseudocode

```bash
QUOTA_FLOOR=3
RESUME_THRESHOLD=10
USAGE_MONITOR="$HOME/clawd/scripts/usage-monitor.sh"

get_effective_remaining() {
  local json
  json=$(bash "$USAGE_MONITOR" --json 2>/dev/null)
  # Extract min(five_hr_remaining_pct, weekly_remaining_pct) via python3
  python3 -c "
import json, sys
data = json.loads(sys.argv[1])
for p in data:
    if p.get('provider') == 'claude' and p.get('status') == 'ok':
        print(min(p['five_hr_remaining_pct'], p['weekly_remaining_pct']))
        sys.exit(0)
print(-1)  # error
" "$json"
}

compute_sleep() {
  local pct="$1"
  if (( pct > 50 )); then echo 0        # BURN
  elif (( pct > 20 )); then echo 300     # CRUISE: 5min
  elif (( pct > 10 )); then echo 1800    # CONSERVE: 30min
  elif (( pct > QUOTA_FLOOR )); then echo 7200  # SCARCE: 2hr
  else echo -1                            # STOP
  fi
}

while true; do
  git pull --rebase origin main

  articles=$(get_unscored_articles)  # reuse existing function
  if [ -z "$articles" ]; then
    log "No unscored articles. Sleeping 30min."
    sleep 1800; continue
  fi

  remaining=$(get_effective_remaining)
  if [ "$remaining" -lt 0 ]; then
    log "Cannot read quota. Sleeping 10min."
    sleep 600; continue
  fi

  sleep_sec=$(compute_sleep "$remaining")

  if [ "$sleep_sec" -eq -1 ]; then
    # STOP mode — wait for recovery above RESUME_THRESHOLD
    log "STOP: ${remaining}% remaining (floor=${QUOTA_FLOOR}%). Waiting for >${RESUME_THRESHOLD}%..."
    while true; do
      sleep 1800  # check every 30min
      remaining=$(get_effective_remaining)
      log "  Check: ${remaining}% remaining"
      if [ "$remaining" -ge "$RESUME_THRESHOLD" ]; then
        log "Quota recovered to ${remaining}%. Resuming."
        break
      fi
    done
    continue  # re-enter main loop (re-pull, re-check articles)
  fi

  if [ "$sleep_sec" -gt 0 ]; then
    log "Tier sleep: ${sleep_sec}s (${remaining}% remaining)"
    sleep "$sleep_sec"
    # Re-check quota after sleep (may have changed)
    remaining=$(get_effective_remaining)
    if [ "$remaining" -lt "$QUOTA_FLOOR" ]; then
      log "Quota dropped below floor during sleep. Entering STOP."
      continue
    fi
  fi

  next_article=$(echo "$articles" | head -1)
  log "Processing: $next_article (${remaining}% remaining)"
  bash scripts/ralph-all-claude.sh "$next_article"

  # Brief cooldown (10s, same as current batch runner)
  sleep 10
done
```

### What This Replaces

| Component | Action |
|-----------|--------|
| `cc-cron-tribunal.sh` | **Delete** — no longer needed |
| `tribunal-batch-runner.sh` | **Keep as-is** — still useful for one-off `--max N --dry-run` manual runs |
| Crontab entry `0 */2 * * * .../cc-cron-tribunal.sh` | **Remove** — replaced by systemd service |
| Transient `ralph-daemon.service` | **Replace** with proper persistent unit file |

### New Files

1. **`scripts/tribunal-quota-loop.sh`** — the continuous loop (lives in gu-log repo, deployed to VM via git pull)
2. **`~/.config/systemd/user/tribunal-quota-loop.service`** — systemd unit file (on VM only, not in repo)

### Systemd Service Design

```ini
[Unit]
Description=Tribunal Quota-Aware Loop (gu-log)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/clawd/clawd/projects/gu-log
ExecStart=/bin/bash scripts/tribunal-quota-loop.sh
Restart=on-failure
RestartSec=60
Environment=TZ=Asia/Taipei
Environment=CLAUDE_CODE_OAUTH_TOKEN=%h/.cc-cron-token-content
# Read token from file (same pattern as cc-cron-tribunal.sh)
ExecStartPre=/bin/bash -c 'export CLAUDE_CODE_OAUTH_TOKEN=$(head -1 $HOME/.cc-cron-token)'

# Resource limits
CPUQuota=50%
MemoryMax=512M

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tribunal-loop

[Install]
WantedBy=default.target
```

Note: `CLAUDE_CODE_OAUTH_TOKEN` needs to be sourced from `~/.cc-cron-token` at runtime. The `ExecStartPre` approach above won't actually export to the main process. Builder should use an `EnvironmentFile` or a wrapper script pattern instead. (The existing `cc-cron-tribunal.sh` does `export CLAUDE_CODE_OAUTH_TOKEN=$(head -1 "$HOME/.cc-cron-token")` — same pattern needed here, likely via a thin wrapper.)

### Deployment Steps

1. Builder creates `scripts/tribunal-quota-loop.sh` in gu-log repo
2. Push to main → VM pulls automatically (or manual `git pull`)
3. On VM: create systemd unit file at `~/.config/systemd/user/tribunal-quota-loop.service`
4. `systemctl --user daemon-reload`
5. `systemctl --user enable tribunal-quota-loop.service`
6. Remove old cron entry: comment out `0 */2 * * * .../cc-cron-tribunal.sh`
7. `systemctl --user start tribunal-quota-loop.service`
8. Verify: `journalctl --user -u tribunal-quota-loop -f`

### Quiet Hours

`ralph-all-claude.sh` already has quiet hours logic (weekday 20:00–02:00 TST). The loop does NOT need to duplicate this — each `ralph-all-claude.sh` invocation handles its own quiet-hour pausing internally.

### Logging

- Loop-level logs: `journalctl --user -u tribunal-quota-loop`
- Per-article logs: existing `.score-loop/logs/tribunal-*.log` (written by `ralph-all-claude.sh`)
- Quota decisions logged at loop level: tier, remaining %, sleep duration

### Out of Scope

- Multi-provider quota balancing (only Claude is used for tribunal)
- Parallel article processing (tribunal stages are sequential by design)
- Telegram notifications for quota events (nice-to-have, not MVP)
- Extra usage billing awareness (extra_usage_enabled exists but floor logic is sufficient)
- Modifying `ralph-all-claude.sh` or `tribunal-batch-runner.sh` internals

### Dependencies

- `usage-monitor.sh` on VM must remain functional (it's the quota SSOT)
- `~/.cc-cron-token` must exist and be valid (same as current cron)
- `ralph-all-claude.sh` must remain idempotent (crash resume works)

### Acceptance Criteria

- [ ] `tribunal-quota-loop.sh` script exists and runs as a continuous loop
- [ ] Quota is checked via `usage-monitor.sh --json` (NOT `claude --usage`)
- [ ] Effective remaining = min(five_hr, weekly) — both windows respected
- [ ] 3% floor enforced: loop enters STOP mode when effective remaining < 3%
- [ ] Hysteresis: STOP mode only exits when effective remaining > 10%
- [ ] Adaptive sleep matches the 5-tier table (BURN/CRUISE/CONSERVE/SCARCE/STOP)
- [ ] Articles processed newest → oldest (existing behavior preserved)
- [ ] Systemd service auto-restarts on crash (`Restart=on-failure`)
- [ ] Old cron entry removed from crontab
- [ ] `tribunal-batch-runner.sh` preserved for manual use (not deleted)
- [ ] Loop logs quota tier + remaining % + sleep duration before each decision
- [ ] No article is started when quota is below floor (pre-check, not mid-article abort)
- [ ] Passes a dry-run test: with `--dry-run` flag, prints what it would do without running tribunal
