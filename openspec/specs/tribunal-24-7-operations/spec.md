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

### Requirement: FactChecker 改寫 MAY 原子修正讀者可見摘要

部署版 parent runner MAY 只在 `factChecker` 失敗後的有界改寫，允許寫手替換既有頂層單一實體行、帶引號的 `summary` 字串內容。這項權限 SHALL 由 runner 依 stage 推導，不得由寫手、prompt、文章內容、provider 或另一個可矛盾的參數升級。English sidecar 存在時，zh-tw／English 摘要 SHALL 兩邊都改或兩邊都不改；沒有 sidecar 時 MAY 只修正 zh-tw，且不得建立新的 English 檔。其他 judge rewrite 與 final-build repair SHALL 維持全部 frontmatter 不可變。

允許的內容替換之外，summary key、位置、quote style、行尾與所有 frontmatter bytes SHALL 維持不變。候選捕獲 SHALL 封閉拒絕重複鍵（包含帶引號或明確鍵形式）、多行／block／plain／tagged／anchored scalar 及 malformed escape。捕獲、驗證、套用與 CAS rollback SHALL 使用同一個由 stage 推導的 policy；crash recovery SHALL 依 journal 保存的完整 bytes 與 identity 維持 policy-neutral 的既有雙語 crash-atomic 邊界。摘要候選仍 SHALL 由下一輪 FactChecker 重新評分，不得直接取得 PASS。

#### Scenario: FactChecker 修正雙語摘要後重新驗證

- **WHEN** `factChecker` 因既有 zh-tw `summary` 的事實錯誤判定失敗，且 English sidecar 存在
- **THEN** parent runner MAY 允許 writer 在隔離候選中成對替換兩個既有單行 quoted `summary` payload
- **AND** 兩個語言檔除 summary payload 外的 frontmatter bytes SHALL 完全等於各自 baseline
- **AND** candidate SHALL 先通過既有 post／YAML validation，再以雙語 CAS 套用
- **AND** 下一輪 FactChecker SHALL 重新讀取套用後的文章並依既有 pass bar 判斷
- **AND** summary 替換本身 SHALL NOT 直接取得 PASS

#### Scenario: Writer 嘗試改動受保護 frontmatter

- **WHEN** writer 新增、刪除、搬移或改動非 `summary` frontmatter，改變 summary 的 key／quote style／行結構，產生 duplicate／multi-line／block／plain／tagged／anchored summary，或只改雙語 pair 的其中一邊
- **THEN** candidate capture SHALL 封閉失敗並保留 canonical pair
- **AND** quoted key、explicit key 與其他不支援的 YAML key 形狀 SHALL NOT 繞過 duplicate-summary 拒絕
- **AND** runner SHALL NOT 把該候選視為成功改寫

#### Scenario: 沒有 English sidecar 的 FactChecker 摘要修正

- **WHEN** `factChecker` rewrite 處理沒有 English sidecar 的文章，並只替換既有 zh-tw 單行 quoted `summary` payload
- **THEN** candidate capture MAY 接受該單語摘要候選
- **AND** runner SHALL NOT 為了滿足 paired policy 建立新的 English sidecar
- **AND** 候選仍 SHALL 經過 validation、CAS apply 與下一輪 FactChecker 重評

#### Scenario: 非 FactChecker 路徑嘗試改動摘要

- **WHEN** Librarian、FreshEyes、Vibe 或 final-build repair 的 writer candidate 改動任一 `summary`
- **THEN** transaction SHALL 只從目前 stage 推導 preserve-all policy，並封閉拒絕該候選
- **AND** writer prompt、provider 或 caller SHALL NOT 傳入另一個可矛盾的 policy 來升級權限

#### Scenario: 摘要候選在 runner validation 失敗

- **WHEN** 實際 runner 已套用合法 paired-summary candidate，但後續 validation 失敗
- **THEN** runner 的 rollback 路徑 SHALL 使用與該 stage capture／apply 相同的 policy
- **AND** CAS rollback SHALL 收斂回完整 baseline pair
- **AND** SHALL NOT 覆寫平行人工編輯

#### Scenario: 摘要候選在雙語 exchange 中途死亡

