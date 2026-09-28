## MODIFIED Requirements

### Requirement: 候選預審 SHALL 僅供審閱且限制副作用

系統 SHALL 提供明確的 `gp-pipeline candidate <youtube-url>` 預審入口，只接受單一 YouTube 影片，並只在解析後位於 repo 外的工作目錄建立來源證據與有版本的 `candidate-manifest.json`。該入口 SHALL NOT 呼叫任何 LLM、編輯或發布階段，SHALL NOT 建立 MDX、配置票號、修改計數器、Git 索引、Git 歷史或 `src/content/posts/`，也 SHALL NOT 將預審成功視為 ShroomDog 核准。只有另一次明確執行標準 `gp-pipeline run <youtube-url> --prefix <系列>`，才能進入正式寫作與發布。

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

- **WHEN** 操作者對 YouTube URL 執行 canonical `gp-pipeline run <youtube-url> --prefix <系列>`，但執行環境找不到 `yt-dlp`
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

### Requirement: 操作者診斷 SHALL 揭露 YouTube 能力且不破壞無關流程

Doctor 與 agent-facing help SHALL 明示 YouTube 候選預審依賴 `yt-dlp`，也 SHALL 說明預審與正式 run 的副作用分界。`yt-dlp` 缺失 SHALL 使 YouTube 能力顯示不可用，但 SHALL NOT 單獨使不使用 YouTube 的整體 doctor 健康狀態失敗。ShroomDog 直接交付 URL 的既有可信 owner 完整 run 路由 SHALL 保持不變；只有明確使用候選預審指令才進預審，而兩條路的 YouTube fetch 都不得 fallback 到 generic HTML。

#### Scenario: Doctor 找不到 yt-dlp

- **WHEN** 操作者在沒有 `yt-dlp` 的環境執行 doctor
- **THEN** 人類可讀與 JSON 報告 SHALL 顯示 YouTube 候選預審能力不可用
- **AND** 若其他 required dependencies 健康，doctor 整體 SHALL 仍可成功

#### Scenario: 操作者閱讀候選預審 help

- **WHEN** 操作者執行 `gp-pipeline candidate --help`
- **THEN** help SHALL 清楚列出輸出產物、YouTube 相依工具、僅供審閱邊界與不會執行的異動階段
- **AND** SHALL 指示核准後另行執行標準 `gp-pipeline run <url> --prefix <系列>`
