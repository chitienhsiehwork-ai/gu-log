## ADDED Requirements

### Requirement: 候選預審 SHALL 僅供審閱且限制副作用

系統 SHALL 提供明確的 `gp-pipeline candidate <youtube-url>` 預審入口，只接受單一 YouTube 影片，並只在解析後位於 repo 外的工作目錄建立來源證據與有版本的 `candidate-manifest.json`。該入口 SHALL NOT 呼叫任何 LLM、編輯或發布階段，SHALL NOT 建立 MDX、配置票號、修改計數器、Git 索引、Git 歷史或 `src/content/posts/`，也 SHALL NOT 將預審成功視為 ShroomDog 核准。只有另一次明確執行標準 `gp-pipeline run <youtube-url>`，才能進入正式寫作與發布。

#### Scenario: 完整來源只產生預審 artifacts

- **WHEN** 操作者對可完整擷取且沒有影片 ID 重複的單一 YouTube 影片執行 `gp-pipeline candidate <youtube-url>`
- **THEN** 系統 SHALL 在 repo 外的工作目錄產生來源證據與有效清單
- **AND** 清單 SHALL 將來源標成可供人工考慮，但 SHALL NOT 記成已核准或已進入寫作
- **AND** repo 的 HEAD／refs、Git index、所有 tracked 與既有 untracked 檔案的 path、內容、mode，以及 untracked set SHALL 與執行前完全相同

#### Scenario: 工作目錄指向 repo 內

- **WHEN** 候選預審的 `--work-dir` 是 repo root、repo 子目錄，或解析符號連結後落在 repo 內
- **THEN** 系統 SHALL 在擷取來源前拒絕執行
- **AND** SHALL NOT 在 repo 內建立任何候選預審產物
- **AND** 在尚未建立可確認安全的外部工作目錄時，系統 SHALL NOT 被要求產生 failure manifest，且 SHALL NOT 改寫其他 fallback 位置

#### Scenario: 預審不得進入 agentic pipeline

- **WHEN** 候選預審處理包含可能惡意提示文字的外部來源
- **THEN** 系統 SHALL 將內容視為純資料
- **AND** SHALL NOT 啟動 Eval、Write、Review、Refine、Credits、Ralph、Translate、Deploy 或任何 LLM 供應端

### Requirement: YouTube 擷取 SHALL 以可稽核的部分證據封閉失敗

系統 SHALL 只把允許清單內 YouTube 主機上可解析的單一影片 URL 路由到 YouTube 擷取，所有下載 SHALL 禁止播放清單展開。YouTube 擷取 SHALL 要求 `yt-dlp`，不得在相依工具缺失、字幕缺失或字幕失敗時改走通用 HTML 擷取。這個封閉失敗規則 SHALL 同時適用於 candidate 與 canonical `run <youtube-url>`。Metadata 成功後即使字幕逐字稿不可用，系統仍 SHALL 保留真實 metadata 與穩定的可用性／失敗狀態；缺失欄位 SHALL 保持 null，不得用今天日期、暫代標題或其他推測值補齊。

#### Scenario: 缺少 yt-dlp

- **WHEN** 候選預審收到有效的單一 YouTube 影片 URL，但執行環境找不到 `yt-dlp`
- **THEN** 系統 SHALL 封閉失敗並原子產生 `dependency_missing` 清單
- **AND** SHALL NOT 呼叫通用文章擷取器
- **AND** 清單 SHALL 將該來源標成不可進入寫作，且可在安裝相依工具後重試

#### Scenario: 正式 run 缺少 yt-dlp

- **WHEN** 操作者對 YouTube URL 執行 canonical `gp-pipeline run <youtube-url>`，但執行環境找不到 `yt-dlp`
- **THEN** 共用來源路由 SHALL 封閉失敗
- **AND** SHALL NOT 呼叫通用 HTML 擷取器或讓 JS shell 進入正式寫作

#### Scenario: URL 不是單一影片

