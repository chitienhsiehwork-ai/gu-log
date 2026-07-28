## Context

Tribunal VM 的正式 Tribunal 已有部署版嚴格模式、Codex 評審執行器、Codex 寫手執行器、寫手前置檢查與額度控制器，但目前的供應端邊界並不一致：VibeScorer 與寫手前置檢查仍需要 Claude，service wrapper 也會讀 Claude token；額度路徑還可能啟動合併或 Claude 探測。結果是 Codex 評審與隔離 Codex 寫手都可用時，daemon 仍可能在領取文章前因無關的 Claude 憑證或卡住的 Claude 額度探測失敗。

這是跨 Tribunal 解析器、寫手沙箱、額度控制器、systemd wrapper、監看與 runbook 的正式環境合約變更。安全底線不變：部署版執行環境必須在領取文章前封閉失敗，寫手只能修改專用候選工作區，實際 provider／model 必須可追溯。

## Goals / Non-Goals

**Goals:**

- Tribunal VM 部署版嚴格模式的 VibeScorer、FactChecker、Librarian、FreshEyes 與 tribunal-writer 全部使用 Codex。
- 每個角色從自己的 `.codex/agents/<role>.toml` 解析 model，並在既有進度／分數／log 來源邊界記錄實際 provider／model。
- 正式 service 與 wrapper 不讀取、不匯出、不驗證任何 Claude token 或憑證。
- 寫手前置檢查使用有逾時的 Codex 寫入 canary，重用正式寫手專用的 `workspace-write` 沙箱與角色設定。
- 部署版額度控制器與額度錯誤探測只執行限定 Codex 供應端的 CodexBar JSON 指令。
- 非部署版的 CCC／舊版相容路徑可保留，但不能成為部署版啟動、派送或復原的依賴。

**Non-Goals:**

- 移除所有 Claude 相容 helper，或改變非部署版互動編排的預設行為。
- 改變 Tribunal 評分維度、門檻、評審 rubric、改寫次數或文章領取語意。
- 放寬 Codex 寫手的檔案系統、網路、approval 或 tmp 沙箱邊界。
- 導入新的額度供應端、憑證儲存或外部服務。

## Decisions

### 1. 部署版嚴格模式對五個正式角色只接受 Codex

`TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 維持部署版嚴格合約的單一開關。四位評審都由同一個可辨識角色的解析器回傳 Codex，並從各自 `.codex/agents/*.toml` 解析 model；寫手則由 `GP_WRITER_MODE=codex` 使用同一套 Codex 角色 model 解析器。任何缺少 Codex binary、缺少角色 TOML、TOML 無效或 model 無效的情況，都在領取文章前明確失敗。

`TRIBUNAL_FORCE_PROVIDER` 仍不得與嚴格模式並用。嚴格模式未啟用時，既有 Claude／CCC 備援與明示單次覆寫可保留，但來源紀錄必須寫實際 provider／model。

Codex 評審會讀入不可信的文章 prose，因此和寫手共用同一個
`workspace-write` 指令建構器：只有一次性評審 cwd 可寫，正式 repo 只能讀，
slash tmp／`TMPDIR` 自動寫入例外與網路都關閉，approval 為 `never`，並忽略
user config／rules。評審與寫手的 prompt／角色設定仍各自組裝，但不能各自
複製沙箱旗標。

替代方案是只把寫手換成 Codex、保留 VibeScorer=Claude。這仍會讓正式環境成功綁在 Claude 憑證上，無法滿足單一供應端邊界，因此不採用。

### 2. 寫手前置檢查必須走正式 Codex 寫手執行器的寫入 canary

前置檢查建立私有專用 canary 工作區，使用 `tribunal-writer` TOML model 與正式 `tribunal_codex_writer_exec` 指令建構器，要求 model 在工作區內寫入固定 sentinel；parent 驗證檔案內容完全相符後才放行。整個探測受 `TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC` 限制，結束後清理工作區。

這會實際覆蓋正式寫手最重要的能力與限制：候選 cwd 是唯一可寫 root、`workspace-write`、slash tmp 與 `TMPDIR` 自動寫入例外停用、無網路、web search 停用、approval never、ephemeral／嚴格 config。前置檢查不提供真文章，也不能寫正式 repo。

替代方案是讓 Codex 只在 stdout 回 `OK`。那只能驗證行程與 auth，無法驗證正式寫手的沙箱是否真的能在唯一允許的候選工作區寫檔，因此不採用。

### 3. Service 與 wrapper 完全移除 Claude 憑證啟動邏輯

受版控的 systemd unit 明示 `TRIBUNAL_DEPLOYED_MODE=1`、`TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 與 `GP_WRITER_MODE=codex`。wrapper 不再讀取 Claude token 檔、不再匯出 `CLAUDE_CODE_OAUTH_TOKEN`，doctor 與即時前置檢查也只檢查 Codex 合約。

替代方案是保留「有就讀、沒有也沒關係」的 token 邏輯。這會留下不必要的 secret 存取與回歸面，也無法用可執行合約證明正式環境不依賴 Claude，因此不採用。

### 4. 部署版額度只共享一條限定 Codex 供應端的 CodexBar JSON 路徑

額度控制器與 model 額度錯誤處理器共用一個有逾時、可測試注入的探測，正式指令固定為：

```bash
codexbar usage --provider codex --source cli --format json --pretty
```

消費端只解析這份 Codex JSON。CodexBar 目前可能把 CLI record 的 `source` 正規化成 `codex-cli`，也可能以明確的 `usage.primary: null` 表示短窗未啟用；這兩種 live schema 都不是缺額度。Parser 只在唯一 Codex record、有效 weekly `secondary` 視窗與明確 null primary 的組合下，把短窗記成不參與 burn-rate 運算，不會憑空補 reset 或剩餘額度。指令失敗、逾時、JSON 格式錯誤、缺少 primary key、非 null 的 malformed primary，或缺少必要 weekly 欄位時，依既有封閉失敗／可觀測備援合約處理，不得再呼叫沒有 `--provider codex` 的合併探測，也不得嘗試 Claude 額度路徑。部署版 service 不再以合併 `USAGE_MONITOR` 成功作為健康條件。

替代方案是呼叫合併 JSON 後只挑 OpenAI entry。該行程仍會初始化 Claude 供應端，曾在 Claude PTY 半段卡住，所以即使 parser 忽略 Claude 也沒有隔離供應端副作用，不採用。

### 5. 相容備援留在部署邊界之外

非部署版模式可繼續支援 `none`、`subagent`、舊版 `cli` 寫手與 Codex 不存在時的 CCC 評審備援。所有相容 branch 都必須由嚴格／部署 gate 隔開；即使 `claude` 不在 `PATH` 且所有 Claude 憑證都不存在，Tribunal VM 的啟動、doctor、派送、改寫、額度處理與復原仍須成功，且不得檢查、呼叫或驗證這些相容 branch。

替代方案是一次刪除相容 code。這會不必要地擴大變更，並破壞 CCC／本機互動流程；目前只需用可執行合約防止相容路徑回流正式環境。

### 6. 執行描述只解析一次

每次評審／寫手派送先解析不可變的 provider／model／reasoning 描述，再把
同一份值同時傳給執行器與來源寫入器。執行中的 TOML 或環境 reasoning
變更不得讓實際 argv 與
`provider`／`model_id`／`runner_label` 分裂。

替代方案是執行成功後重讀 TOML。這會把中途更新後的 model 錯記成實際
執行 model，破壞稽核來源，因此不採用。

### 7. 部署版 Codex 呼叫使用暫態 systemd service

共用沙箱指令建構器在部署版模式以 parent-generated unit name 建立暫態
`.service`，設定 `KillMode=control-group`、`SendSIGKILL=yes`、有界執行時間
與每次呼叫的 Memory／CPU／Tasks 上限。Idle watchdog 只以 parent-held unit
identity 呼叫 `systemctl stop`；不得對可重用的 numeric PGID 發 signal。
非部署版相容路徑維持既有 process-group cleanup。

Supervisor、build workers 與暫態 Codex services 全部放進受版控的
`tribunal-runtime.slice`，總體上限維持既有 4G／200%，autoscaler 改讀該
slice，避免暫態 sibling cgroup 的 RSS 從觀測與總上限消失。啟動時若缺
Linux、user systemd manager、已載入 slice 或必要工具，會在領取文章前
封閉失敗。

替代方案是只保留 PGID cleanup。`setsid()` 可逃離 process group，且
TERM→KILL 間的數字可能被重用，不能作正式環境資源邊界。

### 8. 雙語 CAS 使用耐久 crash journal

候選套用在第一次交換前寫入 mode-0600、檔案與父目錄皆 fsync 的 journal，
綁定正式檔／暫存檔 identity、bytes 與 mode。復原流程可重入辨識 baseline、
候選或混合狀態；未知／人工編輯／symlink／FIFO／超過有界掃描一律保留
證據並封閉失敗。

部署版啟動先復原 main checkout；多 worker 模式則在任何破壞性 worktree
同步前逐一復原現有 worker。這避免 SIGKILL／OOM／host crash 把 zh-tw 與
EN 留在不同版本，也避免同步先抹掉復原證據。

## Risks / Trade-offs

- [風險] VibeScorer 從 Claude 換到 Codex 後，分數校準可能有可見差異 → 保留既有 Vibe rubric 作為角色內容，model selector 由 TOML 控制，並完整記錄 provider／model 來源供後續比較。
- [風險] 寫入 canary 每次 service 啟動會增加少量延遲與 Codex 額度 → 探測只在啟動或 operator 明示即時 doctor 時執行，設定有界逾時；日常 doctor 讀取與目前 service PID 綁定的前置檢查狀態。
- [風險] 前置檢查與正式寫手的指令建構器之後可能漂移 → 兩者必須呼叫同一執行器／沙箱建構器，測試斷言正式沙箱旗標與唯一可寫工作區。
- [風險] CodexBar JSON schema 或指令行為變更會使控制器無資料 → schema 驗證封閉失敗，進入既有可觀測備援／警報，不得猜值或改查 Claude。
- [風險] 舊版 helper 仍存在，未來可能被誤接回部署路徑 → 嚴格供應端、service、doctor 與額度回歸測試都加入反向斷言，明確禁止 Claude binary、token 與合併額度指令。
- [風險] 暫態 services 成為 supervisor 的 sibling cgroup，原 autoscaler 可能漏算 Codex RSS → 受版控的共用 slice 同時承載兩者，以每次呼叫與總體上限做雙層限制。
- [風險] crash journal 遇到未知人工編輯會阻擋啟動 → 這是保護正式內容的刻意封閉失敗；保留 journal／暫存證據供 operator 判讀，不猜測覆寫。

## Migration Plan

1. 先加入嚴格路由、寫手 canary、Claude 憑證反向斷言與限定供應端額度指令的回歸測試。
2. 更新角色解析器、寫手前置檢查與額度探測，使測試通過；保留非部署版相容 branches。
3. 更新 systemd unit／共用 slice、wrapper、監看／doctor 與 runbook，移除部署版 Claude token／合併監看的前置需求。
4. 加入不可變描述、暫態 cgroup setsid 清理與 SIGKILL crash-journal 回歸。
5. 跑 shell／Vitest 合約 suites，確認前置檢查在領取文章前封閉失敗、五個角色來源與精確 CodexBar argv。
6. 在 Tribunal VM 同步受版控 unit，`daemon-reload` 後 restart；以 doctor、監看、journal 與一篇有界文章 smoke 驗證只用 Codex 的路徑。

回復採整體 revert 到前一個已知可用 release 與其匹配的受版控 systemd unit，再 `daemon-reload`／restart；不得只在新版本的嚴格模式內偷切 Claude 備援。回復後的供應端合約必須如實顯示為舊版，不得宣稱只用 Codex。

## Open Questions

無。五個正式角色的供應端、寫手沙箱、憑證邊界、額度指令與相容邊界皆已由 owner 決定。