- **WHEN** 行程在合法 paired-summary candidate 的雙語 exchange 中途終止
- **THEN** policy-neutral crash recovery SHALL 只依 journal 的完整 baseline／candidate bytes 與 identity 判斷
- **AND** 最終 SHALL 收斂成完整 baseline pair 或完整 candidate pair
- **AND** SHALL NOT 產生單語新摘要或丟棄未知 journal 證據

### Requirement: 無合法自動修復動作的 Tribunal 失敗 SHALL 進入綁定 revision 的 NEEDS_REVIEW

當 judge 已產生合法的內容失敗判定，且文章政策明確禁止任何可改變讀者可見輸入的自動修復動作時，Tribunal SHALL 將文章轉為現行 Tribunal 版本的 `NEEDS_REVIEW`，而非再次自動評分或以 `EXHAUSTED` 表示。終態 SHALL 綁定失敗階段與 reader-visible revision、保留真實失敗證據，SHALL NOT 增加頂層內容嘗試次數，且 SHALL NOT 假造 PASS。只有 GP source-preservation no-rewrite policy 符合此自動 transition；其他 no-rewrite invocation 或 operational failure SHALL NOT 被推論為相同終態。

#### Scenario: GP 首次有效失敗後停止自動重派

- **WHEN** GP 文章在 source-preservation policy 禁止自動改寫時收到符合 schema 的 judge 失敗判定
- **THEN** runner SHALL 原子寫入現行 Tribunal 版本的 `NEEDS_REVIEW`、失敗階段、reader revision 與 machine-readable reason
- **AND** SHALL 保留真實的失敗分數證據
- **AND** SHALL NOT 增加頂層內容嘗試次數
- **AND** quota loop、bounded batch runner 與同 revision 的手動執行 SHALL NOT 再次呼叫 judge

#### Scenario: Score-only GP 失敗維持診斷用途

- **WHEN** GP 文章在 `--score-only` 診斷模式得到符合 schema 的 judge 失敗判定
- **THEN** runner SHALL 維持既有不具權威性的 rc `1`
- **AND** SHALL NOT 寫入 authoritative `NEEDS_REVIEW`
- **AND** SHALL NOT 回報 exit code `3`

#### Scenario: 後端分數 metadata 不會解除 NEEDS_REVIEW

- **WHEN** `NEEDS_REVIEW` 文章只有 Tribunal 分數、model provenance、timestamp 或其他非 reader-visible metadata 改變
- **THEN** reader revision SHALL 維持相同
- **AND** 文章 SHALL 維持 `NEEDS_REVIEW`
- **AND** scheduler SHALL NOT 把 metadata 寫入視為修稿後的重新評分資格

#### Scenario: Reader-visible 修正重新開案

- **WHEN** 現行 Tribunal 版本的 `NEEDS_REVIEW` 文章，其 reader-visible canonical content 已改變
- **THEN** runner 與 scheduler SHALL 將它視為可重新評分
- **AND** SHALL 清除舊 terminal transition 對新 revision 的阻擋
- **AND** 新 revision SHALL 從必要階段重新接受真實 judges 判定

#### Scenario: Operator 明確 requeue 同 revision

- **WHEN** operator 對現行 Tribunal 版本的 `NEEDS_REVIEW` 文章執行明確 requeue command
- **THEN** progress ledger SHALL 在同一把 progress lock 下記錄 requeue timestamp、reason 與遞增 count
- **AND** SHALL 保留既有失敗證據
- **AND** 下一次 dispatch SHALL 允許恰好一次重新判斷
- **AND** 若同 revision 再次得到有效且無可修復的失敗判定，文章 SHALL 再次回到 `NEEDS_REVIEW`

#### Scenario: Tribunal contract 版本更新重新開案

- **WHEN** 文章儲存的 Tribunal 版本低於現行 Tribunal 版本
- **THEN** 既有版本重設 contract SHALL 優先重新開案
- **AND** 舊版 `NEEDS_REVIEW` SHALL NOT 永久阻擋新版 contract 的重新判斷

#### Scenario: Judge 執行期間 reader revision 漂移

- **WHEN** runner 在 judge 前取得 revision A，但 terminal transition 前 current revision 已變為 B
- **THEN** runner SHALL NOT 把針對 revision A 的失敗判定綁成 revision B 的 `NEEDS_REVIEW`
- **AND** SHALL NOT 增加頂層內容嘗試次數
- **AND** SHALL 以可觀測的 operational outcome 結束，讓 revision B 之後接受完整重新評分

