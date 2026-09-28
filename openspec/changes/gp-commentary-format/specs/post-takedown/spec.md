## MODIFIED Requirements

### Requirement: 下架 SHALL 是保留原欄位、清空正文的文章狀態

文章 frontmatter 的 `status` SHALL 支援 `taken-down`，代表文章已下架。下架時 SHALL 保留原本的 frontmatter 欄位，只做以下改變：`status` 改成 `taken-down`；加上 `YYYY-MM-DD` 格式的 `takenDownAt`；沒有 `sourceTitle` 時補上來源自己的標題（來源沒有標題、或抓不到標題時，可用來源開頭一句或 `source`，但 SHALL NOT 使用 gu-log 自己的文章標題）；沒有 `author` 時可補上來源標示的作者或機構，查不到或不確定就不補，SHALL NOT 用猜的；`summary` 換成對應系列與語言的中性句；移除與新狀態不相容的 `deprecatedBy`、`deprecatedReason`、`retiredReason`、`retiredAt` 與來源距離章 `sourceDistance`；正文清空，只允許空白字元。

同一 `ticketId` 的繁中檔與英文檔 SHALL 一起下架，並 SHALL 使用相同的 `takenDownAt`、`sourceUrl` 與 `sourceTitle`。

`deprecated` 與 `retired` SHALL 維持「文章仍公開全文、加上狀態標籤」的既有語意；任何工具 SHALL NOT 把它們當成下架。

#### Scenario: 下架文章留有正文

- **WHEN** 一篇 `status: taken-down` 的文章在 frontmatter 之後還有任何非空白內容，包含 `import` 行
- **THEN** 驗證 SHALL 失敗
- **AND** pre-commit 與 CI SHALL 得到相同結果

#### Scenario: 下架文章的摘要不是中性句

- **WHEN** 一篇 `status: taken-down` 的文章，`summary` 不是它的系列與語言對應的中性句
- **THEN** 驗證 SHALL 失敗

#### Scenario: 下架文章缺少下架資料

- **WHEN** 一篇 `status: taken-down` 的文章缺少 `takenDownAt` 或 `sourceTitle`，或 `sourceTitle` 等於它的 `title`
- **THEN** 驗證 SHALL 失敗

#### Scenario: 翻譯配對只下架一邊

- **WHEN** 同一 `ticketId` 的繁中檔是 `taken-down`，英文檔不是，或兩邊的 `takenDownAt` 不同
- **THEN** 驗證 SHALL 失敗

#### Scenario: 貼標籤不等於下架

- **WHEN** 一篇文章是 `retired` 或 `deprecated`
- **THEN** 文章頁 SHALL 依既有規則顯示全文與狀態標籤
- **AND** 列表、API、Markdown 與下架檢查 SHALL NOT 把它視為已下架

#### Scenario: 下架文章留著來源距離章

- **WHEN** 一篇 `status: taken-down` 的文章還有 `sourceDistance`
- **THEN** 驗證 SHALL 失敗
- **AND** 下架工具 SHALL 在下架時移除這個欄位

### Requirement: 已下架的文章 SHALL 被 CI 棘輪鎖住

Pre-commit 與 CI SHALL 比較基準版本與新版本：基準版本已是 `taken-down` 的文章，新版本 SHALL 仍存在、仍是 `taken-down`，而且正文為空。新增的文章，以及新版本改了 `sourceUrl` 的既有文章，來源（正規化後的網址或推文 ID）與任一下架文章相同時，SHALL 視為來源已封鎖而失敗；唯一的例外是這篇文章帶有依 `source-distance-stamp` 驗證有效的來源距離章。`sources/` 底下新增 `sources/chatgpt/` 以外的檔案時 SHALL 失敗。

#### Scenario: 自動化把全文寫回下架文章

- **GIVEN** 一篇文章在基準版本是 `taken-down`
- **WHEN** 一個變更把它改回 `published`、寫入正文，或刪除它
- **THEN** pre-commit 與 CI SHALL 失敗

#### Scenario: 新文章使用已封鎖的來源

- **WHEN** 一個變更新增的文章，`sourceUrl` 與某篇下架文章相同，而且沒有有效的來源距離章
- **THEN** pre-commit 與 CI SHALL 失敗，並指出被封鎖的來源與下架文章

#### Scenario: 新增第三方原文擷取

- **WHEN** 一個變更在 `sources/` 底下新增 `sources/chatgpt/` 以外的檔案
- **THEN** pre-commit 與 CI SHALL 失敗

#### Scenario: 帶有效章的新導讀使用下架文章的來源

- **WHEN** 一個變更新增一篇 GP 導讀與它的英文版，`sourceUrl` 與某篇下架文章相同
- **AND** 兩個檔案都帶有效的來源距離章
- **THEN** 棘輪 SHALL NOT 因來源封鎖而失敗
- **AND** 那篇下架文章 SHALL 維持原狀

