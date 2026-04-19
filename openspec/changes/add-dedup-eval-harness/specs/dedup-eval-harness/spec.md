## ADDED Requirements

### Requirement: Fixture 目錄位置獨立於 post tree

題庫 fixture 檔案 SHALL 住在 `tribunal/fixtures/` 目錄下，SHALL NOT 放在 `src/content/posts/` 或任何 Astro content collection 目錄中。Ralph Loop、tribunal 審判員、自動改寫工具 SHALL NOT 對 `tribunal/fixtures/` 下任何檔案進行修改（人類手動修正除外）。

#### Scenario: Fixture 不受 Ralph Loop 改寫影響

- **WHEN** Ralph Loop 對 gu-log corpus 執行例行重寫
- **THEN** 它 SHALL 只處理 `src/content/posts/**/*.mdx`
- **AND** `tribunal/fixtures/**/*.yaml` 不被觸及
- **AND** fixture 的 `corpusSnapshot` 內容保持原始凍結狀態

#### Scenario: Fixture 的子目錄結構

- **WHEN** 新增一個 hard-dup 分類的 fixture
- **THEN** 它 SHALL 放在 `tribunal/fixtures/hard-dup/{slug}.yaml`
- **AND** 其他三種分類同理：`soft-dup/`、`intentional-series/`、`clean-diff/`

---

### Requirement: Fixture YAML schema

每筆 fixture SHALL 是一個 YAML 檔，SHALL 包含以下欄位，所有欄位皆為必填：

- `inputPost`：被測的 post — 物件，含 `slug`、`frontmatter`、`contentSnapshot`
- `corpusSnapshot`：當時既有的相關文章清單 — 陣列，每個 element 含 `slug`、`frontmatter`、`contentSnapshot`
- `expectedClass`：enum，四選一：`'hard-dup' | 'soft-dup' | 'intentional-series' | 'clean-diff'`
- `expectedAction`：enum，三選一：`'BLOCK' | 'WARN' | 'allow'`
- `humanReasoning`：字串，人類判決理由（允許多行）
- `sourceRef`：字串，該 fixture 的原始決策出處（git commit hash、PR 編號、或決議日期）

`contentSnapshot` 不必收全文 —— 至少包含 title、summary、lead paragraph（約 200-400 字），足以讓 Librarian / dedup-gate 判斷即可。這是為了把 fixture 檔案大小控制在可讀範圍。

#### Scenario: 合法的 hard-dup fixture

- **WHEN** 建立 `tribunal/fixtures/hard-dup/mythos-techcrunch.yaml`
- **AND** YAML 包含 `inputPost` 指向 CP-298 的 snapshot
- **AND** `corpusSnapshot` 陣列含一筆 SP-165 的 snapshot
- **AND** `expectedClass: 'hard-dup'`、`expectedAction: 'BLOCK'`
- **AND** `humanReasoning` 註明「CP-298 是 TechCrunch 對 Anthropic Mythos 官方 blog 的轉述，無獨立 diff」
- **AND** `sourceRef: '2289c882'`（deprecation commit）
- **THEN** 該 fixture SHALL 通過 schema 驗證

#### Scenario: 缺欄位的 fixture 被拒絕

- **WHEN** fixture 檔案缺 `humanReasoning`
- **THEN** eval loader SHALL 拒絕該 fixture
- **AND** 錯誤訊息 SHALL 指出缺哪個欄位

---

### Requirement: 四種分類覆蓋

Fixture 集合 SHALL 涵蓋所有四種 `expectedClass`。每種分類 SHALL 至少有 1 筆 fixture。評估腳本在載入時 SHALL 檢查此涵蓋性；若有分類缺席，SHALL 在 stderr 印出警告。

#### Scenario: 四類齊全通過檢查

- **WHEN** `tribunal/fixtures/` 下四個子目錄各自至少有 1 個 `.yaml`
- **THEN** evaluator SHALL NOT 印出涵蓋性警告

#### Scenario: 缺一類則警告

