## ADDED Requirements

### Requirement: GP translator MUST receive canonical glossary terminology

GP source-translation runtime SHALL 在產生翻譯 prompt 前，從 glossary 資料讀取所有宣告 `forbiddenZhTw` 的項目，並只把標準 `term` 與對應禁用字串注入術語 context。翻譯者 SHALL 遵守該 context，且 SHALL NOT 在 prompt template 另存一份具體詞彙對照表。

術語 context SHALL 是 source translator 的版本化 prompt contract；其內容改變後，既有 role-profile fingerprint 與 publish-gate manifest SHALL 視為 stale。

#### Scenario: Agent rule reaches translator dispatch

- **WHEN** `Agent` glossary 項目宣告一個 `forbiddenZhTw` 譯名
- **AND** pipeline 產生 source translator prompt
- **THEN** 實際送給翻譯者的 prompt SHALL 同時包含標準用詞 `Agent` 與該禁用譯名
- **AND** SHALL 指示翻譯者使用標準用詞，而不是等發布檢查才發現違規

#### Scenario: prompt does not duplicate glossary data

- **WHEN** glossary 的標準用詞或 `forbiddenZhTw` 設定改變
- **THEN** 翻譯 prompt 的術語 context SHALL 由 runtime 資料重新產生
- **AND** source translator template SHALL NOT 需要同步修改具體詞彙清單

#### Scenario: terminology contract invalidates stale gate

- **WHEN** 注入翻譯者的術語 context 改變
- **THEN** role-profile fingerprint SHALL 改變
- **AND** pipeline SHALL NOT 沿用先前的 publish-gate PASS
