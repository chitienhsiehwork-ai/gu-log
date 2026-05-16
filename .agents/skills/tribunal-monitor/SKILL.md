---
name: tribunal-monitor
description: Check tribunal daemon status on clawd-vm — service health, progress, quota, git sync, recent results. Use when the user asks about tribunal status, wants to know if it's running, how many articles are left, or if something looks stuck. Also use proactively before any tribunal config change to understand current state.
---

# Tribunal Monitor

Check the gu-log tribunal daemon running on clawd-vm (Hetzner VPS). Reports service health, processing progress, quota, git sync state, and recent judge results in one shot.

## Prerequisites

- SSH access to `clawd-vm` (alias for `clawd@46.225.20.205`)
- Requires `dangerouslyDisableSandbox: true` (SSH uses Unix sockets)

## Procedure

Run this single SSH command to collect all diagnostic data at once:

```bash
ssh clawd-vm bash -s <<'MONITOR'
set -euo pipefail
cd ~/clawd/projects/gu-log

echo "══════ SERVICE ══════"
systemctl --user status tribunal-loop 2>&1 | head -15
echo

echo "══════ RUNTIME STATE ══════"
cat .score-loop/state/runtime.json 2>/dev/null || echo "(no runtime.json)"
echo

echo "══════ STOP FLAG ══════"
if ls .score-loop/control/stop-graceful 2>/dev/null; then
  echo "⚠ stop-graceful flag EXISTS — service will not dispatch new articles"
else
  echo "✓ no stop flag"
fi
echo

echo "══════ QUOTA ══════"
journalctl --user -u tribunal-loop --no-pager -n 200 --output=cat 2>/dev/null \
  | grep -oP 'Tier \w+: \d+% remaining' | tail -1 || echo "(no quota line found)"
echo

echo "══════ UNSCORED COUNT ══════"
journalctl --user -u tribunal-loop --no-pager -n 200 --output=cat 2>/dev/null \
  | grep -oP '\d+ unscored articles remaining' | tail -1 || echo "(no count found)"
echo

echo "══════ RECENT RESULTS (last 15) ══════"
journalctl --user -u tribunal-loop --no-pager -n 500 --output=cat 2>/dev/null \
  | grep -E '(PASSED|failed \(rc=|FAIL)' | tail -15
echo

echo "══════ GIT SYNC ══════"
LOCAL=$(git rev-parse HEAD)
git fetch origin 2>/dev/null
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "fetch-failed")
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✓ in sync with origin/main ($LOCAL)"
else
  BEHIND=$(git log --oneline HEAD..origin/main 2>/dev/null | wc -l)
  echo "⚠ behind origin/main by $BEHIND commits"
  echo "  local:  $LOCAL"
  echo "  remote: $REMOTE"
  git log --oneline HEAD..origin/main 2>/dev/null | head -10
fi
echo

echo "══════ MEMORY (peak) ══════"
systemctl --user show tribunal-loop --property=MemoryPeak 2>/dev/null || echo "(n/a)"

echo "══════ WORKER WORKTREES ══════"
for wt in ~/clawd/projects/gu-log-worker-*; do
  if [ -d "$wt" ]; then
    WT_HEAD=$(cd "$wt" && git rev-parse --short HEAD 2>/dev/null || echo "?")
    echo "  $(basename $wt): $WT_HEAD"
  fi
done
[ ! -d ~/clawd/projects/gu-log-worker-a ] && echo "  (no worker worktrees found)"
MONITOR
```

## Interpreting results

### Service states
| State | Meaning | Action |
|---|---|---|
| `active (running)` | Daemon is live, processing articles | Normal |
| `inactive (dead)` + exit 0 | Clean stop (graceful stop or quota floor) | Check runtime.json for reason, restart if needed |
| `inactive (dead)` + exit != 0 | Crash | Check `journalctl --user -u tribunal-loop -n 100` for errors |
| `activating` | Starting up | Wait |

### Runtime state values (`runtime.json`)
- `running` — actively processing
- `stopped_by_request` — graceful stop via flag file or signal
- `quota_paused` — below quota floor (3%), waiting for recovery (10%)

### Common issues
1. **git pull failing**: VM can't sync with origin/main. Usually SSH key or network issue. Fix: `cd ~/clawd/projects/gu-log && git pull origin main`
2. **Stop flag stuck**: `.score-loop/control/stop-graceful` exists but nobody removed it. Fix: `rm .score-loop/control/stop-graceful` then restart
3. **Worker worktrees stale**: Workers running old code. Fix: `scripts/tribunal-worker-bootstrap.sh sync`
4. **Progress file missing/corrupt**: Usually after a reset. Service creates a fresh one on next start.

### Restart command
```bash
ssh clawd-vm 'systemctl --user start tribunal-loop'
```

### Quick stop (graceful)
```bash
ssh clawd-vm 'touch ~/clawd/projects/gu-log/.score-loop/control/stop-graceful'
```

## Output format

After running diagnostics, report to the user in zh-tw with this structure:

1. **一句話總結** — 跑著/停了/卡住了
2. **關鍵數字** — unscored 剩幾篇、quota 幾 %、落後幾個 commit
3. **最近結果** — 最後幾篇 PASS/FAIL
4. **需要處理的問題**（如有）— git sync、stop flag、worktree stale
