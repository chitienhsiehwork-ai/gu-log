---
name: tribunal-monitor
description: Check the remote Tribunal VM daemon — service health, progress, quota, git sync, recent results. Use when the user asks about tribunal status, wants to know if it's running, how many articles are left, or if something looks stuck. Also use proactively before any tribunal config change to understand current state.
---

# Tribunal Monitor

## Prerequisites

- Export `TRIBUNAL_HOST` from the runtime's local-only machine note; never copy its value into tracked files.
- Provision the remote host-local `~/.config/gu-log/tribunal.env` with `GU_LOG_DIR` by following `docs/tribunal-runbook.md`.
- If SSH is restricted, use the runtime's minimum necessary escalation instead of disabling unrelated safeguards.

## Procedure

Stream the caller's current, tracked read-only snapshot script over SSH. This
avoids depending on the remote checkout already having the newest monitor:

```bash
: "${TRIBUNAL_HOST:?Set TRIBUNAL_HOST from the local machine note}"
repo_root="$(git rev-parse --show-toplevel)"
ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  "$TRIBUNAL_HOST" \
  bash -s < "$repo_root/scripts/tribunal-monitor-snapshot.sh"
```

`QUEUE COUNT` is explicitly the last observation in the most recently updated
supervisor log, not a recomputed current count. `status=unavailable` must stay
unavailable; do not fall back from that selected log to a staler log, the
journal, or the tracked legacy ledger.
`RECENT FINISHED ATTEMPTS` comes only from the runtime ledger. The snapshot does
not fetch git, alter refs, write a cursor, or change the service.

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
1. **Runtime git observation is behind/diverged**: Expected in fetch-only mode while the runtime has local progress or content edits. Use the publisher or an explicit operator sync; do not rebase the daemon worktree.
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
2. **關鍵數字** — queue 的 last-observed 數字／時間／來源、quota 幾 %、runtime git observation
3. **部署前置狀態** — configured floor、writer mode/preflight、unit enabled、linger
4. **最近結果** — 最後幾筆 finished attempts 與 outcomes
5. **需要處理的問題**（如有）— git sync、stop flag、worktree stale
