<!-- md-zh-tw: ignore -->

# Tribunal operations runbook

> gu-log tribunal runtime is a quota-aware, graceful-stop daemon running on the operator-configured Tribunal VM. It runs 4 judges (Librarian / FactChecker / FreshEyes / VibeScorer) against unscored posts and auto-rewrites failures. This doc covers the day-to-day operational moves.

## GP source-preservation boundary

`gp-*` 是明確例外：Tribunal 對 GP 只提供一般品質校準，不擁有來源正文的 rewrite authority。所有 GP 呼叫都必須使用 `--no-rewrite`；`--allow-rewrite`、final-build writer repair、`restructure` 與 `rebuild` routing 對 GP 一律拒絕。persona／narrative 低分可以誠實記錄並依 floor policy 發布，但不得補償或蓋過 gp-pipeline 的 source reviewer、natural-zh gate、canonical-body projection 與 freshness hard gates。

若 GP hard gate 未通過、provider／runner 發生錯誤、缺少有效 verdict，或 source/body hash 已 stale，pipeline 必須停在 deploy 前。修復方式是回到原 workdir 的安全 recovery point 重跑相同角色，不是把 GP 送進通用 writer。model／provider 選擇仍以 runtime config 與 agent frontmatter 為 SSOT，本節不複製版本快照。

## Writer candidate 的 frontmatter 邊界

隔離寫手交易預設保護整份 frontmatter。唯一例外是 FactChecker 失敗後的 bounded rewrite：若評審指出讀者可見摘要的事實錯誤，寫手可替換既有 top-level、單一實體行、帶引號的 `summary` payload。English sidecar 存在時，中英文摘要必須一起變更或一起不變；沒有 sidecar 時可只修正 zh-tw，交易不會替文章建立英文檔。其他 judge 與 final-build repair 沒有這項權限。

這個例外不會放寬其餘交易邊界。欄位位置、key、quote style、行尾、行內註解與其他 frontmatter bytes 都必須維持原樣；duplicate key、block／multiline scalar、tag、anchor、alias 與 plain scalar 都不支援。候選仍先通過 post／YAML validation，再由雙語 CAS 套用；套用後必須讓下一輪 FactChecker 重新評分，摘要變更本身不代表 PASS。Capture、apply 與 validation-failure rollback 由 parent 明示傳遞同一個 stage policy；restart recovery 只依 journal 內的完整 bytes 與 inode identity 收斂，不解析摘要，也不需要知道是哪個 judge。

若 log 顯示 `unsupported … summary shape`，代表候選碰到不在封閉 allowlist 內的 YAML 形狀，不是一般 validator 警告。Canonical pair 會保持不變；先保留 log／journal 證據，透過正常 feature branch／PR 把既有摘要整理成受支援的單行 quoted scalar，再從原 stage 重跑。不要在 live runtime 手改 frontmatter，也不要靠改 prompt、重送相同候選或切換 writer 來升級權限。實際 policy 名稱與 CLI 參數以 snapshot helper 與 shell caller 為準，本節不複製 executable 值。

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
- `scripts/cc-tribunal-loop-wrapper.sh` — establishes the systemd PATH and execs the loop without loading Claude credentials.

## Deploy

Host and checkout mappings are local-only. Before operating the VM, load
`TRIBUNAL_HOST` 與 remote `GU_LOG_DIR` from the local machine note; worker
worktrees live beside `GU_LOG_DIR` as `gu-log-worker-{a,b}`.

