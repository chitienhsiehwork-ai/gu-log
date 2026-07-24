<!-- md-zh-tw: ignore -->

# Tribunal operations runbook

> gu-log tribunal runtime is a quota-aware, graceful-stop daemon running on the operator-configured Tribunal VM. It runs 4 judges (Librarian / FactChecker / FreshEyes / VibeScorer) against unscored posts and auto-rewrites failures. This doc covers the day-to-day operational moves.

**Canonical specs (archived)**
- `openspec/changes/archive/2026-04-23-tribunal-graceful-run-control/` — Phase 1, stop contract
- `openspec/changes/archive/2026-04-23-tribunal-safe-parallelism/` — Phase 2, 2-worker pool

**Key files**
- `scripts/tribunal-quota-loop.sh` — the daemon / supervisor. SSOT for long-running runtime.
- `scripts/tribunal.sh` — current per-article 4-stage runner; the supervisor dispatch code is the process-target SSOT.
- `scripts/tribunal-run-control.sh` — shared stop / claim / flock helpers.
- `scripts/tribunal-worker-bootstrap.sh` — manage worker worktrees.
- `scripts/tribunal-batch-runner.sh` — bounded one-shot (cron / manual). **Not a daemon** — use `tribunal-quota-loop.sh` for daemon.
- `scripts/tribunal-loop.service` — systemd unit (user-scope).
- `scripts/cc-tribunal-loop-wrapper.sh` — loads CLAUDE_CODE_OAUTH_TOKEN, exec's the loop.

## Deploy

Host and checkout mappings are local-only. Before operating the VM, load `TRIBUNAL_HOST`、remote `GU_LOG_DIR` 與 remote `USAGE_MONITOR` from the local machine note; worker worktrees live beside `GU_LOG_DIR` as `gu-log-worker-{a,b}`.

```bash
# On Mac: merge the approved PR through the protected branch flow first.

# One-time bootstrap（rerun whenever either remote path changes）.
# GU_LOG_DIR and USAGE_MONITOR are absolute paths on the remote host.
: "${TRIBUNAL_HOST:?Set TRIBUNAL_HOST}"
: "${GU_LOG_DIR:?Set remote GU_LOG_DIR}"
: "${USAGE_MONITOR:?Set remote USAGE_MONITOR}"

case "$GU_LOG_DIR$USAGE_MONITOR" in
  *$'\n'*|*$'\r'*|*"'"*)
    echo "Remote paths must not contain newlines or single quotes" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

GU_LOG_DIR_B64=$(printf '%s' "$GU_LOG_DIR" | base64 | tr -d '\n')
USAGE_MONITOR_B64=$(printf '%s' "$USAGE_MONITOR" | base64 | tr -d '\n')
ssh "$TRIBUNAL_HOST" bash -s -- "$GU_LOG_DIR_B64" "$USAGE_MONITOR_B64" <<'CONFIG'
set -euo pipefail
GU_LOG_DIR=$(printf '%s' "$1" | base64 --decode)
USAGE_MONITOR=$(printf '%s' "$2" | base64 --decode)

git -C "$GU_LOG_DIR" rev-parse --show-toplevel >/dev/null
test -x "$USAGE_MONITOR"

config_dir="$HOME/.config/gu-log"
config_file="$config_dir/tribunal.env"
install -d -m 700 "$config_dir"
tmp=$(mktemp "$config_dir/.tribunal.env.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  printf "GU_LOG_DIR='%s'\n" "$GU_LOG_DIR"
  printf "USAGE_MONITOR='%s'\n" "$USAGE_MONITOR"
} > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$config_file"
trap - EXIT
CONFIG

# Every deploy runs inside one explicit remote block. The remote side loads
# the same host-local config consumed by systemd and the monitor skill.
ssh "$TRIBUNAL_HOST" bash -s <<'DEPLOY'
set -euo pipefail
deploy_env="$HOME/.config/gu-log/tribunal.env"
if [ ! -r "$deploy_env" ]; then
  echo "Missing $deploy_env; run the bootstrap block first" >&2
  exit 78
fi
set -a
# shellcheck source=/dev/null
. "$deploy_env"
set +a
: "${GU_LOG_DIR:?Missing GU_LOG_DIR in $deploy_env}"
: "${USAGE_MONITOR:?Missing USAGE_MONITOR in $deploy_env}"
test -x "$USAGE_MONITOR"
cd "$GU_LOG_DIR"

did_stash=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git stash push -m "wip" --include-untracked      # uncommitted tribunal rewrites live here
  did_stash=true
fi
git fetch origin main
git checkout main && git merge --ff-only origin/main
if [ "$did_stash" = true ]; then
  git stash pop
fi

# If scripts/tribunal-loop.service changed, redeploy + reload:
install -d -m 700 "$HOME/.config/systemd/user"
cp scripts/tribunal-loop.service ~/.config/systemd/user/tribunal-loop.service
systemctl --user daemon-reload
systemctl --user enable tribunal-loop
loginctl enable-linger "$USER"

# If tribunal code changed AND workers are running, drain + restart. Do not
# combine this path with the force-terminate recovery below.
touch .score-loop/control/stop-graceful
# wait for service inactive (minutes → up to 60min if article is mid-stage)
until [ "$(systemctl --user is-active tribunal-loop)" != "active" ]; do sleep 10; done
systemctl --user start tribunal-loop   # supervisor auto-syncs worker worktrees at startup
DEPLOY
```