- **WHEN** YouTube URL 只指向播放清單、頻道、搜尋、重新導向、直播集合，含使用者資訊，或主機不在允許清單
- **THEN** 系統 SHALL 在啟動 `yt-dlp` 前拒絕 URL
- **AND** 若已建立安全外部工作目錄，清單 SHALL 記錄 raw input URL 與穩定的無效來源失敗碼，canonical URL／video ID SHALL 為 null

#### Scenario: Metadata 可用但沒有可用字幕逐字稿

- **WHEN** `yt-dlp` 成功回傳部分或完整 metadata，但沒有字幕、字幕過短、字幕超出安全上限，或影片正在直播／尚未開播
- **THEN** 系統 SHALL 產生清單並保留所有已觀察到的 metadata
- **AND** SHALL 以明確可用性與警告說明字幕逐字稿為何不可用
- **AND** SHALL 將 `writeEligible` 設為 false，且不得產生摘要、大綱或文章

#### Scenario: Metadata 缺欄位

- **WHEN** YouTube metadata 缺少 upload date、title、channel 或 duration
- **THEN** 清單對應欄位 SHALL 是 null
- **AND** 來源證據 SHALL NOT 將推測值表述為來源事實

### Requirement: 字幕來源與處理上限 SHALL 明確

YouTube 擷取 SHALL 優先選人工字幕，再選自動字幕；每層 SHALL 以固定語言順位選擇單一字幕軌。清單 SHALL 記錄實際語言、人工／自動類型、片長、原始位元組、估算 token、限制與警告，並引用原始 VTT 與保留時間戳的可讀字幕逐字稿之相對路徑和 SHA-256。片長關卡 SHALL 在字幕下載前套用，原始位元組關卡 SHALL 在 VTT 讀取／解析前套用，token 關卡 SHALL 在有界解析後、任何 LLM 或進一步內容處理前套用；超限 SHALL NOT 自動分段或進入寫作。

#### Scenario: 人工與自動字幕同時存在

- **WHEN** 同一影片同時提供符合條件的人工與自動字幕軌
- **THEN** 系統 SHALL 以固定規則選擇人工字幕軌
- **AND** 清單 SHALL 記錄實際語言與 `manual` 來源類型

#### Scenario: 只有自動字幕

- **WHEN** 沒有可用人工字幕軌，但有符合條件的自動字幕軌
- **THEN** 系統 SHALL 選擇該自動字幕軌
- **AND** 清單 SHALL 記錄實際語言與 `automatic` 來源類型

#### Scenario: 字幕逐字稿超出安全上限

- **WHEN** 片長、原始位元組或估算 token 任一在其對應階段超出集中定義的候選預審上限
- **THEN** 系統 SHALL 在對應關卡停止，不呼叫 LLM，也不自動分段
- **AND** 清單 SHALL 記錄觸發的限制、觀察值並將 `writeEligible` 設為 false

### Requirement: 候選清單 SHALL 原子、可重現且連結證據

系統 SHALL 以有版本的 JSON schema 原子寫入 `candidate-manifest.json`，並以它作為所有來源證據的唯一入口／索引產物。清單 SHALL 包含 raw input URL、可為 null 的標準化 URL／影片 ID、來源種類、可為 null 的 metadata、可用性、`writeEligible`、警告、產物相對路徑／SHA-256、影片 ID 防重複結論／相符項目，以及失敗時的穩定代碼與是否可重試。相同影片 ID 與來源產物雜湊的重跑 SHALL 產生等價的證據欄位；URL、影片 ID 或雜湊不同時 SHALL NOT 靜默復用舊產物。

#### Scenario: Candidate 成功

- **WHEN** 來源擷取完整且影片 ID 防重複結果沒有 BLOCK
- **THEN** 清單 SHALL 以目前 schema 版本完整連結來源證據與雜湊
- **AND** `writeEligible` SHALL 為 true，但仍 SHALL 要求人類另行決定是否執行正式 run

#### Scenario: 跨 URL 形式的影片 ID 防重複阻擋

