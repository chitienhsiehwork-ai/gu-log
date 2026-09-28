## MODIFIED Requirements

### Requirement: Judge PASS 後分數寫入 frontmatter

Tribunal pipeline 在每個 judge stage 判定 PASS 後，SHALL 立即呼叫 frontmatter 寫入函式，把該 judge 的分數寫入文章 MDX 的 `scores:` 區塊。

寫入 SHALL 包含該 judge 的 version-owned 維度分數（0-10 整數）、floored composite `score`、ISO 8601 `date` 與使用的 `model` label。

GP 在 Tribunal 只評分（`gp-source-preservation`），所以對 GP，每個 judge stage 判定後不論 PASS 或 FAIL 都 SHALL 寫入分數，前一個 judge FAIL 時其餘 judge SHALL 照樣評分；GP 能不能上線由 CONTRIBUTING〈兩層品質門檻〉判定，不要求每一關都 PASS。Tribunal 的每個入口（`scripts/tribunal.sh` 與 `pnpm tribunal:run`）SHALL 行為一致。

#### Scenario: Vibe scorer PASS 後分數出現在 version 9+ frontmatter

- **WHEN** `tribunalVersion >= 9` 的 vibe-scorer stage 判定 PASS
- **THEN** `scores.vibe` SHALL 包含 `persona`、`moguNote`、`vibe`、`narrative`、`score`、`date`、`model`
- **AND** SHALL NOT write `clawdNote` or Vibe-owned `clarity`
- **AND** 所有維度分數 SHALL 為 0-10 的整數

#### Scenario: Vibe scorer PASS 後分數出現在 version 8 frontmatter

- **WHEN** `tribunalVersion <= 8` 的 vibe-scorer stage 判定 PASS
- **THEN** `scores.vibe` SHALL 包含 `persona`、`moguNote`、`vibe`、`clarity`、`narrative`、`score`、`date`、`model`
- **AND** SHALL NOT write `clawdNote`
- **AND** 所有維度分數 SHALL 為 0-10 的整數

#### Scenario: Fact checker PASS 後分數出現在 frontmatter

- **WHEN** tribunal 的 fact-checker stage 判定 PASS
- **THEN** `scores.factCheck` SHALL 包含該版本要求的 fact dimensions、`score`、`date`、`model`

#### Scenario: 中途失敗只有部分分數

- **WHEN** 一篇非 GP 文章的 vibe-scorer 和 librarian 已 PASS，但 fact-checker FAIL
- **THEN** frontmatter SHALL 包含 `scores.vibe` 和 `scores.librarian`
- **AND** SHALL NOT 包含 `scores.factCheck`
- **AND** 頁面 SHALL 渲染已有的兩個 judge badge

#### Scenario: GP 有評審沒過仍寫入全部分數

- **WHEN** 一篇 GP 的 librarian FAIL，其餘 judge 的判定不論 PASS 或 FAIL
- **THEN** 其餘 judge SHALL 照樣評分
- **AND** frontmatter SHALL 包含四個 judge 的分數，`scores.librarian` 為沒過的那次分數
- **AND** GP 正文與來源距離章 SHALL NOT 改變
- **AND** 該次 Tribunal SHALL 以失敗結束
