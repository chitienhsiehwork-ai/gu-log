## MODIFIED Requirements

### Requirement: Frontmatter 選填欄位

Frontmatter SHALL 支援以下選填欄位：`seriesId`、`dedup`（含子欄位）、`metadata.gateWarnings`、**`scores`（含四個 judge 子物件）**。選填欄位缺失 SHALL NOT 觸發 build 失敗。

`scores` 物件結構：
- `tribunalVersion`：正整數（選填）
- `librarian`：`{ glossary, crossRef, sourceAlign, attribution, score, date, model? }`
- `factCheck`：`{ accuracy, fidelity, consistency, score, date, model? }`
- `freshEyes`：`{ readability, firstImpression, score, date, model? }`
- `vibe`：`{ persona, clawdNote, vibe, clarity, narrative, score, date, model? }`

每個 judge 子物件為選填（允許累進寫入）。維度分數為 0-10 整數，`score` 為 composite（`floor(avg)`），`date` 為 ISO 8601 字串，`model` 為 model label 字串（選填）。

#### Scenario: 只有部分 judge 分數的 post build 成功

- **WHEN** post 的 frontmatter 有 `scores.vibe` 但沒有 `scores.factCheck`
- **THEN** Zod schema 驗證 SHALL 通過
- **AND** build SHALL 成功

#### Scenario: scores 完全缺失的 post build 成功

- **WHEN** post 的 frontmatter 沒有 `scores` 欄位
- **THEN** Zod schema 驗證 SHALL 通過（scores 整體是 optional）

#### Scenario: scores 內的維度分數超出範圍 build 失敗

- **WHEN** post 的 `scores.vibe.persona` 值為 `11`（超出 0-10）
- **THEN** Zod schema 驗證 SHALL 失敗
