## MODIFIED Requirements

### Requirement: 下架 SHALL 是保留原欄位、清空正文的文章狀態

文章 frontmatter 的 `status` SHALL 支援 `taken-down`，代表文章已下架。下架時 SHALL 保留原本的 frontmatter 欄位，只做以下改變：`status` 改成 `taken-down`；加上 `YYYY-MM-DD` 格式的 `takenDownAt`；沒有 `sourceTitle` 時補上來源自己的標題（來源沒有標題、或抓不到標題時，可用來源開頭一句或 `source`，但 SHALL NOT 使用 gu-log 自己的文章標題）；沒有 `author` 時可補上來源標示的作者或機構，查不到或不確定就不補，SHALL NOT 用猜的；`summary` 換成對應系列與語言的中性句；移除與新狀態不相容的 `deprecatedBy`、`deprecatedReason`、`retiredReason` 與 `retiredAt`；正文清空，只允許空白字元。

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
- **THEN** frontmatter schema SHALL 拒絕這個已退役的欄位，不論文章狀態

### Requirement: 自動化 SHALL 依狀態處理下架文章

把文章改成 `taken-down` SHALL NOT 需要 Tribunal 評分。Score floor 與其他以讀者可見內容變更為觸發條件的內容 gates SHALL 跳過下架文章；frontmatter 驗證與 emoji 檢查 SHALL 仍適用。Tribunal 的候選選取 SHALL 依 `status` 排除下架文章。Dedup SHALL 把下架文章視為來源已封鎖：新文章的來源與任一下架文章相同時 SHALL 被擋下，不分候選的系列、也不分下架文章的系列，沒有例外；比對 SHALL 找出所有相同來源的文章。既有文章互比與主題相似度比對 SHALL NOT 把下架文章當成重複對象。

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

- **WHEN** dedup gate 收到的候選網址與某篇下架文章相同，不論候選是哪個系列
- **THEN** gate SHALL 回 BLOCK，並說明來源已封鎖

#### Scenario: GP 導讀用下架 GP 的來源

- **WHEN** dedup gate 以 GP 系列收到的候選網址只跟下架的 GP 相同
- **THEN** gate SHALL 回 BLOCK，SHALL NOT 回 WARN

#### Scenario: GP 候選撞到下架的 MP

- **WHEN** dedup gate 以 GP 系列收到的候選網址，跟任一篇下架的 MP 相同
- **THEN** gate SHALL 回 BLOCK，並說明來源已封鎖

## REMOVED Requirements

### Requirement: 已下架的文章 SHALL 被 CI 棘輪鎖住

**Reason**: 「帶有效來源距離章的 GP 可以重用下架 GP 的來源」這個例外跟著章退役，描述它的兩個情境不能在 MODIFIED 裡刪掉。另外 GP-276～278 改成 MP 時，來源跟下架的 GP 相同，要寫明改系列不算新文章。

**Migration**: 改由「已下架文章與它們的來源 SHALL 被 CI 棘輪鎖住」承接：封鎖規則不變，拿掉帶章例外，改系列與替它補語言版本算既有文章。`scripts/check-takedown-ratchet.mjs` 與 `scripts/hooks/pre-commit` 拿掉驗章分支。

## ADDED Requirements

### Requirement: 已下架文章與它們的來源 SHALL 被 CI 棘輪鎖住

Pre-commit 與 CI SHALL 比較基準版本與新版本：基準版本已是 `taken-down` 的文章，新版本 SHALL 仍存在、仍是 `taken-down`，而且正文為空。新增的文章，以及改了 `sourceUrl` 的既有文章，來源（正規化後的網址或推文 ID）與任一下架文章相同時 SHALL 失敗，不分系列、沒有例外；比對 SHALL 找出所有相同來源的下架文章。用 `scripts/reclassify-post.mjs` 改系列、遷移清單有記而且 `sourceUrl` 沒變的改名 SHALL 算既有文章；之後替它補上缺少的語言版本（同 `ticketId`、同 `sourceUrl`）也 SHALL NOT 算新增。`sources/` 底下新增 `sources/chatgpt/` 以外的檔案時 SHALL 失敗。

#### Scenario: 自動化把全文寫回下架文章

- **GIVEN** 一篇文章在基準版本是 `taken-down`
- **WHEN** 一個變更把它改回 `published`、寫入正文，或刪除它
- **THEN** pre-commit 與 CI SHALL 失敗

#### Scenario: 新文章使用已封鎖的來源

- **WHEN** 一個變更新增的文章（包括新的 GP 或 `GP-PENDING`），`sourceUrl` 與某篇下架文章相同
- **THEN** pre-commit 與 CI SHALL 失敗，並指出被封鎖的來源與下架文章

#### Scenario: 新增第三方原文擷取

- **WHEN** 一個變更在 `sources/` 底下新增 `sources/chatgpt/` 以外的檔案
- **THEN** pre-commit 與 CI SHALL 失敗

#### Scenario: 既有文章改用已封鎖的來源

- **WHEN** 一個變更把既有文章的 `sourceUrl` 改成某篇下架文章的來源
- **THEN** pre-commit 與 CI SHALL 失敗，並指出被封鎖的來源與下架文章

#### Scenario: 改系列的文章不算新增

- **GIVEN** 一篇已公開的 GP，`sourceUrl` 跟某篇下架的 GP 相同
- **WHEN** 它用 `scripts/reclassify-post.mjs` 改成 MP，遷移清單有記，`sourceUrl` 沒變
- **THEN** 棘輪 SHALL NOT 因來源封鎖而失敗
- **AND** 之後替它補上的英文版（同 `ticketId`、同 `sourceUrl`）也 SHALL NOT 失敗

#### Scenario: 不算改系列的改名或語言版本

- **WHEN** 改系列時改了 `sourceUrl`、遷移清單沒記這次改名，或新增的語言檔不屬於改系列的文章，而它的來源跟某篇下架文章相同
- **THEN** 棘輪 SHALL 把它當成新增或改了來源的文章，並因來源封鎖而失敗
