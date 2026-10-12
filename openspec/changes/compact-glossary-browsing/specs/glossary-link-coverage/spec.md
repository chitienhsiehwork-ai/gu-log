## ADDED Requirements

### Requirement: Glossary 錨點 SHALL 由單一規則推導

詞條的錨點 SHALL 由同一套規則決定：有設定 `linking.anchor` 就用它，否則由 canonical `term` 推導。頁面上的詞條 id、`related` 連結、檢查器預期的連結、修正器寫出的連結與 Librarian 的連結建議 SHALL 都使用這套規則的結果。任何詞條推出空錨點，或兩個詞條推出相同錨點時，測試 SHALL 失敗並指出詞條。

#### Scenario: 名稱含標點的詞條

- **WHEN** 詞條的 canonical `term` 含有標點，例如 `Software 3.0`
- **THEN** 頁面 id、檢查器預期的錨點與修正器寫出的錨點 SHALL 完全相同

#### Scenario: 推不出錨點的詞條

- **WHEN** 新增一個 canonical `term` 只有中文、也沒設 `linking.anchor` 的詞條
- **THEN** 測試 SHALL 失敗，並指出這個詞條需要 `linking.anchor`

### Requirement: Glossary 連結 SHALL 指向存在的錨點與文章的語言

文章裡的 glossary 連結 SHALL 指向詞彙表上存在的錨點，停用自動連結的詞條也算存在；大小寫不符視為不存在。繁中文章 SHALL 連 `/glossary#…`，英文文章 SHALL 連 `/en/glossary#…`。詞條的 `related` SHALL 只列出存在的詞條。違反時，glossary 檢查 SHALL 以非零狀態結束，並列出檔案與錨點，或詞條與找不到的名稱。

#### Scenario: 文章連到不存在的錨點

- **WHEN** 文章含有 `/glossary#Opus` 這類沒有對應詞條、或大小寫不符的 glossary 連結
- **THEN** glossary 檢查 SHALL 以非零狀態結束，並列出檔案與錨點

#### Scenario: 英文文章連到繁中詞彙表

- **WHEN** 英文文章含有指向 `/glossary#…` 的連結
- **THEN** glossary 檢查 SHALL 以非零狀態結束，並列出檔案與錨點

#### Scenario: 連到停用自動連結的詞條

- **WHEN** 文章連到 `/glossary#thread`，而 Thread 詞條停用了自動連結
- **THEN** 這條連結 SHALL NOT 被當成死錨點

#### Scenario: related 指向不存在的詞條

- **WHEN** 某個詞條的 `related` 列出 glossary 裡沒有的詞條
- **THEN** glossary 檢查 SHALL 失敗，並指出這個詞條與找不到的名稱

### Requirement: 只改 glossary 連結的修改 SHALL 可機械證明並略過內容品質 gate

既有文章的修改若只新增、移除或改正 glossary 連結，pre-commit 與 PR content gate SHALL 用同一套證明放行，略過分數、代名詞、AI 腔與晶晶體等內容品質 gate。證明先驗證、再剝掉連結：新增或改動的每個連結 SHALL 指向該文章語言、啟用中詞條的正確錨點，位在 glossary 檢查器認定可以放連結的區域；新包起來的文字 SHALL 是檢查器會認成該詞條的寫法，只改錨點的既有連結保留原文字。驗證不過的連結 SHALL NOT 被剝掉。剝掉驗證過的連結後，整份檔案（含 frontmatter）SHALL 與修改前逐字相同，否則證明失敗，文章照常接受內容品質 gate。

#### Scenario: 新詞條替舊文補連結

- **WHEN** 一篇沒有 scores 的既有繁中文章，唯一變更是把一處 `Kubernetes` 改成 `[Kubernetes](/glossary#kubernetes)`
- **THEN** pre-commit 與 PR content gate SHALL 都放行，不要求重跑 Tribunal

#### Scenario: 只改正錨點

- **WHEN** 既有連結 `[glossary 有完整拆解](/glossary#Codex)` 改成指向正確的小寫錨點，文字不變
- **THEN** 證明 SHALL 放行

#### Scenario: 補連結時夾帶改字

- **WHEN** 修改除了 glossary 連結，還改了其他讀者可見文字或 frontmatter
- **THEN** 證明 SHALL 失敗，文章 SHALL 照常接受內容品質 gate

#### Scenario: 連到錯的錨點

- **WHEN** 新加的連結指向不存在的錨點、停用的詞條，或另一種語言的詞彙表路徑
- **THEN** 證明 SHALL 失敗，即使同一個修改裡也有一條合法的站內文章連結

#### Scenario: 連結包在 code 區塊裡

- **WHEN** 新加的 glossary 連結位在 code block、inline code、frontmatter 或 JSX 屬性裡
- **THEN** 證明 SHALL 失敗

#### Scenario: 新連結的文字不是詞條的寫法

- **WHEN** 新加的連結是 `[這裡](/glossary#kubernetes)`
- **THEN** 證明 SHALL 失敗
