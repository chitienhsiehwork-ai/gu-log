---
name: tribunal-monitor
description: Check the remote Tribunal VM daemon — service health, progress, quota, git sync, recent results. Use when the user asks about tribunal status, wants to know if it's running, how many articles are left, or if something looks stuck. Also use proactively before any tribunal config change to understand current state.
---

# Tribunal Monitor

## Prerequisites

- Export `TRIBUNAL_HOST` from the runtime's local-only machine note; never copy its value into tracked files.
- Provision the remote host-local `~/.config/gu-log/tribunal.env` with `GU_LOG_DIR` and `USAGE_MONITOR` by following `docs/tribunal-runbook.md`.
- If SSH is restricted, use the runtime's minimum necessary escalation instead of disabling unrelated safeguards.

## Procedure

Run this single SSH command to collect all diagnostic data at once:

```bash
: "${TRIBUNAL_HOST:?Set TRIBUNAL_HOST from the local machine note}"

ssh "$TRIBUNAL_HOST" bash -s <<'MONITOR'
set -euo pipefail
deploy_env="$HOME/.config/gu-log/tribunal.env"
if [ ! -r "$deploy_env" ]; then
  echo "Missing $deploy_env; follow docs/tribunal-runbook.md" >&2
  exit 78
fi
set -a
# shellcheck source=/dev/null
. "$deploy_env"
set +a
: "${GU_LOG_DIR:?Missing GU_LOG_DIR in $deploy_env}"
cd "$GU_LOG_DIR"

echo "══════ SERVICE ══════"
systemctl --user status tribunal-loop 2>&1 | head -15 || true
unit_enabled=$(systemctl --user is-enabled tribunal-loop 2>/dev/null || true)
[ -n "$unit_enabled" ] || unit_enabled="unknown"
if command -v loginctl >/dev/null 2>&1; then
  linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)
else
  linger="unknown"
fi
[ -n "$linger" ] || linger="unknown"
echo "unit_enabled=$unit_enabled"
echo "linger=$linger"
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
echo "configured_floor=${QUOTA_FLOOR:-10}%"
jq . .score-loop/state/quota-controller.json 2>/dev/null || echo "(no quota-controller.json)"
journalctl --user -u tribunal-loop --no-pager -n 200 --output=cat 2>/dev/null \
  | grep 'CONTROLLER:' | tail -5 || echo "(no controller log line found)"
echo

echo "══════ WRITER PREFLIGHT ══════"
unit_environment=$(systemctl --user show tribunal-loop -p Environment --value 2>/dev/null || true)
unit_writer_mode=$(printf '%s\n' "$unit_environment" | tr ' ' '\n' | sed -n 's/^GP_WRITER_MODE=//p' | tail -1)
echo "writer_mode=${GP_WRITER_MODE:-${unit_writer_mode:-none}}"
if [ -r .score-loop/state/writer-preflight.json ]; then
  jq . .score-loop/state/writer-preflight.json
else
  echo "(no writer-preflight.json; deployed startup has not passed preflight)"
fi
echo

echo "══════ UNSCORED COUNT ══════"
journalctl --user -u tribunal-loop --no-pager -n 200 --output=cat 2>/dev/null \
  | grep -oP '\d+ unscored articles remaining' | tail -1 || echo "(no count found)"
echo

echo "══════ RECENT RESULTS (last 15) ══════"
journalctl --user -u tribunal-loop --no-pager -n 500 --output=cat 2>/dev/null \
  | grep -E '(PASSED|failed \(rc=|FAIL)' | tail -15 || true
echo

echo "══════ GIT SYNC ══════"
LOCAL=$(git rev-parse HEAD)
if git fetch origin 2>/dev/null; then
  REMOTE=$(git rev-parse origin/main)
  if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✓ in sync with origin/main ($LOCAL)"
  else
    COUNTS=$(git rev-list --left-right --count HEAD...origin/main)
    set -- $COUNTS
    AHEAD=$1
    BEHIND=$2
    if [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ]; then
      echo "⚠ diverged from origin/main: ahead $AHEAD, behind $BEHIND commits"
    elif [ "$AHEAD" -gt 0 ]; then
      echo "ℹ ahead of origin/main by $AHEAD commits"
    else
      echo "⚠ behind origin/main by $BEHIND commits"
    fi
    echo "  local:  $LOCAL"
    echo "  remote: $REMOTE"
    if [ "$BEHIND" -gt 0 ]; then
      git log -10 --oneline HEAD..origin/main
    fi
  fi
else
  echo "⚠ sync unknown: git fetch origin failed; cached origin/main was not trusted"
fi
echo

echo "══════ MEMORY (peak) ══════"
systemctl --user show tribunal-loop --property=MemoryPeak 2>/dev/null || echo "(n/a)"

echo "══════ WORKER WORKTREES ══════"
WORKER_PARENT=$(dirname "$GU_LOG_DIR")
found_worker=false
for wt in "$WORKER_PARENT"/gu-log-worker-*; do
  if [ -d "$wt" ]; then
    found_worker=true
    WT_HEAD=$(cd "$wt" && git rev-parse --short HEAD 2>/dev/null || echo "?")
    echo "  $(basename "$wt"): $WT_HEAD"
  fi
done
[ "$found_worker" = true ] || echo "  (no worker worktrees found)"
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

Treat the exact value in `runtime.json` as authoritative. Current state names and transitions are defined by `scripts/tribunal-run-control.sh`; do not infer them from an old static list in this skill.

### Common issues
1. **git pull failing**: VM can't sync with origin/main. Usually SSH key or network issue. Fix inside the checkout: `git pull origin main`
2. **Stop flag stuck**: `.score-loop/control/stop-graceful` exists but nobody removed it. Fix: `rm .score-loop/control/stop-graceful` then restart
3. **Worker worktrees stale**: Workers running old code. Fix: `scripts/tribunal-worker-bootstrap.sh sync`
4. **Progress file missing/corrupt**: Usually after a reset. Service creates a fresh one on next start.

### Restart command
```bash
ssh "$TRIBUNAL_HOST" 'systemctl --user start tribunal-loop'
```

### Quick stop (graceful)
```bash
ssh "$TRIBUNAL_HOST" bash -s <<'STOP'
set -euo pipefail
deploy_env="$HOME/.config/gu-log/tribunal.env"
if [ ! -r "$deploy_env" ]; then
  echo "Missing $deploy_env; follow docs/tribunal-runbook.md" >&2
  exit 78
fi
set -a
# shellcheck source=/dev/null
. "$deploy_env"
set +a
: "${GU_LOG_DIR:?Missing GU_LOG_DIR in $deploy_env}"
touch "$GU_LOG_DIR/.score-loop/control/stop-graceful"
STOP
```

## Output format

After running diagnostics, report to the user in zh-tw with this structure:

1. **一句話總結** — 跑著/停了/卡住了
2. **關鍵數字** — unscored 剩幾篇、quota 幾 %、落後幾個 commit
3. **部署前置狀態** — configured floor、writer mode/preflight、unit enabled、linger
4. **最近結果** — 最後幾篇 PASS/FAIL
5. **需要處理的問題**（如有）— git sync、stop flag、worktree stale