#### Scenario: 既有文章改用已封鎖的來源

- **WHEN** 一個變更把既有文章的 `sourceUrl` 改成某篇下架文章的來源，而這篇文章沒有有效的來源距離章
- **THEN** pre-commit 與 CI SHALL 失敗，並指出被封鎖的來源與下架文章

### Requirement: 自動化 SHALL 依狀態處理下架文章

把文章改成 `taken-down` SHALL NOT 需要 Tribunal 評分。Score floor 與其他以讀者可見內容變更為觸發條件的內容 gates SHALL 跳過下架文章；frontmatter 驗證與 emoji 檢查 SHALL 仍適用。Tribunal 的候選選取 SHALL 依 `status` 排除下架文章。Dedup SHALL 把下架文章視為來源已封鎖：新文章的來源與下架文章相同時 SHALL 被擋下。例外是 GP 候選：GP 必須帶有效的來源距離章才能發布（見 `source-distance-stamp`），所以 dedup 對 GP 候選 SHALL 回警告而不擋下，並說明新文章必須帶有效章，由棘輪在 commit 時把關；既有文章互比與主題相似度比對 SHALL NOT 把下架文章當成重複對象。

#### Scenario: 下架 commit 沒有分數

- **WHEN** 一個 commit 把文章改成 `taken-down`
- **THEN** pre-commit 與 CI 的內容 gates SHALL 放行
- **AND** frontmatter 驗證 SHALL 仍檢查下架欄位

#### Scenario: Tribunal 挑選文章

- **WHEN** Tribunal batch 或常駐 loop 列出待評文章
- **THEN** 下架文章 SHALL NOT 被選中

#### Scenario: 下架前是 deprecated 的文章

- **GIVEN** GP-35 下架前是 `deprecated`、`deprecatedBy` 指向 GP-105，兩篇都下架
- **WHEN** 既有文章的重複掃描執行
- **THEN** GP-35 與 GP-105 SHALL NOT 被判成重複

#### Scenario: Pipeline 用已下架的來源

- **WHEN** dedup gate 收到的非 GP 候選網址與某篇下架文章相同
- **THEN** gate SHALL 回 BLOCK，並說明來源已封鎖

#### Scenario: GP 導讀用下架文章的來源

- **WHEN** dedup gate 以 GP 系列收到的候選網址只跟下架文章相同
- **THEN** gate SHALL 回 WARN，並說明新的 GP 必須帶有效的來源距離章
- **AND** 候選網址若也跟任何公開文章相同，gate SHALL 照一般重複規則回 BLOCK

### Requirement: 下架批次 SHALL 依可重算的規則與 owner 授權執行

每一批下架 SHALL 有 owner 的明確授權紀錄，授權可以逐篇，也可以是規則。每一批 SHALL 在 repo 內留下規則檔，記錄授權人、日期、管道與範圍、規則本身，以及判斷後不下架的邊界案例與理由。下架清單 SHALL 由工具依規則從當下語料產生，不另存逐篇快照；清單中的 slug SHALL 使用正式網址的小寫形式。判斷不確定的文章 SHALL NOT 列入依規則下架的批次。依規則選文時 SHALL 只選 gu-log 首次發布日期（`translatedDate`）不晚於該批授權日的文章，讓授權之後重跑同一份規則時，也不會選中之後才發布的新文章。

各批的具體規則、網域清單與授權範圍 SHALL 只寫在該批的規則檔，spec 不複述。規則 SHALL 只依能機械判斷的欄位（例如系列、`sourceUrl` 的網域），SHALL NOT 依 `source` 這類自由文字欄位。

#### Scenario: 檔名含大寫

- **WHEN** 規則選中一篇檔名含大寫字母的文章，例如 GP-63 的 `gp-63-20260214-GP63-…`
- **THEN** 清單中的 slug SHALL 是小寫的正式網址 id

#### Scenario: 邊界案例

- **WHEN** 一篇文章要不要下架得靠猜，例如付費媒體只出現在 `source` 欄，或來源的付費狀態不確定
- **THEN** 它 SHALL NOT 列入依規則下架的批次
- **AND** 規則檔 SHALL 記錄這篇與理由

#### Scenario: 沒有授權紀錄

- **WHEN** 一批下架沒有 owner 的授權紀錄
- **THEN** 該批 SHALL NOT 執行

#### Scenario: 授權之後才發布的文章

- **WHEN** 有人在授權日之後依同一份規則重跑下架工具
- **AND** 某篇符合規則的文章是授權日之後才發布的
- **THEN** 它 SHALL NOT 被列入下架清單
