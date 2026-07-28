## MODIFIED Requirements

### Requirement: Tribunal SHALL 依評審決定執行供應端與角色設定中的 model

正式 Tribunal runner SHALL 逐一依評審解析執行供應端與 model：

- **VibeScorer、Librarian、FactChecker、FreshEyes** 在部署嚴格模式 SHALL 全部透過 Codex 執行，model SHALL 來自各自對應的 `.codex/agents/<role>.toml`。
- Provider／model 解析 SHALL 集中在能辨識 agent 身份的 helper，不得在 router 寫死 model 版本。
- 部署嚴格模式的 Codex 評審 SHALL 將文章視為不可信輸入，並在只有一次性評審工作區可寫、正式 repo 唯讀、無網路、無 slash tmp／`TMPDIR` 自動寫入例外、approval `never` 的 `workspace-write` 沙箱執行；評審與寫手 SHALL 共用同一個沙箱指令建構器。
- 每次部署版 Codex 評審／寫手／canary 呼叫 SHALL 使用 parent-generated identity 的暫態 systemd service；unit SHALL 以 control-group 回收所有後代行程，並與 supervisor 共用受版控的總體資源 slice。
- Provider／model／reasoning SHALL 在派送前解析一次；執行參數、來源與 runner label SHALL 使用同一份不可變描述，不得在成功後重讀角色設定或環境 reasoning。
- `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` SHALL 是部署嚴格模式的唯一開關。未設定時 MAY 保留 Codex 不可用時的 CCC 相容備援，但進度與分數來源 SHALL 記錄實際 provider／model。
- `TRIBUNAL_FORCE_PROVIDER` 與 `GP_CODEX_MODEL` MAY 作為明示的單次執行覆寫；覆寫 SHALL 記錄實際來源。`TRIBUNAL_FORCE_PROVIDER` 與部署嚴格模式 SHALL NOT 同時啟用。

#### Scenario: 在部署嚴格模式跑完整 Tribunal

- **WHEN** operator 設定 `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 執行正式 Tribunal runner
- **THEN** VibeScorer / Librarian / FactChecker / FreshEyes SHALL 全部透過 Codex 與各自 TOML 宣告的 model 執行
- **AND** frontmatter、進度紀錄與 stage log SHALL 誠實記錄各階段的實際 Codex provider/model

#### Scenario: 不可信文章不能取得 judge 主機權限

- **WHEN** 部署嚴格模式把文章 prose 交給任一 Codex judge
- **THEN** judge SHALL 在 disposable `workspace-write` sandbox 執行
- **AND** canonical repo SHALL 只能讀，只有 judge workspace 可寫
- **AND** slash tmp、`TMPDIR` 自動寫入、網路、user config、user rules 與互動 approval SHALL 全部停用
- **AND** judge SHALL NOT 使用 `danger-full-access`

#### Scenario: Model 行程以 setsid 離開原 process group

- **WHEN** 部署版 Codex 評審或寫手的後代行程呼叫 `setsid()`，並在 main process 結束後繼續執行
- **THEN** 暫態 service SHALL 以 `KillMode=control-group` 回收該後代行程
- **AND** watchdog SHALL 以 parent-held unit identity 取消停滯呼叫
- **AND** SHALL NOT 備援到 numeric PGID cleanup

#### Scenario: 部署版角色共用一個總體資源邊界

- **WHEN** 部署版 supervisor、worker／build 子行程與暫態 Codex 呼叫同時執行
- **THEN** 它們 SHALL 全部隸屬 tracked `tribunal-runtime.slice`
- **AND** autoscaler SHALL 從該 slice 讀取 aggregate MemoryCurrent／MemoryMax
- **AND** 每個 transient Codex service SHALL 另有更窄的 Memory／CPU／Tasks limits

#### Scenario: 部署版 cgroup 前置條件無法使用

- **WHEN** host 不是 Linux、user systemd manager 無法連線、必要的 `systemd-run`／`systemctl` 不存在，或 tracked resource slice 未載入
- **THEN** startup SHALL 在 article claim 前明確失敗
- **AND** SHALL NOT 備援到 PGID cleanup 或相容供應端

#### Scenario: 角色設定在執行中改變

- **WHEN** 評審或寫手已用 model A 派送，且角色 TOML 在呼叫完成前改成 model B
- **THEN** executor argv、provenance 與 runner label SHALL 都使用 dispatch 時的 provider、model A 與 reasoning
- **AND** SHALL NOT 重讀 model B 或其他 ambient reasoning

#### Scenario: CCC 沙箱相容備援

- **WHEN** 部署嚴格模式未設定且 Codex 執行檔不在 PATH
- **THEN** 評審階段 MAY 備援到 Claude 並讀取各自 `.claude/agents/*.md` 的 model
- **AND** runner SHALL 在來源紀錄寫下實際 Claude provider/model
- **AND** 此備援 SHALL NOT 被視為部署版嚴格合約成功

#### Scenario: 部署嚴格模式缺少 Codex

- **WHEN** 部署嚴格模式啟用但 Codex 執行檔不可用
- **THEN** runner SHALL 在 article claim 前明確回報 provider contract 失敗
- **AND** SHALL NOT 靜默改用 Claude 或其他 provider

#### Scenario: Codex 角色設定無效

- **WHEN** 未設定 `GP_CODEX_MODEL` 覆寫，且任一 judge 的 Codex TOML 缺少或包含無效 model
- **THEN** Codex invocation SHALL 在 article claim 前明確失敗
- **AND** SHALL NOT 使用隱性預設 model 或對應 Claude role model

#### Scenario: 部署嚴格模式拒絕全域 provider 覆寫

- **WHEN** operator 同時設定 `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` 與 `TRIBUNAL_FORCE_PROVIDER`
- **THEN** 部署前置檢查 SHALL 在 article claim 前失敗
- **AND** SHALL 告知 operator 必須關閉部署嚴格模式才能執行覆寫實驗

#### Scenario: 相容模式明示全域 provider 覆寫

- **WHEN** 部署嚴格模式未設定且 operator 明示設定 `TRIBUNAL_FORCE_PROVIDER`
- **THEN** judge 階段 MAY 依覆寫使用同一 provider
- **AND** 實際 provider/model SHALL 寫入來源紀錄