- **WHEN** `tribunal/fixtures/clean-diff/` 目錄為空
- **THEN** evaluator SHALL 在啟動時印出警告：「clean-diff fixture 0 筆，評估結果對該分類無意義」
- **AND** evaluator SHALL 繼續執行（警告不阻斷）

---

### Requirement: 評估輸出指標

評估腳本 SHALL 輸出 **per-category precision + recall** 兩個指標，SHALL 額外列出所有誤判 fixture 的 slug。MAY 附上 overall accuracy 作為補充資訊，但 SHALL NOT 僅回報 overall accuracy 而缺 per-category 指標。

#### Scenario: 報告包含 per-category precision + recall

- **WHEN** evaluator 跑完 10 筆 fixture
- **THEN** 輸出報告 SHALL 包含四個分類各自的 precision + recall（8 個數字）
- **AND** 若某分類沒有任何 fixture，該分類的指標 SHALL 以 `N/A` 或 `n=0` 標示

#### Scenario: 誤判 fixture slug 列出

- **WHEN** evaluator 判定某 fixture 分類錯誤
- **THEN** 報告 SHALL 列出該 fixture 的 slug + expectedClass + actualClass
- **AND** 方便人類直接開啟 YAML 檢視原因

---

### Requirement: Fixture 凍結原則

Fixture 一旦 commit 進 git，SHALL NOT 被自動化工具修改。允許的修改情境僅限：

- 人類發現 fixture 本身的 `expectedClass` 判錯 → 可修正 + commit message SHALL 以 `fix(fixture): <slug>` 開頭並說明改動原因
- 新增 fixture → 照正常新增流程
- 刪除過時 fixture（例如對應 post 已從 corpus 永久下架）→ commit message SHALL 以 `chore(fixture): remove <slug>` 開頭並說明原因

#### Scenario: Ralph Loop 不得改 fixture 內文

- **WHEN** Ralph Loop 執行 rewrite pass
- **AND** 它的 file glob 意外匹配到 `tribunal/fixtures/*.yaml`
- **THEN** runner SHALL 跳過該檔案
- **AND** 記錄一則 warning log

#### Scenario: 人類修正 fixture 需標記

- **WHEN** 人類發現 `gemma-4-dual-post.yaml` 的 `expectedClass` 應為 `clean-diff` 而非 `soft-dup`
- **THEN** commit message SHALL 為 `fix(fixture): gemma-4-dual-post — reclassify soft-dup → clean-diff`
- **AND** commit body SHALL 說明重新判定的理由（避免未來對 fixture 版本演進失去追溯性）

---

### Requirement: Bootstrap 初始批次

本 change archive 前，`tribunal/fixtures/` 下 SHALL 至少存在以下 4 筆 fixture 之 3 筆（第 4 筆為 outstanding item，可在 Level D 執行階段補齊或延至 Level E 前補齊）：

| 分類 | 檔名 | 來源 |
|---|---|---|
| `soft-dup` | `gemma-4-dual-post.yaml` | CP-242 + CP-275 |
| `hard-dup` | `mythos-techcrunch.yaml` | SP-165 + CP-298（deprecated） |
| `intentional-series` | `karpathy-ai-engineering.yaml` | CP-36 + CP-116 + CP-137 |
| `clean-diff` | 待定 | outstanding |

#### Scenario: 三筆歷史案例 fixture 成立

- **WHEN** `openspec archive add-dedup-eval-harness` 執行
- **THEN** `tribunal/fixtures/soft-dup/gemma-4-dual-post.yaml` SHALL 存在
- **AND** `tribunal/fixtures/hard-dup/mythos-techcrunch.yaml` SHALL 存在
- **AND** `tribunal/fixtures/intentional-series/karpathy-ai-engineering.yaml` SHALL 存在

#### Scenario: clean-diff 於後續補齊

- **WHEN** Level E `add-librarian-dupcheck` 開始前
- **THEN** `tribunal/fixtures/clean-diff/` SHALL 至少存在 1 筆 fixture
- **AND** 若無，Level E 的 archive 流程 SHALL 被阻擋（因 Level E 需要四類齊全才有意義測試）
