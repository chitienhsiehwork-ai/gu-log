## MODIFIED Requirements

### Requirement: Fixture YAML schema

每筆 fixture SHALL 是一個 YAML 檔，SHALL 包含以下欄位，所有欄位皆為必填：

- `inputPost`：被測的 post — 物件，含 `slug`、`frontmatter`、`contentSnapshot`
- `corpusSnapshot`：當時既有的相關文章清單 — 陣列，每個 element 含 `slug`、`frontmatter`、`contentSnapshot`
- `expectedClass`：enum，四選一：`'hard-dup' | 'soft-dup' | 'intentional-series' | 'clean-diff'`
- `expectedAction`：enum，三選一：`'BLOCK' | 'WARN' | 'allow'`
- `humanReasoning`：字串，人類判決理由（允許多行）
- `sourceRef`：字串，該 fixture 的原始決策出處（git commit hash、PR 編號、或決議日期）

`contentSnapshot` 不必收全文 —— 至少包含 title、summary、lead paragraph（約 200-400 字），足以讓 Librarian / dedup-gate 判斷即可。

#### Scenario: 合法的 hard-dup fixture

- **WHEN** 建立 `tribunal/fixtures/hard-dup/mythos-techcrunch.yaml`
- **AND** YAML 包含 `inputPost` 指向 MP-298 的 snapshot
- **AND** `corpusSnapshot` 陣列含一筆 GP-165 的 snapshot
- **AND** `expectedClass: 'hard-dup'`、`expectedAction: 'BLOCK'`
- **AND** `humanReasoning` 註明「MP-298 是 TechCrunch 對 Anthropic Mythos 官方 blog 的轉述，無獨立 diff」
- **AND** `sourceRef: '2289c882'`
- **THEN** 該 fixture SHALL 通過 schema 驗證

#### Scenario: 缺欄位的 fixture 被拒絕

- **WHEN** fixture 檔案缺 `humanReasoning`
- **THEN** eval loader SHALL 拒絕該 fixture
- **AND** 錯誤訊息 SHALL 指出缺哪個欄位

### Requirement: Bootstrap 初始批次

本 change archive 前，`tribunal/fixtures/` 下 SHALL 至少存在以下 4 筆 fixture 之 3 筆（第 4 筆為 outstanding item，可在 Level D 執行階段補齊或延至 Level E 前補齊）：

| 分類 | 檔名 | 來源 |
|---|---|---|
| `soft-dup` | `gemma-4-dual-post.yaml` | MP-242 + MP-275 |
| `hard-dup` | `mythos-techcrunch.yaml` | GP-165 + MP-298（deprecated） |
| `intentional-series` | `ecc-series.yaml` | GP-143 + GP-144 + GP-151（Affaan Mustafa ECC 系列，顯式宣告 `series`） |
| `clean-diff` | 待定 | outstanding |

#### Scenario: 三筆歷史案例 fixture 成立

- **WHEN** taxonomy migration archive 前驗證 fixtures
- **THEN** `tribunal/fixtures/soft-dup/gemma-4-dual-post.yaml` SHALL 存在
- **AND** `tribunal/fixtures/hard-dup/mythos-techcrunch.yaml` SHALL 存在
- **AND** `tribunal/fixtures/intentional-series/ecc-series.yaml` SHALL 存在
- **AND** 這些 fixture SHALL 只使用 canonical GP/MP identities

#### Scenario: clean-diff 於後續補齊

- **WHEN** Level E `add-librarian-dupcheck` 開始前
- **THEN** `tribunal/fixtures/clean-diff/` SHALL 至少存在 1 筆 fixture
- **AND** 若無，Level E 的 archive 流程 SHALL 被阻擋
