## ADDED Requirements

### Requirement: Judge PASS 後分數寫入 frontmatter

Tribunal pipeline 在每個 judge stage 判定 PASS 後，SHALL 立即呼叫 frontmatter 寫入函式，把該 judge 的分數寫入文章 MDX 的 `scores:` 區塊。

寫入 SHALL 包含以下欄位：
- 該 judge 的所有維度分數（0-10 整數）
- `score`：composite 分數（`floor(avg(維度分數))`）
- `date`：寫入時間（ISO 8601 格式）
- `model`：使用的 model label（例如 `claude-opus-4-6`）

#### Scenario: Vibe scorer PASS 後分數出現在 frontmatter

- **WHEN** tribunal 的 vibe-scorer stage 判定 PASS
- **THEN** 文章 MDX 的 frontmatter SHALL 包含 `scores.vibe` 區塊
- **AND** `scores.vibe` SHALL 包含 `persona`、`clawdNote`、`vibe`、`clarity`、`narrative`、`score`、`date`、`model` 欄位
- **AND** 所有維度分數 SHALL 為 0-10 的整數

#### Scenario: Fact checker PASS 後分數出現在 frontmatter

- **WHEN** tribunal 的 fact-checker stage 判定 PASS
- **THEN** 文章 MDX 的 frontmatter SHALL 包含 `scores.factCheck` 區塊
- **AND** `scores.factCheck` SHALL 包含 `accuracy`、`fidelity`、`consistency`、`score`、`date`、`model` 欄位

#### Scenario: 中途失敗只有部分分數

- **WHEN** vibe-scorer 和 librarian 已 PASS，但 fact-checker FAIL
- **THEN** frontmatter SHALL 包含 `scores.vibe` 和 `scores.librarian`
- **AND** frontmatter SHALL NOT 包含 `scores.factCheck`
- **AND** 頁面 SHALL 渲染已有的兩個 judge badge

---

### Requirement: Judge key mapping

Pipeline SHALL 維護 stage name → frontmatter key 的對應表：

| Pipeline stage name | Frontmatter key |
|---|---|
| `vibe-scorer` | `vibe` |
| `fact-checker` | `factCheck` |
| `fresh-eyes` | `freshEyes` |
| `librarian` | `librarian` |

Shell pipeline（`tribunal-all-claude.sh`）和 TypeScript pipeline（`pipeline.ts`）SHALL 使用相同的 mapping。

#### Scenario: Shell pipeline 使用正確的 frontmatter key

- **WHEN** `tribunal-all-claude.sh` 的 `run_stage()` 處理 `fact-checker` stage
- **THEN** 寫入 frontmatter 時 SHALL 使用 key `factCheck`（不是 `fact-checker`）

#### Scenario: 不認識的 stage name 不寫入

- **WHEN** pipeline 遇到不在 mapping 表中的 stage name
- **THEN** SHALL 跳過 frontmatter 寫入
- **AND** SHALL 記錄警告訊息

---

### Requirement: EN 對應檔同步寫入

寫入 zh-tw 版本的 scores 時，SHALL 同時檢查並寫入 `en-*` 對應檔（如果存在）。

#### Scenario: 有英文版的文章同步更新

- **WHEN** scores 寫入 `sp-177-20260421-slug.mdx`
- **AND** `en-sp-177-20260421-slug.mdx` 存在
- **THEN** 兩個檔案的 `scores` 區塊 SHALL 完全一致

#### Scenario: 沒有英文版不報錯

- **WHEN** scores 寫入一篇沒有 `en-*` 對應檔的文章
- **THEN** 只更新 zh-tw 版本
- **AND** SHALL NOT 產生錯誤或警告

---

### Requirement: 兩套 pipeline 都要實作

Legacy shell pipeline（`tribunal-all-claude.sh`）和 v2 TypeScript pipeline（`pipeline.ts`）SHALL 都實作 score 寫入功能。

#### Scenario: Shell pipeline 寫入分數

- **WHEN** 透過 `tribunal-all-claude.sh` 跑 tribunal
- **THEN** 每個 PASS 的 judge 分數 SHALL 出現在文章 frontmatter

#### Scenario: V2 pipeline 寫入分數

- **WHEN** 透過 tribunal v2（`pipeline.ts`）跑 tribunal
- **THEN** 每個 PASS 的 judge 分數 SHALL 出現在文章 frontmatter

---

### Requirement: 不覆蓋其他 judge 的分數

寫入某個 judge 的分數時，SHALL NOT 覆蓋其他 judge 已寫入的分數。寫入 SHALL 使用 deep merge 策略。

#### Scenario: 後寫入的 judge 不蓋掉先寫入的

- **WHEN** `scores.vibe` 已存在於 frontmatter
- **AND** fact-checker PASS 後寫入 `scores.factCheck`
- **THEN** `scores.vibe` SHALL 保持不變
- **AND** `scores.factCheck` SHALL 正確寫入

#### Scenario: 同一 judge 重跑覆蓋舊分數

- **WHEN** `scores.vibe` 已存在（來自之前的 tribunal run）
- **AND** 同一文章重新跑 tribunal，vibe-scorer 再次 PASS 得到新分數
- **THEN** `scores.vibe` SHALL 更新為新分數