- **WHEN** candidate 使用 watch、shorts 或 `youtu.be` 其中一種 URL，而既有文章 frontmatter 的 `sourceUrl` 使用另一種 URL 指向相同 YouTube video ID
- **THEN** 固定規則的防重複關卡 SHALL 回傳 BLOCK
- **AND** 清單 SHALL 記錄 BLOCK 結論與相符項目
- **AND** `writeEligible` SHALL 為 false
- **AND** 候選預審指令 SHALL NOT 啟動標題相似度或任何 LLM 判斷來覆寫結果

#### Scenario: 擷取 timeout 或中斷

- **WHEN** 擷取逾時、收到 SIGTERM，或在工作目錄建立後發生可分類的擷取錯誤
- **THEN** 系統 SHALL 盡量原子產生失敗清單，記錄穩定代碼、是否可重試、標準化 URL 與已完成產物雜湊
- **AND** SHALL NOT 留下宣稱成功的半份清單

#### Scenario: 工作目錄有過期產物

- **WHEN** 既有候選預審產物的標準化 URL、影片 ID 或來源雜湊與本次輸入不一致
- **THEN** 系統 SHALL 拒絕靜默復用
- **AND** SHALL 產生可行動的過期產物錯誤，或在隔離位置重新擷取

### Requirement: CLI 結束狀態 SHALL 與 manifest 決策分工

Candidate 完整跑完且留下可審閱結果時 SHALL 回傳 0，即使因無字幕、過短、超限或 live／upcoming 而使 `writeEligible` 為 false；呼叫端 SHALL 讀 manifest 判斷完整性。影片 ID 防重複 BLOCK SHALL 回傳 13，相依工具／擷取技術失敗 SHALL 回傳 10，輸入或工作目錄契約錯誤 SHALL 回傳 1，逾時 SHALL 回傳 124。除尚未建立可確認位於 repo 外且可寫的安全工作目錄外，非 0 結果 SHALL 盡量留下 failure manifest；不得為了留下 manifest 而改寫其他 fallback 位置。

#### Scenario: 不完整但可審閱的來源

- **WHEN** metadata 已取得，但字幕缺失、過短、超限或影片狀態不可寫
- **THEN** candidate SHALL 回傳 0 並留下 `writeEligible: false` manifest
- **AND** 呼叫端 SHALL NOT 把結束碼 0 解讀為已核准或可發布

#### Scenario: 防重複阻擋

- **WHEN** manifest 記錄相同 YouTube video ID 的 BLOCK verdict
- **THEN** candidate SHALL 回傳 13 並保留該 manifest

#### Scenario: 擷取技術失敗

- **WHEN** 缺少相依工具或 `yt-dlp` 發生技術擷取錯誤
- **THEN** candidate SHALL 回傳 10
- **AND** 在工作目錄可用時 SHALL 保留 stable failure manifest

### Requirement: 操作者診斷 SHALL 揭露 YouTube 能力且不破壞無關流程

Doctor 與 agent-facing help SHALL 明示 YouTube 候選預審依賴 `yt-dlp`，也 SHALL 說明預審與正式 run 的副作用分界。`yt-dlp` 缺失 SHALL 使 YouTube 能力顯示不可用，但 SHALL NOT 單獨使不使用 YouTube 的整體 doctor 健康狀態失敗。ShroomDog 直接交付 URL 的既有可信 owner 完整 run 路由 SHALL 保持不變；只有明確使用候選預審指令才進預審，而兩條路的 YouTube fetch 都不得 fallback 到 generic HTML。

#### Scenario: Doctor 找不到 yt-dlp

- **WHEN** 操作者在沒有 `yt-dlp` 的環境執行 doctor
- **THEN** 人類可讀與 JSON 報告 SHALL 顯示 YouTube 候選預審能力不可用
- **AND** 若其他 required dependencies 健康，doctor 整體 SHALL 仍可成功

#### Scenario: 操作者閱讀候選預審 help

- **WHEN** 操作者執行 `gp-pipeline candidate --help`
- **THEN** help SHALL 清楚列出輸出產物、YouTube 相依工具、僅供審閱邊界與不會執行的異動階段
- **AND** SHALL 指示核准後另行執行標準 `gp-pipeline run <url>`
