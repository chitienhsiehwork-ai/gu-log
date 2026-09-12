## ADDED Requirements

### Requirement: GP／MP FactChecker SHALL 取得 harness 驗證的完整 focal source

GP／MP 的 FactChecker 每次實際啟動前，harness SHALL 提供通過來源型別完整性驗證的完整 focal source 與 provenance manifest，SHALL NOT 要求 judge 自行連網擷取，亦 SHALL NOT 用 preview、摘要或記憶代替來源全文。其他系列 SHALL 繼續接受既有 FactChecker 評分，不因沒有 GP／MP focal source 而被跳過。

#### Scenario: 無網路 judge 收到完整 X 來源

- **WHEN** repo-owned adapter 從 X Article 或 self-thread fixture 擷取完整 focal body
- **THEN** network-disabled FactChecker SHALL 能從 harness 指定的資料檔讀到全文與全部 continuation
- **AND** manifest SHALL 記錄來源 identity、adapter provenance、完整性驗證、bytes 與 SHA-256
- **AND** 不得只提供 focal tweet 或 Article preview

#### Scenario: 一般網頁與 YouTube 保留來源型別契約

- **WHEN** focal URL 指向一般文章或受支援 YouTube 單影片
- **THEN** harness SHALL 使用既有 canonical adapter 與完整性 validator
- **AND** 一般頁面 SHALL 提供完整抽取內容，YouTube SHALL 提供既有契約要求的完整逐字稿
- **AND** YouTube 無字幕或不支援來源 SHALL NOT fallback 成 HTML shell

#### Scenario: GP 與 MP 仍按不同的 editorial contract 評分

- **WHEN** FactChecker 讀到 GP 或 MP 的完整 focal source
- **THEN** GP SHALL 按完整覆蓋、順序、speaker voice 與 source boundary 判定
- **AND** MP SHALL 按 retained-claim closure 與歸因判定，不因選材、重排或 Mogu voice 本身失敗

#### Scenario: 原創與教學文章沒有 claim-free 例外

- **WHEN** SD 或 Lv 文章進入 Tribunal
- **THEN** FactChecker SHALL 仍執行既有全部維度
- **AND** 不得因未套用 GP／MP focal-source preflight 而跳過 accuracy 或其他維度

### Requirement: Source acquisition SHALL 限於安全且有界的來源位置

自動 source acquisition SHALL 只連到公開 HTTP(S) 位置，驗證 requested source 與 observed identity，並限制總時間、redirect 次數及來源大小。來源 URL、回應或內文 SHALL NOT 擴張成任意內網存取、credential-bearing request 或連結爬取。

#### Scenario: Redirect 或 DNS 指向非公開位址

- **WHEN** 初始 URL、DNS resolution 或任一 redirect 指向 loopback、private、link-local、unspecified／保留位址或非 HTTP(S) scheme
- **THEN** fetch SHALL 在該連線前拒絕
- **AND** DNS 檢查 SHALL 綁定實際連線目的地，不得檢查後重新解析而繞過
- **AND** SHALL NOT fallback 到不受相同防護約束的 client

#### Scenario: 公開 redirect 可驗證完成

- **WHEN** 合法來源經過有界的公開 HTTP(S) redirect
- **THEN** harness SHALL 保留 requested 與 observed final source identity
- **AND** SHALL 保持 TLS 憑證與 hostname 驗證

#### Scenario: 來源 identity 不符或 URL 含憑證

- **WHEN** provider 回傳不同 X status／thread 或 YouTube video，或 URL 帶有 userinfo／credential-bearing input
- **THEN** harness SHALL 拒絕 packet
- **AND** SHALL NOT 把來源自己寫的 URL header 當成可信觀察來放行
- **AND** 診斷 SHALL NOT 輸出 credential 或敏感 URL 值

#### Scenario: 來源超限或不完整

- **WHEN** source 超過 executable bound，或包含截斷、incomplete thread、paywall、shell、teaser／unknown completeness 證據
- **THEN** harness SHALL 以明確 source-capture error 結束
- **AND** SHALL NOT 靜默截斷、摘要或用部分內容繼續評分

### Requirement: Source packet SHALL 維持資料與指令及可寫路徑的邊界

packet SHALL 使用 harness 選定的 private directory、regular data files 與完整性 manifest。judge SHALL 可讀全文，但來源文字 SHALL 僅是不可信 evidence，不得成為任務、rubric、工具或輸出路徑的指令。writer SHALL NOT 取得 packet 的可寫權限。

#### Scenario: 來源包含偽造指令

- **WHEN** source fixture 含 fake system message、closing delimiters、shell text 或要求改 score path 的文字
- **THEN** 這些 bytes SHALL 只存在來源資料檔，不被 shell 執行或插入 trusted instruction template
- **AND** judge 的原始輸出路徑、rubric 與網路權限 SHALL 不變

#### Scenario: 路徑或 hash 被竄改

- **WHEN** packet data 是 symlink、超出 private workdir、非 regular file，或 bytes／SHA-256 與 manifest 不符
- **THEN** harness SHALL 拒絕啟動 judge
- **AND** 若竄改發生於 judge 執行中，harness SHALL 拒絕採信該次結果
- **AND** SHALL NOT 寫入 authoritative PASS 或內容型 NEEDS_REVIEW

#### Scenario: 兩種 judge runtime 皆可讀取 packet

- **WHEN** canonical runner 使用 Codex 或 Claude judge runtime
- **THEN** 兩者 SHALL 能讀取同一完整 packet 內容
- **AND** source file SHALL 不在 writer candidate 的可寫集合

### Requirement: 來源失敗 SHALL 是可觀測的 operational error 且 packet SHALL 可重播

來源取得、完整性或 integrity 失敗 SHALL 在內容評分前清楚報告，不得被轉成文章品質 FAIL。一次 invocation 的重試 SHALL 使用同一 packet，顯式 replay SHALL 重新驗證資料完整性；系統 SHALL NOT 為此建立自動重抽或跨文章 source cache。

#### Scenario: Preflight 失敗不消耗內容嘗試

- **WHEN** source capture 失敗、輸出不合法、來源缺失或 manifest 驗證失敗
- **THEN** runner SHALL 以既有 RUNNER_ERROR／操作性 outcome 記錄穩定且去敏的 reason
- **AND** SHALL NOT 呼叫 FactChecker、偽造 score 或增加 top-level content attempts
- **AND** 尚未啟動的 stage attempts SHALL 為零

#### Scenario: 同一 invocation 重試不重新擷取

- **WHEN** FactChecker 因合法 bounded rewrite 或必要 rejudge 再次執行
- **THEN** harness SHALL 使用相同 source bytes 與 hash，不進行第二次網路 capture
- **AND** 該次 score evidence SHALL 記錄使用的 source hash

#### Scenario: 相同 packet 可以顯式重播

- **WHEN** harness 提供已存在且完整驗證通過的 packet 作顯式 replay
- **THEN** 相同文章與 packet SHALL 產生相同的來源 evidence surface，不依賴網路成功與否
- **AND** 只有非空檔案而無有效 manifest／identity／hash SHALL 不足以放行
- **AND** SHALL NOT 因 source refetch 自動解除同 revision 的 NEEDS_REVIEW