`enable` 讓 user unit 在 user manager 啟動時自動回來；`enable-linger`
讓 user manager 在未登入時也會於開機後存在。兩個都要有，少一個就
不能宣稱 reboot-persistent。部署後用 wrapper doctor 驗證 unit、linger、
strict provider contract，以及目前 service PID 寫下的 writer preflight
狀態；這個日常檢查不會再花一次 Claude quota：

```bash
bash scripts/cc-tribunal-loop-wrapper.sh --doctor
```

只有需要重新驗證 Claude CLI/auth 時才明確執行 live probe；成功輸出必須是
exact `OK`，wrapper 才會放行：

```bash
bash scripts/cc-tribunal-loop-wrapper.sh --doctor --live-probe
```

部署 checklist：

- `tribunal.env` 的 `GU_LOG_DIR`、off-repo `USAGE_MONITOR` 都存在且可執行。
- Codex 與 Claude CLI 已安裝、已驗證 non-interactive auth。
- `systemctl --user enable tribunal-loop` 回報 enabled。
- `loginctl enable-linger "$USER"` 後 `loginctl show-user "$USER" -p Linger --value` 回報 yes。
- `bash scripts/cc-tribunal-loop-wrapper.sh --doctor` 全數通過。
- 啟動後 monitor 顯示 strict role routing、`GP_WRITER_MODE=cli` 與 writer preflight passed。

只有 graceful drain 明確卡住時，才由 operator **另跑**以下 recovery；它不會接在正常 deploy 後自動執行：

```bash
ssh "$TRIBUNAL_HOST" bash -s <<'RECOVER'
set -euo pipefail
deploy_env="$HOME/.config/gu-log/tribunal.env"
if [ ! -r "$deploy_env" ]; then
  echo "Missing $deploy_env; run the bootstrap block first" >&2
  exit 78
fi
# shellcheck source=/dev/null
. "$deploy_env"
: "${GU_LOG_DIR:?Missing GU_LOG_DIR in $deploy_env}"
cd "$GU_LOG_DIR"

touch .score-loop/control/stop-graceful
# Queue a unit stop first so Restart=on-failure cannot race the recovery, then
# signal every process in this unit's cgroup without depending on worker names.
systemctl --user stop --no-block tribunal-loop
systemctl --user kill --kill-whom=all --signal=KILL tribunal-loop || true
until [ "$(systemctl --user is-active tribunal-loop)" != "active" ]; do sleep 10; done
rm -f .score-loop/control/stop-graceful
systemctl --user start tribunal-loop
RECOVER
```

## Worker worktree gotcha

**Worker worktrees don't auto-update when main advances.** `git worktree add <path> origin/main` checks out whatever origin/main was at that moment. Subsequent `git pull` in the main worktree does **not** propagate to worker worktrees. Running workers keep executing their stale snapshot until explicitly synced.

Symptoms:
- Merged a bug fix to main, restarted service, workers still show old behavior.
- From the main checkout, `cat scripts/<file>` shows new code; `cat ../gu-log-worker-a/scripts/<same-file>` shows old code.

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

Safe boundary = **article**, not stage. A stop during a judge call waits for the stage + rewrite + final build gate to finish, then the next article won't be dispatched. Worst case ~60min per article (systemd `TimeoutStopSec=3600`).

Restart after stop: `systemctl --user start tribunal-loop`. `rc_exit_stopped` removes the flag file on clean exit, so there's no sticky stop-state to clear.

## Observability

