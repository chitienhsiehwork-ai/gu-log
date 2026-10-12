## ADDED Requirements

### Requirement: Glossary 錨點 SHALL 由單一規則推導

詞條的錨點 SHALL 由同一套規則決定：有設定 `linking.anchor` 就用它，否則由 canonical `term` 推導。頁面上的詞條 id、`related` 連結、檢查器預期的連結、修正器寫出的連結與 Librarian 的連結建議 SHALL 都使用這套規則的結果。文章或 `related` 指向不存在的 glossary 錨點時，glossary 檢查 SHALL 失敗，並指出檔案與錨點。

#### Scenario: 名稱含標點的詞條

- **WHEN** 詞條的 canonical `term` 含有標點，例如 `Software 3.0`
- **THEN** 頁面 id、檢查器預期的錨點與修正器寫出的錨點 SHALL 完全相同

#### Scenario: 文章連到不存在的錨點

- **WHEN** 文章含有 `/glossary#Opus` 這類沒有對應詞條、或大小寫不符的 glossary 連結
- **THEN** glossary 檢查 SHALL 以非零狀態結束，並列出檔案與錨點

#### Scenario: related 指向不存在的詞條

- **WHEN** 某個詞條的 `related` 列出 glossary 裡沒有的詞條
- **THEN** glossary 檢查 SHALL 失敗，並指出這個詞條與找不到的名稱

### Requirement: 只改 glossary 連結的修改 SHALL 可機械證明並略過內容品質 gate

既有文章的修改，若把修改前後的 glossary 連結語法都拿掉之後內容完全相同（只新增、移除或改正 glossary 連結），而且新增或改動的每個 glossary 連結都指向該文章語言、啟用中詞條的正確錨點，pre-commit 與 PR content gate SHALL 用同一套證明放行，略過分數、代名詞、AI 腔與晶晶體等內容品質 gate。其他任何讀者可見變更 SHALL 使證明失敗，文章 SHALL 照常接受內容品質 gate。Frontmatter 驗證、emoji、takedown 等非內容品質檢查 SHALL 照常執行。

#### Scenario: 新詞條替舊文補連結

- **WHEN** 一篇沒有 scores 的既有繁中文章，唯一變更是把一處 `Kubernetes` 改成 `[Kubernetes](/glossary#kubernetes)`
- **THEN** pre-commit 與 PR content gate SHALL 都放行，不要求重跑 Tribunal

#### Scenario: 補連結時夾帶改字

- **WHEN** staged 的修改除了 glossary 連結，還改了其他讀者可見文字
- **THEN** 證明 SHALL 失敗，文章 SHALL 照常接受內容品質 gate

#### Scenario: 連到錯的錨點

- **WHEN** 新加的連結指向不存在的錨點、停用的詞條，或另一種語言的詞彙表路徑
- **THEN** 證明 SHALL 失敗
