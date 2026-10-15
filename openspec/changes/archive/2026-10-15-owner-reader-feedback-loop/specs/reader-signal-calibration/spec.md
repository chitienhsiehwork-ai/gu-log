# Spec Delta

## Purpose

定義如何用 owner 的真實閱讀訊號檢驗 Tribunal 分數是否預測得到 ShroomDog 想不想讀，並限制這份報告在證據不足時的解讀方式。

## ADDED Requirements

### Requirement: A calibration report SHALL compare Tribunal scores with owner signals

系統 SHALL 提供一個可重跑的報告，輸入是 human-signal 事件（匯出檔或後端匯出），輸出 owner 訊號與 Tribunal 分數的對照。只有 reader revision 與文章目前 reader revision 相符的事件 SHALL 計入「目前版本」；不相符的 SHALL 分開列為舊版本訊號。

#### Scenario: Owner said an AI-passed article needs a rewrite

- **WHEN** 某篇文章的 Tribunal 分數達到 PASS
- **AND** owner 對目前 reader revision 留下 `rewrite_needed` 或負面回饋
- **THEN** 報告 SHALL 把這篇列在「分歧」區，附文章、分數與回饋時間

#### Scenario: Signal targets an older revision

- **WHEN** 事件的 reader revision 與文章目前 reader revision 不同
- **THEN** 報告 SHALL NOT 把它當成目前版本的證據
- **AND** SHALL 在舊版本區列出

#### Scenario: Events without reader revision

- **WHEN** 事件沒有 reader revision（舊資料）
- **THEN** 報告 SHALL 把它列為版本不明，不計入目前版本的統計

### Requirement: The report SHALL state its sample size and signal strength

報告 SHALL 分開統計明確回饋（一鍵回饋、手動標記已讀、分享完成）與隱性訊號（自動讀完、疑似中途離開），並 SHALL 在每個統計旁標示樣本數。樣本數低於報告設定的最低門檻時，報告 SHALL 標示「樣本不足」而不給相關性結論。

#### Scenario: Too few owner signals

- **WHEN** 目前版本的 owner 明確回饋少於門檻
- **THEN** 報告 SHALL 顯示樣本不足
- **AND** SHALL NOT 輸出「Tribunal 分數與 owner 反應相關／不相關」的結論

### Requirement: The report SHALL NOT mutate content or Tribunal state

校準報告 SHALL 是唯讀的：SHALL NOT 修改文章、frontmatter 分數、Tribunal progress ledger 或 requeue 狀態。

#### Scenario: Report finds disagreements

- **WHEN** 報告找到分歧文章
- **THEN** 報告 SHALL 只輸出清單
- **AND** SHALL NOT 觸發重寫、requeue 或擋發布
