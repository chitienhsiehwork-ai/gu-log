## Why

後續三個 change（Level E `add-librarian-dupcheck`、Level F `add-semantic-dedup-gate-layers`、Level G `add-corpus-dedup-scanner`）會引進多個數字門檻（Jaccard 相似度、embedding 距離、同作者時間窗、主旨重疊比例）。沒有固定基準，這些門檻設多少都是瞎猜；改了門檻更不知道是變好還是變爛。

所以先建一組「有標準答案的題庫」—— eval harness —— 把已知的 HARD / SOFT / intentional-series / clean-diff 案例凍結下來，作為 Level E/F/G 調參數時的客觀基準。同一批 fixture 還可以直接塞進 Librarian 的 `dupCheck` 提示當 few-shot 範例，一魚兩吃。

考量 tribunal 長期會以 24 小時 cron 跑，`src/content/posts/*.mdx` 持續被 Ralph Loop / tribunal 重寫。若 fixture 直接指回 post slug，題目本身會跟著演進、結果不可重現。因此 fixture 須住在獨立目錄，把「當時既有文章」的內文拓印一份凍結保存。

## What Changes

### 新增目錄 `tribunal/fixtures/`

- 子目錄依 expected classification 分：`hard-dup/`、`soft-dup/`、`intentional-series/`、`clean-diff/`
- 每筆 fixture 是一個 YAML 檔：`tribunal/fixtures/{class}/{slug}.yaml`

### Fixture YAML schema

每筆 fixture 必含：

- `inputPost`：被測的那篇 post — 含 slug、frontmatter、內文 snapshot
- `corpusSnapshot`：當時既有文章清單 — 每篇含 slug、frontmatter、內文 snapshot（至少 title + summary + lead paragraph，不要全文以控檔案大小）
- `expectedClass`：enum `'hard-dup' | 'soft-dup' | 'intentional-series' | 'clean-diff'`
- `expectedAction`：enum `'BLOCK' | 'WARN' | 'allow'`
- `humanReasoning`：人類當初判定這個答案的理由（多行字串）
- `sourceRef`：這筆 fixture 是從哪個事件 / 決議 / PR 截下來的（git commit hash、PR 編號、或 deprecation 決議日期）

### 評估流程

- 新腳本 `scripts/eval-dedup-harness.mjs`：讀取 `tribunal/fixtures/` 全部 fixture → 丟進待測系統（Level E 後才有 Librarian `dupCheck`；Level F 後才有 gate 規則）→ 對照 `expectedClass` 算指標
- 輸出報告：**每個分類分開算 precision + recall**，加上誤判案例的 slug 清單方便除錯

### Bootstrap — 初始 3 + 1 筆 fixture

| Class | Fixture | 來源案例 |
|---|---|---|
| `soft-dup` | `gemma-4-dual-post.yaml` | CP-242 + CP-275（Gemma 4 雙篇 cross-link） |
| `hard-dup` | `mythos-techcrunch.yaml` | SP-165（primary）+ CP-298（derivative，已 deprecated） |
| `intentional-series` | `karpathy-ai-engineering.yaml` | CP-36 + CP-116 + CP-137（Karpathy 跨年系列） |
| `clean-diff` | 待補（Level D 執行階段手刻或從 corpus 挑一筆） | 暫缺 — outstanding item |

### 新能力 (capability)

- `dedup-eval-harness`：Level E/F/G 調參的客觀基準 + 指標產出格式 + fixture 凍結原則

### 被排除的項目

- **自動從 git history 生成 fixture**：Level D 只定格式 + 手動 bootstrap 3 筆。自動抽取留給未來。
- **評估指標的權重設計**（例如 HARD-DUP 答錯扣 3 分、clean-diff 答錯扣 1 分）：Level E 真正用到時再定。Level D 只要求「per-category precision + recall」兩個數字。
- **pre-commit hook 擋 `tribunal/fixtures/` 被改動**：邏輯可寫但留給 Level G 統一 hook 工作。Level D 先靠 convention + commit message 自律。

## Impact

### Affected specs

- `dedup-eval-harness`（新 capability）

### Affected code

- `tribunal/fixtures/`（新目錄）
- `scripts/eval-dedup-harness.mjs`（新；Level D 執行階段建立，初版只做 fixture loader + schema 驗證，evaluator 部分 Level E 才接上）

### Depends on

- `add-dedup-policy`（Level A + B）：fixture 的 `expectedClass` / `expectedAction` 分類來自這份 spec
- `extend-post-frontmatter`（Level C）：fixture 內的 `inputPost.frontmatter` / `corpusSnapshot[].frontmatter` 結構來自這份 spec

### Blocks

- Level E（`add-librarian-dupcheck`）：Librarian `dupCheck` 門檻須靠本 fixture 校準；few-shot 範例也從本 fixture 挑
- Level F（`add-semantic-dedup-gate-layers`）：gate 的 embedding 距離 / Jaccard 門檻須靠本 fixture 校準
- Level G（`add-corpus-dedup-scanner`）：retroactive scanner 誤殺率須靠本 fixture 量