```bash
# On Mac: merge the approved PR through the protected branch flow first.

# One-time bootstrap（rerun whenever the remote checkout path changes）.
# GU_LOG_DIR is an absolute path on the remote host.
: "${TRIBUNAL_HOST:?Set TRIBUNAL_HOST}"
: "${GU_LOG_DIR:?Set remote GU_LOG_DIR}"

case "$GU_LOG_DIR" in
  *$'\n'*|*$'\r'*|*"'"*)
    echo "Remote path must not contain newlines or single quotes" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

GU_LOG_DIR_B64=$(printf '%s' "$GU_LOG_DIR" | base64 | tr -d '\n')
ssh "$TRIBUNAL_HOST" bash -s -- "$GU_LOG_DIR_B64" <<'CONFIG'
set -euo pipefail
GU_LOG_DIR=$(printf '%s' "$1" | base64 --decode)

git -C "$GU_LOG_DIR" rev-parse --show-toplevel >/dev/null

config_dir="$HOME/.config/gu-log"
config_file="$config_dir/tribunal.env"
install -d -m 700 "$config_dir"
tmp=$(mktemp "$config_dir/.tribunal.env.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  printf "GU_LOG_DIR='%s'\n" "$GU_LOG_DIR"
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
cd "$GU_LOG_DIR"

# Stop dispatch first. If an article is in flight, the service stays active
# until that whole article (including its transient Codex unit) reaches the
# article boundary. Never mutate or stash the checkout while it is live.
if systemctl --user is-active --quiet tribunal-loop; then
  touch .score-loop/control/stop-graceful
  # wait for service inactive (minutes → up to 60min if article is mid-stage)
  until [ "$(systemctl --user is-active tribunal-loop)" != "active" ]; do sleep 10; done
fi

# Fetch only updates Git object/ref storage; it does not touch checkout bytes.
# Materialize the recovery helper from the freshly fetched protected main so
# the first rollout also works when the old checkout does not have this file.
git fetch origin main
umask 077
recovery_helper="$(
  mktemp "${TMPDIR:-/tmp}/gu-log-tribunal-recovery.XXXXXX.py"
)"
trap 'rm -f "$recovery_helper"' EXIT
git show origin/main:scripts/tribunal-post-pair-snapshot.py > "$recovery_helper"

# Resolve any durable bilingual exchange evidence before stash/checkout can
# touch tracked post bytes. An unknown journal keeps deployment failed closed.
recovered="$(
  python3 "$recovery_helper" \
    recover-pending src/content/posts
)"
case "$recovered" in
  ''|*[!0-9]*)
    echo "Invalid Tribunal recovery count: $recovered" >&2
    exit 78
    ;;
esac
echo "Recovered $recovered pending bilingual writer transaction(s)."
rm -f "$recovery_helper"
trap - EXIT

did_stash=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  # Journal/restore evidence is gitignored, so --include-untracked cannot
  # detach it from the canonical post directory.
  git stash push -m "wip" --include-untracked
  did_stash=true
fi
git checkout main && git merge --ff-only origin/main
if [ "$did_stash" = true ]; then
  git stash pop
fi

# Redeploy every tracked user unit so the effective runtime cannot silently
# drift behind the checkout.
install -d -m 700 "$HOME/.config/systemd/user"
install -m 0644 scripts/tribunal-runtime.slice "$HOME/.config/systemd/user/tribunal-runtime.slice"
install -m 0644 scripts/tribunal-loop.service "$HOME/.config/systemd/user/tribunal-loop.service"
install -m 0644 scripts/tribunal-pass-audit.service "$HOME/.config/systemd/user/tribunal-pass-audit.service"
install -m 0644 scripts/tribunal-pass-audit.timer "$HOME/.config/systemd/user/tribunal-pass-audit.timer"
systemctl --user daemon-reload
# Restart guarantees this smoke is a fresh invocation of the just-reloaded
# unit, then fails the deploy if it cannot refresh origin/main or finds a
# historical progress-only PASS commit.
systemctl --user restart tribunal-pass-audit.service
systemctl --user enable tribunal-loop
systemctl --user enable tribunal-pass-audit.timer
systemctl --user restart tribunal-pass-audit.timer
loginctl enable-linger "$USER"

systemctl --user start tribunal-loop   # supervisor auto-syncs worker worktrees at startup
DEPLOY
```

`tribunal-pass-audit.timer` 有 `Persistent=true`；如果 VM 錯過排程，
deploy 時的 timer restart 可能立刻補跑一次 audit。這是預期行為，不要
為了避免補跑而停用 timer。deploy block 會先同步執行一次 audit；timer
負責的是後續每日稽核，不是初次驗證。

