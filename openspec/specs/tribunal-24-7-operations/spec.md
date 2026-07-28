# tribunal-24-7-operations Specification

## Purpose

定義 gu-log Tribunal 長時間部署的 writer、重啟、告警、監控與 burst 操作契約。

## Requirements

### Requirement: 部署版額度路徑 SHALL 使用限定 Codex 供應端的 JSON

部署版額度控制器與 model 額度錯誤探測 SHALL 執行有界指令 `codexbar usage --provider codex --source cli --format json --pretty`，並 SHALL 只根據通過驗證的 Codex JSON 做決策。部署版路徑 SHALL NOT 執行 CodexBar 合併供應端指令、Claude 額度指令，或任何會初始化這兩條路徑的 helper。

#### Scenario: 控制器讀取 Codex 額度

- **WHEN** 部署版控制器需要讀取額度
- **THEN** 它 SHALL 精確執行 `codexbar usage --provider codex --source cli --format json --pretty`
- **AND** SHALL 從該 JSON 取得 Codex 目前有效的額度視窗值
- **AND** SHALL NOT 呼叫合併供應端或 Claude 額度探測

#### Scenario: CodexBar 回報短窗未啟用

- **WHEN** 唯一的 Codex record 來自 `cli` 或 `codex-cli` source、`usage.primary` 明確為 `null`，且 weekly `secondary` 視窗完整有效
- **THEN** parser SHALL 把短窗標記為不參與控制器運算，而不是猜測短窗 reset 或進入 fallback
- **AND** 控制器 SHALL 繼續以通過驗證的 weekly 視窗做 floor 與 burn-rate 決策
- **AND** 缺少 `primary` key、非 `null` 的 malformed primary，或無效的 weekly 視窗仍 SHALL 封閉失敗

#### Scenario: Model 呼叫回報額度錯誤

- **WHEN** 部署版 Codex 評審或寫手回報額度錯誤
- **THEN** 額度錯誤處理器 SHALL 使用同一條限定 Codex 供應端的 CodexBar JSON 路徑決定等待或暫停
- **AND** 只有通過驗證的 exhausted 視窗 MAY 提供 tier 與 reset；視窗 unavailable 或讀值仍非零時 SHALL 以 unknown 暫停，不得推測耗盡的視窗
- **AND** SHALL NOT 呼叫合併或 Claude 額度路徑

#### Scenario: Codex 額度 JSON 無法取得或無效

- **WHEN** 限定 Codex 供應端的 CodexBar 指令失敗、逾時、輸出格式錯誤的 JSON，或缺少必要的 Codex 額度欄位
- **THEN** 部署版執行環境 SHALL 封閉失敗或進入既有可觀測的額度備援
- **AND** SHALL 輸出可採取行動的 log 或警報
- **AND** SHALL NOT 從 Claude 或合併供應端指令取得替代讀值

### Requirement: 長時間執行的部署版環境 SHALL 啟用改寫

部署版非互動式 24/7 執行環境（systemd unit／wrapper）SHALL 設定 `GP_WRITER_MODE=codex`，並 SHALL 在派送文章前驗證 Codex 寫手能完成有界的寫入 canary。Canary SHALL 從 `.codex/agents/tribunal-writer.toml` 解析 `tribunal-writer` model，並 SHALL 重用正式寫手專用的 `workspace-write` 沙箱、tmp 排除、無網路邊界、approval policy 與逾時行為。部署版服務與 wrapper SHALL NOT 讀取、匯出或驗證 Claude token 或憑證。Library 預設 MAY 維持 `none`，非部署版互動式編排 MAY 保留 `subagent` 或舊版 `cli` 相容性，但正式 daemon SHALL NOT 以只評分、未消費 broker 或 Claude CLI 寫手模式執行。

#### Scenario: 未過關文章由 Codex 改寫而非跳過

- **WHEN** 文章在部署版 daemon 的任一評審階段未過關
- **THEN** Codex Tribunal 寫手 SHALL 使用 `.codex/agents/tribunal-writer.toml` 的 model 接受呼叫
- **AND** 改寫 SHALL 在正式環境專用的寫手沙箱內執行
- **AND** 本次執行 SHALL NOT 記錄 `rewrite skipped (GP_WRITER_MODE=none)`，也不得在沒有改寫時耗盡嘗試次數變成 EXHAUSTED
- **AND** 寫手 log 或進度來源 SHALL 記錄實際 Codex provider／model

#### Scenario: 寫手寫入 canary 在派送前成功

- **WHEN** 部署版 daemon 啟動時 Codex 可用，且 tribunal-writer TOML 有效
- **THEN** 前置檢查 SHALL 要求正式 Codex 寫手執行器在私有專用 canary 工作區寫入固定 sentinel
- **AND** 前置檢查 SHALL 在設定的逾時內驗證完全相同的 sentinel 內容
- **AND** canary SHALL 無權寫入正式 repo、slash tmp 或 `TMPDIR`，也不得存取網路
- **AND** daemon SHALL 只在這項驗證完成後領取或派送文章

#### Scenario: 寫手前置檢查在派送前失敗

- **WHEN** 寫手模式不是 `codex`、Codex 無法使用、tribunal-writer TOML 無效、canary 逾時，或 sentinel 遺失或錯誤
- **THEN** 部署版 daemon SHALL 在領取或派送文章前退出
- **AND** SHALL 輸出可採取行動的寫手前置檢查錯誤
- **AND** SHALL NOT 透過 Claude 重試

#### Scenario: 部署版服務在沒有 Claude CLI 或憑證時仍可執行