#### Scenario: Reader revision 無法計算

- **WHEN** manual runner 或任一 scheduler 無法讀取 post 或計算 reader revision
- **THEN** 該路徑 SHALL fail closed 且 SHALL NOT 呼叫 judge
- **AND** SHALL NOT 覆蓋既有失敗或終態證據
- **AND** SHALL 輸出可採取行動的 operational warning 或 error，而非 `NEEDS_REVIEW`

### Requirement: 操作性失敗 SHALL NOT 被誤分類為 NEEDS_REVIEW

Quota suspension、timeout、runner crash、unreadable output、malformed score、lock collision、stop request、writer infrastructure failure 與其他未產生符合 schema 內容失敗判定的 operational outcome SHALL 保留既有可恢復或 drain 語意。Tribunal SHALL NOT 只因 `ALLOW_REWRITE=0`、`--only-stage`、`--score-only` 或 writer unavailable 就建立 `NEEDS_REVIEW`。

#### Scenario: Malformed judge output remains runner error

- **WHEN** judge 沒有產生符合 schema 的分數或 runner 無法讀取結果
- **THEN** 文章 SHALL 使用既有 `RUNNER_ERROR` 或對應 operational outcome
- **AND** SHALL NOT 寫入內容型 `NEEDS_REVIEW`
- **AND** SHALL NOT 增加頂層內容嘗試次數

#### Scenario: Non-GP judge-only run fails

- **WHEN** non-GP 文章以 `--only-stage` 或其他 judge-only mode 得到有效失敗判定
- **THEN** runner SHALL 保留既有 bounded/manual failure 語意
- **AND** SHALL NOT 套用 GP source-preservation 的 `NEEDS_REVIEW` reason

#### Scenario: Non-GP rewrite path remains bounded

- **WHEN** non-GP 文章的 policy 允許 writer 修復且 judge 回報有效失敗判定
- **THEN** Tribunal SHALL 繼續使用既有 bounded rewrite、rejudge 與頂層嘗試 contract
- **AND** 此變更 SHALL NOT 提前把該文章終止為 `NEEDS_REVIEW`

### Requirement: NEEDS_REVIEW SHALL 可觀測且不得發布

Canonical scheduler、publisher status 與 monitor snapshot SHALL 把現行 Tribunal 版本的 `NEEDS_REVIEW` 與 `FAILED`、`EXHAUSTED`、`RUNNER_ERROR` 分開呈現。發布器 SHALL 讀取現行 Tribunal 版本，且只選文章層級 status=`PASS`、儲存的 Tribunal 版本不舊於現行版本的項目；任何現存 PASS 階段或舊 PASS metadata 都不得覆蓋文章層級 `NEEDS_REVIEW`。

#### Scenario: Supervisor receives NEEDS_REVIEW exit code

- **WHEN** per-article runner 以 exit code `3` 回報 `NEEDS_REVIEW`
- **THEN** supervisor SHALL 記錄文章與 manual-review outcome
- **AND** SHALL 繼續處理其他安全文章
- **AND** SHALL NOT 把 exit code `3` 計為 PASS、generic failure 或要求全域 drain 的 runner error

#### Scenario: Publisher sees stale PASS evidence and current NEEDS_REVIEW

- **WHEN** progress ledger 的現行文章層級 status 是 `NEEDS_REVIEW`，但文章仍含舊 PASS 階段或分數 metadata
- **THEN** publisher SHALL NOT 建立 publish candidate、branch、commit 或 PR
- **AND** status output SHALL 將該文章計入獨立的 `NEEDS_REVIEW` 數量

#### Scenario: 發布器看到舊版文章層級 PASS

- **WHEN** progress ledger 的文章層級 status 是 `PASS`，但儲存的 Tribunal 版本低於現行 Tribunal 版本
- **THEN** publisher SHALL NOT 建立 publish candidate、branch、commit 或 PR
- **AND** SHALL 將該文章留給現行 Tribunal 版本重新處理

#### Scenario: Operator inspects monitor snapshot

- **WHEN** runtime ledger 含有一筆或多筆 `NEEDS_REVIEW`
- **THEN** monitor snapshot SHALL 顯示 distinct count
- **AND** 近期終態項目 SHALL 包含文章、失敗階段、終態原因與 timestamp，不得輸出 source content 或 secret