`enable` 讓 user unit 在 user manager 啟動時自動回來；`enable-linger`
讓 user manager 在未登入時也會於開機後存在。兩個都要有，少一個就
不能宣稱 reboot-persistent。部署後用 wrapper doctor 驗證 unit、linger、
strict provider contract、loaded resource slice，以及目前 service PID 寫下
的 writer preflight 狀態；這個日常檢查不會再執行一次 Codex：

```bash
bash scripts/cc-tribunal-loop-wrapper.sh --doctor
```

只有需要重新驗證正式 writer CLI/auth 與實際寫入 sandbox 時才明確執行 live
probe。它會在 disposable workspace 跑 bounded write canary，並重用正式
writer 的隔離 workspace、non-interactive permission 與 systemd resource
boundary；canary
內容完全吻合後才輸出 exact `OK`：

```bash
bash scripts/cc-tribunal-loop-wrapper.sh --doctor --live-probe
```

Deployed judge、writer 與 write-canary 每次都建立
transient systemd service。`KillMode=control-group` 會連 `setsid()` 後代一起
回收；每次 invocation 有獨立 Memory/CPU/Tasks 上限，並和 supervisor、
build workers 共用 `tribunal-runtime.slice` 的 aggregate ceiling。Startup
若找不到已載入的 tracked slice，會在 article claim 前 exit 78，不會退回
PGID cleanup 或 compatibility provider。

Writer 的雙語 CAS 在第一次 exchange 前會 fsync mode-0600 journal。Startup
會先掃 main checkout，再於任何 worker worktree sync 前掃現有 workers；
可判定的 interrupted transaction 會重入復原，unknown/human/symlink/FIFO
狀態則保留 evidence 並在 dispatch 前 fail closed。不要手動刪除
`src/content/posts/.tribunal-pair-journal-*` 或對應 restore temp。

部署 checklist：

- `tribunal.env` 的 `GU_LOG_DIR` 存在且指向有效 checkout；不再設定或依賴
  off-repo combined `USAGE_MONITOR`。
- Codex CLI 與官方 Grok Build CLI 都已安裝、已驗證 non-interactive auth；deployed runtime 不讀
  Claude CLI、Claude token 或 `~/.cc-cron-token`。
- `systemctl --user enable tribunal-loop` 回報 enabled。
- 下列四個 source-match 都 exit 0：
  - `cmp -s scripts/tribunal-runtime.slice "$HOME/.config/systemd/user/tribunal-runtime.slice"`
  - `cmp -s scripts/tribunal-loop.service "$HOME/.config/systemd/user/tribunal-loop.service"`
  - `cmp -s scripts/tribunal-pass-audit.service "$HOME/.config/systemd/user/tribunal-pass-audit.service"`
  - `cmp -s scripts/tribunal-pass-audit.timer "$HOME/.config/systemd/user/tribunal-pass-audit.timer"`
- `systemctl --user is-enabled tribunal-pass-audit.timer` 回報 enabled，
  `systemctl --user is-active tribunal-pass-audit.timer` 回報 active。
- `systemctl --user show tribunal-pass-audit.timer -p NextElapseUSecRealtime --value`
  有下一次執行時間。
- `systemctl --user show tribunal-pass-audit.service -p ExecMainExitTimestamp --value`
  有手動 smoke 的完成時間；`Result` 是 success、`ExecMainStatus` 是 0。
- `systemctl --user show tribunal-pass-audit.timer -p LastTriggerUSec --value`
  是 daily timer 的歷史證據；第一次 deploy 若尚未到排程時間，空值是正常的。
- `systemctl --user show tribunal-pass-audit.service tribunal-pass-audit.timer -p FragmentPath -p NeedDaemonReload`
  指向上述安裝路徑，且兩個 unit 的 `NeedDaemonReload` 都是 no。
- `systemctl --user show tribunal-pass-audit.service tribunal-pass-audit.timer -p DropInPaths`
  沒有未審核的 override；若非空，先逐一確認 effective contract。
- `loginctl enable-linger "$USER"` 後 `loginctl show-user "$USER" -p Linger --value` 回報 yes。
- `bash scripts/cc-tribunal-loop-wrapper.sh --doctor` 全數通過。
- 啟動後 monitor 顯示 `TRIBUNAL_RUNTIME_PROFILE=vm-codex`、
  `GP_WRITER_MODE=grok`、strict role routing 與 writer preflight passed。