```bash
# Live state
cat .score-loop/state/runtime.json
# Expected states: running / draining / idle_wait / stopped_by_request / stopped_by_quota

# Runtime ledger + remote drift observability
cat .score-loop/state/tribunal-progress.json
cat .score-loop/state/runtime-git.json

# Active claims (one per in-flight article)
ls .score-loop/claims/

# Tail supervisor log
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs tail -f

# Tail per-article log (inside a worker worktree)
ls -t ../gu-log-worker-a/.score-loop/logs/tribunal-*.log | head -1 | xargs tail -f

# Process tree
ps -ef --forest | grep -E "tribunal|bash scripts/tribunal"
```

Exit code conventions (from `tribunal-all-claude.sh`):
- `0` — all 4 stages passed and final full-site build passed
- `1` — stage or final build gate failed (normal failure, will be retried on next dispatch)
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

Disk cost: ~500MB per worker (pnpm `node_modules` per worktree). Check the configured Tribunal VM's current capacity before increasing the worker count; machine-specific capacity belongs in local machine context.

## Final build gate + shared build lock

Tribunal no longer runs `pnpm run build` after every writer rewrite. Rewrites get cheap validation only (`validate-posts` for the target post + `git diff --check`). The full site build runs once, after all 4 judges pass and before PASS is persisted.

All workers serialize final builds through the main repo lock path:

```bash
.score-loop/locks/build.lock
```

The supervisor exports `TRIBUNAL_SHARED_LOCK_DIR=$ROOT_DIR/.score-loop/locks`, so worker worktrees all wait on the same lock instead of each worktree creating its own.

Useful troubleshooting commands:

```bash
# See final build gate lifecycle in logs
ls -t .score-loop/logs/tribunal-quota-loop-*.log | head -1 | xargs grep -E 'Waiting for build lock|Acquired build lock|Running final pnpm build|Final build (passed|failed)|Released build lock|classified as'

# Confirm current build process count
pgrep -af 'astro.*build|pnpm run build'

# Inspect lock file / holders (Linux)
ls -l .score-loop/locks/build.lock
fuser -v .score-loop/locks/build.lock 2>/dev/null || true
```

Log interpretation:
- `Waiting for build lock` but no `Acquired` yet: worker is queued behind another final build; timeout has not started.
- `Acquired build lock after Ns`: worker now owns the exclusive lock; only now does the 900s build timeout start.
- `Final build failed rc=124`: build execution timed out (`timeout --kill-after=15s 900 ...`), treated as operational/resource, no writer repair.
- `Final build failed rc=137` or log evidence like `heap out of memory`, `FATAL ERROR`, `SIGKILL`, `oom-kill`: likely resource/OOM, no writer repair.
- Build logs mentioning MDX/frontmatter/schema/render/content collection errors are treated as content-actionable and may trigger up to 2 bounded writer repair attempts. PASS is never written unless a subsequent final build succeeds.

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

Production 由 usage monitor 的 OpenAI session / weekly quota window 驅動
closed-loop controller。每個 window 都以 reset 倒數推回目前應有的
ideal burn line：

```
spendable_pct = 100 - QUOTA_FLOOR
elapsed_sec = window_sec - reset_sec
ideal_used_pct = spendable_pct * elapsed_sec / window_sec
allowed_used_pct = ideal_used_pct + QUOTA_BURST_ALLOWANCE
actual_used_pct = 100 - remaining_pct
```

若 actual burn 超過 allowed line，controller 會算出理想線追上目前用量所需的
debt sleep；session / weekly 取較長者。quota 已到 floor 時則直接等該
binding window reset。`ARTICLE_COST_PCT` 只保留作 EMA telemetry，不參與
dispatch gate 或 cooldown 計算。

**Key constants** (in `tribunal-quota-loop.sh`):

| Constant | Default | Description |
|---|---|---|
| `QUOTA_FLOOR` | 10% | Human reserve — never burn below this |
| `MIN_COOLDOWN` | 10s | Floor for inter-article wait |
| `MAX_COOLDOWN` | 1800s (30min) | `pacing` / `extra_limit` 的 cooldown 上限；不限制 quota reset 等待 |
| `ARTICLE_COST_PCT` | 0.5% | Cold start telemetry default (auto-calibrated via EMA) |
| `EMA_ALPHA` | 0.3 | Calibration smoothing factor |
| `EXTRA_USAGE_LIMIT` | 1.0 | Extra usage 相對於設定預算的比例門檻；`1.0` 代表超過 100% 才觸發 |

**Modes** (visible in `quota-controller.json`):