- **WHEN** Codex 角色設定與寫入 canary 有效、`PATH` 中沒有 `claude`，且不存在 Claude token 檔或 Claude 憑證環境變數
- **THEN** 部署版服務啟動、wrapper、doctor、文章派送、改寫與額度復原 SHALL 仍然成功
- **AND** 這些路徑 SHALL 全都不得檢查或呼叫 Claude 執行檔
- **AND** 這些路徑 SHALL 全都不得讀取、匯出或驗證 Claude 憑證

#### Scenario: 非部署版相容路徑留在正式環境之外

- **WHEN** 部署版嚴格模式未啟用
- **THEN** 互動式 `subagent`、舊版 `cli` 或 CCC 供應端備援 MAY 維持可用
- **AND** 這些相容路徑 SHALL NOT 滿足或繞過部署版 Codex 寫入 canary 合約

### Requirement: 部署版雙語改寫 SHALL 以 crash-atomic 方式復原

部署版雙語候選套用 SHALL 在第一次正式語言檔交換前，保存並 fsync 一份
mode-0600 journal，綁定正式檔與暫存檔的 identity、bytes 與 mode。啟動流程
SHALL 在破壞性的 worker 同步或文章派送前，復原 main checkout 與每個既有
worker worktree 的待處理 journal。復原 SHALL 可重入且有界；未知或經人工
修改的狀態 SHALL 保留證據並封閉失敗。

#### Scenario: 行程在第一個語言檔交換後死亡

- **WHEN** 候選套用行程在交換 EN 後、交換 zh-tw 前收到 SIGKILL
- **THEN** 耐久 journal SHALL 在行程死亡後仍可取得
- **AND** 啟動復原 SHALL 恢復一致的雙語 baseline
- **AND** 復原中再次中斷時 SHALL 仍可安全重入

#### Scenario: 待處理 journal 與人工編輯衝突

- **WHEN** 啟動時找到待處理 journal，但正式路徑已不符合 journal 擁有的任何 identity 與 bytes
- **THEN** 復原 SHALL 在 worktree 同步或文章派送前停止
- **AND** SHALL 保留 journal 與被換出的證據
- **AND** SHALL NOT 猜測、覆寫或刪除人工狀態

#### Scenario: Main 與 worker journal 必須先於 worktree 同步處理

- **WHEN** 部署版啟動流程在 main checkout 與一個以上既有 worker worktree 找到待處理 journal
- **THEN** 它 SHALL 在破壞性 worker 同步前復原每筆可確定歸屬的 transaction
- **AND** 文章派送 SHALL 維持阻擋，直到所有掃描成功

#### Scenario: 復原證據不安全或超出上限

- **WHEN** 待處理 journal 是 symlink／FIFO／特殊檔、目錄掃描超出設定上限，或 journal 擁有的 identity 不符合已知 baseline／候選狀態
- **THEN** 復原 SHALL 在同步或派送前封閉失敗
- **AND** SHALL 保留每個未知 journal／暫存／正式 artifact 供檢查

### Requirement: The runtime SHALL survive a host reboot

The deployed runtime SHALL be configured to restart automatically after a host reboot.

#### Scenario: Daemon returns after reboot

- **WHEN** the Tribunal VM host reboots
- **THEN** the tribunal daemon SHALL start again without manual intervention
- **AND** the deploy documentation SHALL state the required `systemctl --user enable` + `loginctl enable-linger` steps

### Requirement: Operational failures SHALL reach the operator on the deploy host

Abnormal runtime states SHALL be delivered to a channel the operator actually receives on the Linux deploy host. `TRIBUNAL_NOTIFIER`, when configured, SHALL be an executable path invoked directly with the complete alert message as one argument; the runtime SHALL NOT evaluate it as shell text. A macOS-only notification SHALL NOT be the sole alert path.

#### Scenario: Stall or EXHAUSTED or fallback alerts the operator

- **WHEN** the daemon stalls, hits an EXHAUSTED spike, or enters `fallback`/`floor_stop`
- **THEN** an alert SHALL be sent via a host-appropriate channel (e.g. Telegram / host notifier)
- **AND** where no channel is configured it SHALL at least record an observable log line, never silently no-op

#### Scenario: Notifier message cannot become shell code

- **WHEN** `TRIBUNAL_NOTIFIER` is configured and an alert message contains spaces, quotes, substitutions, or shell metacharacters
- **THEN** the runtime SHALL execute the notifier path directly with the unchanged message as one argument
- **AND** SHALL NOT use `eval`, `sh -c`, or equivalent shell interpretation

### Requirement: The monitoring tool SHALL report the live controller state

The monitoring tool SHALL parse the current controller output (`quota-controller.json`, `CONTROLLER:` log lines, the configured floor) rather than a retired format. It SHALL also report writer preflight, systemd unit enablement, and user linger state.

#### Scenario: Monitor shows real quota/mode

- **WHEN** an operator runs the tribunal monitor against the live daemon
- **THEN** it SHALL show the current controller `mode` and quota reading
- **AND** SHALL show the configured floor, writer mode/preflight, unit enabled state, and linger state
- **AND** SHALL NOT report blanks because it is matching a removed `Tier …% remaining` format or a stale 3% floor (the real default floor is 10%)

### Requirement: Burst spend SHALL be operator-configurable

The runtime SHALL let an operator increase burn rate to drain a large quota balance before a refresh deadline, with the limits documented.

#### Scenario: Operator raises burn rate

- **WHEN** an operator wants to spend a large balance before refresh
- **THEN** raising `--workers`, lowering `QUOTA_FLOOR`, raising `QUOTA_BURST_ALLOWANCE`, and lowering `MIN_COOLDOWN` SHALL increase throughput
- **AND** the docs SHALL state that the cgroup autoscaler can cap workers at `AUTOSCALE_OOM_CAP` under memory pressure and that the controller paces Codex/GPT quota only, not Claude