Deployed `vm-codex` profile 由 Codex 執行 Fact Checker、Librarian 與 Fresh
Eyes，由 Grok Build 執行 writer 與 Vibe Scorer。model／effort／quota 門檻的
單一 SSOT 是 `config/llm-pipeline.json`；升級 model 時只改這裡與 contract
tests。`.codex/agents/*.toml` 與 `.claude/agents/*.md` 繼續服務 legacy／Claude
Code Cloud，不受 VM profile 覆寫。`GP_WRITER_MODE=cli` 只保留舊 caller
相容性，不是 production 可接受的設定；deployed preflight 看到它會在任何
article claim 前以 rc 78 fail closed。

`vm-codex` 啟動前會同時驗證 Codex 與 Grok CLI、登入狀態及 Grok model
availability；任一不相容就 fail closed，不會半套啟用新 routing。Codex
reviewer 取 session／weekly 較低剩餘百分比：`>= 20%` 使用
`gpt-5.6-sol` + `xhigh`，`< 20%` 使用 `gpt-5.6-luna` + `max`；讀值未知時
採保守的 Luna。Grok 4.6 writer／Vibe 使用 `low` effort。

Grok 低 quota 政策只有在取得真實百分比時才生效：
`10% <= remaining < 20%` 保留 writer、延後 Vibe；低於 10% writer 也暫停，
不會偷換其他 writer。現行 CodexBar
尚無可靠 Grok Build quota feed，因此 `grokQuota.enabled` 預設為 `false`，
未知就是 unknown，不捏造百分比。`TRIBUNAL_GROK_REMAINING_PCT` 只供有
可信外部讀值的 operator 注入與 contract test；CodexBar 日後支援時，再於
同一份 config 開啟自動 probe。

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
- 非 GP build logs mentioning MDX/frontmatter/schema/render/content collection errors are treated as content-actionable and may trigger bounded writer repair。這條 repair 只能修改 body，不能改 `summary` 或任何 frontmatter；GP 不進 final-build writer repair。Build failure 直接保留為阻擋證據，修好 deterministic 問題後從原 workdir 重跑。PASS is never written unless a subsequent final build succeeds.

## Auto scale-down / up (memory throttle)

When `--workers > 1`, the supervisor samples the shared
`tribunal-runtime.slice` memory each loop iteration and adjusts a soft cap on
the active worker count. The slice includes the supervisor/build workers and
all transient Codex/Grok judge/writer services, so provider RSS cannot disappear from
autoscaling or escape the aggregate 4G/200% boundary.

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

Production 由 provider-specific Codex JSON 的 session / weekly quota
window 驅動 closed-loop controller，不讀 combined provider output。每個
window 都以 reset 倒數推回目前應有的 ideal burn line：

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
| `fallback` | Codex quota JSON unavailable — conservative 600s cooldown, 1 worker |

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

Judge 遇到 quota error 時，shell error path 只執行以下 provider-specific
probe，並直接解析 JSON 的 Codex 額度視窗：

```bash
codexbar usage --provider codex --source cli --format json --pretty
```

這條路不呼叫 CodexBar combined usage，也不查 Claude。回傳 record 的
`source` 可為 `cli` 或 CodexBar 正規化後的 `codex-cli`。如果
`usage.primary` 明確為 `null`、weekly `secondary` 完整有效，短窗會以
inactive sentinel 排除在 burn-rate 運算外，只由 weekly 視窗決策；這不等於
猜短窗有 100% 額度。JSON 缺少 primary key、primary 非 null 卻 malformed、
weekly 缺欄位、帶 provider error，或 command 失敗時一律視為 unparseable
並 suspend，不從人類可讀文字猜 quota。

若 model 回傳 quota-like error，但通過驗證的視窗仍有餘額，或 primary
視窗 unavailable，error handler 會以 `unknown` 暫停；只有實際為零的
視窗才會記錄 exhausted tier 與 reset。Controller probe 失敗時，history
與 state 的未知百分比使用 `-1` sentinel，不得把 unavailable 寫成 `0%`。

