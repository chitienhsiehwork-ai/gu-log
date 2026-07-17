## MODIFIED Requirements

### Requirement: Judge PASS 後分數寫入 frontmatter

Tribunal pipeline 在每個 judge stage 判定 PASS 後，SHALL 立即呼叫 frontmatter 寫入函式，把該 judge 的分數寫入文章 MDX 的 `scores:` 區塊。

寫入 SHALL 包含該 judge 的 version-owned 維度分數、floored composite `score`、ISO 8601 `date` 與使用的 `model` label。

#### Scenario: Vibe scorer PASS 後分數出現在 version 9+ frontmatter

- **WHEN** `tribunalVersion >= 9` 的 vibe-scorer stage 判定 PASS
- **THEN** `scores.vibe` SHALL 包含 `persona`、`moguNote`、`vibe`、`narrative`、`score`、`date`、`model`
- **AND** SHALL NOT write `clawdNote` or Vibe-owned `clarity`

#### Scenario: Vibe scorer PASS 後分數出現在 version 8 frontmatter

- **WHEN** `tribunalVersion <= 8` 的 vibe-scorer stage 判定 PASS
- **THEN** `scores.vibe` SHALL 包含 `persona`、`moguNote`、`vibe`、`clarity`、`narrative`、`score`、`date`、`model`
- **AND** SHALL NOT write `clawdNote`

#### Scenario: Fact checker PASS 後分數出現在 frontmatter

- **WHEN** tribunal 的 fact-checker stage 判定 PASS
- **THEN** `scores.factCheck` SHALL 包含該版本要求的 fact dimensions、`score`、`date`、`model`

#### Scenario: 中途失敗只有部分分數

- **WHEN** vibe-scorer 和 librarian 已 PASS，但 fact-checker FAIL
- **THEN** frontmatter SHALL 包含 `scores.vibe` 和 `scores.librarian`
- **AND** SHALL NOT 包含 `scores.factCheck`

### Requirement: EN 對應檔同步寫入

寫入 zh-tw 版本的 scores 時，SHALL 同時檢查並寫入 `en-*` 對應檔（如果存在）。

#### Scenario: 有英文版的 GP 文章同步更新

- **WHEN** scores 寫入 `gp-177-20260421-slug.mdx`
- **AND** `en-gp-177-20260421-slug.mdx` 存在
- **THEN** 兩個檔案的 `scores` 區塊 SHALL 完全一致

#### Scenario: 沒有英文版不報錯

- **WHEN** scores 寫入一篇沒有 `en-*` 對應檔的文章
- **THEN** 只更新 zh-tw 版本
- **AND** SHALL NOT 產生錯誤或警告