| Mode | Meaning |
|---|---|
| `pacing` | Normal closed-loop operation |
| `floor_stop` | One or both windows at/below floor — 等待 binding quota window reset，0 workers |
| `five_hour_debt` | OpenAI session burn 超前 allowed line — 等理想線追上，0 workers |
| `weekly_debt` | OpenAI weekly burn 超前 allowed line — 等理想線追上，0 workers |
| `extra_limit` | Extra usage 超過 `EXTRA_USAGE_LIMIT` 比例 — 用 `MAX_COOLDOWN` 暫停 dispatch |
| `fallback` | usage-monitor.sh unavailable — conservative 600s cooldown, 1 worker |

**Observability**:

`tribunal-monitor` 讀取設定時以 systemd unit 的 effective `Environment=`
為準，`tribunal.env` 只作 fallback；輸出會明列 `QUOTA_FLOOR`、
`GP_WRITER_MODE` 與 `TRIBUNAL_STRICT_ROLE_PROVIDERS` 的有效值。

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

**Self-calibration**: After each article completes (in single-worker mode), the controller computes the actual quota delta and updates `ARTICLE_COST_PCT` via exponential moving average (alpha=0.3). Cold start uses 0.5% as telemetry only. With sufficient history (≥5 entries), EMA converges to the true average cost.

**Startup rotation**: At daemon startup, entries older than 7 days are pruned from `quota-history.jsonl`.

**Legacy fallback**: Start with `--legacy-quota` to revert to the old binary GO/STOP behavior:

```bash
# Edit the systemd unit or wrapper to add the flag
ExecStart=... --workers 2 --legacy-quota
```

Legacy mode disables: controller, quota-history.jsonl, quota-controller.json, calibration.

### Deadline burst

要在 quota refresh 前加速消耗餘額，不需要新增另一套 controller。依序調整：

```bash
# 例：提高 pool 上限，讓 quota floor 歸零，放寬超前額度並縮短 dispatch 間隔
QUOTA_FLOOR=0 \
QUOTA_BURST_ALLOWANCE=10 \
MIN_COOLDOWN=1 \
bash scripts/tribunal-quota-loop.sh --workers 5
```

- `--workers N` 提高同時處理上限。
- `QUOTA_FLOOR=0` 暫時取消保留額度；這是 operator 明示的 burst 行為。
- 調高 `QUOTA_BURST_ALLOWANCE` 允許用量超前 ideal burn line 更多。
- 調低 `MIN_COOLDOWN` 縮短派送迴圈下限。
- `AUTOSCALE_OOM_CAP` 仍是記憶體壓力／近期 OOM 下的硬上限；要求 5 workers
  不代表 cgroup 一定允許 5 個同時跑。
- controller 只讀 OpenAI/Codex quota，**看不到 Claude writer quota**。Burst
  前要另外確認 Claude CLI 可用額度，不能把 Codex 餘額當成整條 pipeline
  的唯一燃料表。

systemd unit 對 off-repo `USAGE_MONITOR` 採 fail-closed：未設定、檔案不存在
或不可執行時，`ExecStart` 在啟動 loop 前以 78 結束。直接手動執行
`tribunal-quota-loop.sh` 則保留相容降級，controller 進 `fallback`
（1 worker / 600 秒），並觸發 operator alert；這個降級不能拿來宣稱
production daemon healthy。

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
| `Git drift: state=behind` or `state=diverged` in supervisor log | origin/main advanced while runtime kept local progress / content edits | Expected in fetch-only mode. Runtime keeps processing its current snapshot; use publisher or an explicit operator sync instead of rebasing the daemon worktree. |
| New code on main isn't reaching running workers | Worker worktrees are stale (see "Worker worktree gotcha" above) | `scripts/tribunal-worker-bootstrap.sh sync` — or restart (supervisor auto-syncs) |
| Article marked EXHAUSTED after 5 attempts | Real content / scoring issue, or model-induced flakiness | Open the stage log, look at scorer reasons; rewrite manually or flag for human review |
| Controller stuck in `floor_stop` even though quota looks OK | usage-monitor cache stale, or feedforward over-counting | Check `quota-controller.json` for `five_hr_pct` / `seven_day_pct`; force cache refresh: `rm /tmp/usage-monitor-cache/claude.json` |
| `ARTICLE_COST_PCT` too high/low | Calibration EMA hasn't converged (cold start), or multi-worker noise | Check `quota-history.jsonl` for recent deltas; controller will self-correct after ~5 single-worker articles |
| Controller in `fallback` mode | usage-monitor.sh returns error (OAuth token expired, API down) | SSH to the configured VM, run `"$USAGE_MONITOR" --json` manually to diagnose |
| Extra usage alarm (`extra_limit` mode) | Extra usage approaching monthly cap | Check `extra_used_usd` / `extra_limit_usd` in quota-controller.json; adjust limit in Anthropic console if intentional |