**Self-calibration**: After each article completes (in single-worker mode), the controller computes the actual quota delta and updates `ARTICLE_COST_PCT` via exponential moving average (alpha=0.3). Cold start uses 0.5% as telemetry only. With sufficient history (≥5 entries), EMA converges to the true average cost.

**Startup rotation**: At daemon startup, entries older than 7 days are pruned from `quota-history.jsonl`.

`--legacy-quota` 只保留給 non-deployed compatibility fixtures；deployed
systemd 明確拒絕這個 flag（rc 78），避免重新啟動 combined provider probe。
它不是 production rollback。

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
- controller 只控制 OpenAI/Codex quota；Grok 另走上述獨立 gate。deadline
  burst 不需要、也不得拿 Claude quota 或 credential 當成功條件，也不會
  自動取消 Grok 的 10% writer reserve。

systemd unit 不再接受 off-repo `USAGE_MONITOR`，啟動只需要有效的
`GU_LOG_DIR`。Quota 讀取由 tracked runtime 的 Codex-only JSON path 負責；
provider-specific JSON 不可讀時的 `fallback` 會觸發 operator alert，且
不能拿來宣稱 production daemon healthy。

**Rollback procedure**:

1. `systemctl --user stop tribunal-loop`，先保留 runtime ledger、recovery
   token 與任何 `.tribunal-restore-*` exchange evidence。
2. 透過正常 feature branch／PR 將 code 與 OpenSpec 整體 revert 到上一個已知
   可用 release；不可只在新版 strict mode 加 `--legacy-quota` 或偷切
   Claude fallback。
3. VM checkout 同步到該 revert 已 merge 的 exact `origin/main`，重新複製
   匹配版本的 tracked `scripts/tribunal-loop.service`。
4. `systemctl --user daemon-reload` 後再啟動 service，跑 doctor、monitor 與
   bounded smoke；provider contract 必須如實顯示該 rollback release 的行為。

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Workers dispatched but log stays quiet for >1min | Worker sleeping inside `wait_for_*` (quota/quiet-hours left over from old code) | `sync` workers + restart |
| Service inactive, `rc_exit_stopped` in log, flag still present | Someone touched the flag manually; supervisor cleared it on exit | `systemctl --user start tribunal-loop` |
| Same article claimed by a dead pid, new workers blocked | Worker crashed without releasing claim | `scripts/tribunal-worker-bootstrap.sh status` to confirm workers are alive; supervisor runs `rc_gc_stale_claims` at startup; to force now: `rm -rf .score-loop/claims/<slug>.claim` |
| Writer candidate reports `unsupported … summary shape` | FactChecker tried to change a duplicate、multiline、tagged、anchored、plain or otherwise non-allowlisted `summary` | 保留證據；走正常 branch／PR 將 canonical summary 收斂成既有單行 quoted scalar，再從原 stage 重跑。不要手改 live runtime 或放寬 prompt。 |
| `Git drift: state=behind` or `state=diverged` in supervisor log | origin/main advanced while runtime kept local progress / content edits | Expected in fetch-only mode. Runtime keeps processing its current snapshot; use publisher or an explicit operator sync instead of rebasing the daemon worktree. |
| New code on main isn't reaching running workers | Worker worktrees are stale (see "Worker worktree gotcha" above) | `scripts/tribunal-worker-bootstrap.sh sync` — or restart (supervisor auto-syncs) |
| Article marked EXHAUSTED after 5 attempts | Real content / scoring issue, or model-induced flakiness | Open the stage log, look at scorer reasons; rewrite manually or flag for human review |
| Controller stuck in `floor_stop` even though quota looks OK | CodexBar reading stale, or feedforward over-counting | Check `quota-controller.json` for `five_hr_pct` / `seven_day_pct`; run `codexbar usage --provider codex --source cli --format json --pretty` directly |
| `ARTICLE_COST_PCT` too high/low | Calibration EMA hasn't converged (cold start), or multi-worker noise | Check `quota-history.jsonl` for recent deltas; controller will self-correct after ~5 single-worker articles |
| Controller in `fallback` mode | Provider-specific CodexBar command failed or returned invalid JSON | SSH to the configured VM and run the exact CodexBar command above |
