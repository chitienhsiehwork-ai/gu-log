## ADDED Requirements

### Requirement: dupCheck 為 Stage 3 FactLib Judge 的獨立評分維度

Tribunal v2 Stage 3 的 `FactLibJudgeOutput.scores` SHALL 包含一個整數欄位 `dupCheck`（0-10）。`dupCheck` SHALL 由 `v2-factlib-judge` 評定，SHALL NOT 由 `v2-librarian-worker` 或其他 Stage 3 worker 評定。

`dupCheck` 的評分對象是**這篇稿件相對於 corpus 的重複判定是否正確**，而不是「稿件的 library 連結品質」。因此 dupCheck SHALL NOT 與 `linkCoverage` 或 `linkRelevance` 合併計算 composite。

#### Scenario: dupCheck 為 judge 評分維度而非 worker 動作

- **WHEN** Stage 3 執行 `v2-librarian-worker`
- **THEN** worker 的 output SHALL NOT 含 `dupCheck` 欄位
- **AND** worker 的 output 仍為 `LibrarianOutput`（只含 `glossary_links_added`、`cross_references_added`）

#### Scenario: dupCheck 為 FactLib Judge 評分維度

- **WHEN** Stage 3 執行 `v2-factlib-judge`
- **THEN** judge 的 `FactLibJudgeOutput.scores` SHALL 含 `dupCheck: integer 0..10`
- **AND** dupCheck 與 `factAccuracy`、`sourceFidelity`、`linkCoverage`、`linkRelevance` 並列

---

### Requirement: dupCheck Pass Bar 獨立，不與其他維度互補

Stage 3 的整體 pass 條件 SHALL 為：

```
fact_pass = Math.floor((factAccuracy + sourceFidelity) / 2) >= 8
library_pass = Math.floor((linkCoverage + linkRelevance) / 2) >= 8
dupCheck_pass = dupCheck >= 8
pass = fact_pass AND library_pass AND dupCheck_pass
```

高 fact / library 分數 SHALL NOT 補償低 dupCheck 分數，反之亦然。

#### Scenario: 三個 pass bar 任一不過則整體不過（dupCheck-only FAIL 路徑）

- **WHEN** judge 輸出 `factAccuracy=10, sourceFidelity=10, linkCoverage=9, linkRelevance=9, dupCheck=5`
- **THEN** `fact_pass = true`、`library_pass = true`、`dupCheck_pass = false`
- **AND** 整體 `pass = false`
- **AND** Stage 3 SHALL NOT 觸發 workers 重跑（FactCorrector / Librarian 無法修 dedup 問題）
- **AND** Stage 3 SHALL 標記 `status = 'needs_review'`
- **AND** Stage 3 SHALL 把 judge 的 dedup verdict（class / action / matchedSlugs / score）寫入 article frontmatter `dedup.tribunalVerdict`
- **AND** 交由 Level F gate 或人工處理

#### Scenario: 三個 pass bar 全過整體才過

- **WHEN** judge 輸出所有五個維度 ≥ 8（fact composite ≥ 8、library composite ≥ 8、dupCheck ≥ 8）
- **THEN** 整體 `pass = true`
- **AND** Stage 3 進入 PASS 狀態

---

### Requirement: dupCheck 評分 rubric

`v2-factlib-judge` SHALL 依下列 rubric 評分：

- **10**：clean-diff —— 主題可能類似但有獨立貢獻 / 切入角度，允許發佈、無須 cross-link
- **8**：正確識別為 hard-dup（BLOCK verdict）、soft-dup（WARN verdict）、或 intentional-series（allow verdict），與 fixture / Level B policy 定義一致
- **5**：邊界案例 —— judge 判斷有重疊但類別不確定，以保守為原則給 WARN
- **2**：誤判 —— clean-diff 被判為 dup 誤殺，或 hard-dup 被放行而未觸發 BLOCK

評分對應 Level B policy 的嚴格度：

| dupCheck 行為 | 對應 Level B verdict | 分數區間 |
|---|---|---|
| 識別為 clean-diff，放行 | `allow` | 10 |
| 識別為 intentional-series，放行 | `allow` | 8–9 |
| 識別為 soft-dup，觸發 cross-link 建議 | `WARN` | 8 |
| 識別為 hard-dup，建議 BLOCK / deprecate | `BLOCK` | 8 |
| 邊界案例保守 WARN | `WARN` | 5 |
| 類別誤判 | — | ≤ 4 |

#### Scenario: clean-diff 正確放行得 10 分

- **WHEN** 稿件跟 corpus 有主題重疊但切入角度獨立，無須 cross-link
- **AND** judge 正確識別並給 `dupCheck: 10`
- **THEN** dupCheck_pass SHALL true

#### Scenario: hard-dup 正確判 BLOCK 得 8 分

- **WHEN** 稿件為 derivative 且 corpus 已有同 cluster primary、無 independentDiff
- **AND** judge 正確判為 hard-dup、建議 BLOCK 並指出 primary slug
- **THEN** `dupCheck SHALL = 8`（不是 10，因為雖然判決正確，但結果是「這篇不該發」）
- **AND** dupCheck_pass SHALL true

#### Scenario: hard-dup 被誤放行得 2 分

- **WHEN** 稿件確實為 hard-dup 但 judge 沒識別出、判為 clean-diff
- **THEN** `dupCheck SHALL ≤ 4`（誤放行是最嚴重失誤）
- **AND** dupCheck_pass SHALL false

---

### Requirement: Judge 讀 fixture 作為 few-shot 上下文

`v2-factlib-judge` 在執行 dupCheck 評分時 SHALL 讀取 `tribunal/fixtures/{hard-dup,soft-dup,intentional-series,clean-diff}/*.yaml` 至少每類 1 筆作為 few-shot 範例，理解該類別的判決 pattern。

Fixture YAML 的讀取 SHALL 走 `Read` tool，SHALL NOT 依賴腳本 inline 注入。

#### Scenario: Judge 啟動時讀四類各一筆 fixture

- **WHEN** `v2-factlib-judge` 收到任務
- **THEN** judge SHALL 在執行評分前 Read `tribunal/fixtures/hard-dup/` 下至少 1 個 YAML
- **AND** Read `tribunal/fixtures/soft-dup/` 下至少 1 個
- **AND** Read `tribunal/fixtures/intentional-series/` 下至少 1 個
- **AND** Read `tribunal/fixtures/clean-diff/` 下至少 1 個（若任一類為空，judge 以其他類當對比基準執行）

#### Scenario: Judge 不直接讀 fixture 當 corpus

- **WHEN** judge 執行 dupCheck 評分
- **THEN** judge SHALL NOT 把 fixture 的 `corpusSnapshot` 當成真 corpus 比對
- **AND** 真 corpus 比對 SHALL 針對 `src/content/posts/**/*.mdx`（讀 frontmatter + 首 300 字）
- **AND** fixture 僅作為「判決 pattern」的示範

---

### Requirement: Judge 比對 corpus 時限縮範圍以控成本，並排除跨語言翻譯對

`v2-factlib-judge` 在比對稿件跟 corpus 時，對每一篇 corpus post SHALL 只讀 frontmatter + 首 300 字（即 lead paragraph 等級），SHALL NOT 讀全文。此範圍與 fixture `contentSnapshot` 設計一致（200-400 字）。

Judge SHALL 在 pre-filter 階段以 `lang` 欄位排除語言不同的 corpus posts。gu-log 的 922 篇 corpus 中有 435 篇英文鏡像版（`en-sp-*` / `en-cp-*`），與其對應的中文版 slug 差 `en-` 前綴但內容相同 — 這類跨語言翻譯對 SHALL 豁免 dedup 比對（不算 dup）。

#### Scenario: Corpus 比對限縮在 frontmatter + 首 300 字

- **WHEN** judge 比對稿件 vs. 922 篇 corpus
- **THEN** 判定 pipeline SHALL 先以 `lang` 欄位 pre-filter（只比對相同語言的 posts）
- **AND** 再以 frontmatter 欄位（`clusterIds`、`seriesId`、`authorCanonical`、`sourceType`、`temporalType`）做第二層篩選
- **AND** 對 pre-filter 後的候選（SHOULD ≤ 10 篇）讀首 300 字
- **AND** 對非候選 SHALL NOT 讀內文

#### Scenario: 跨語言翻譯對豁免 dedup

- **WHEN** inputPost.slug = `sp-165-...`（`lang: zh-tw`）
- **AND** corpus 有 `en-sp-165-...`（`lang: en`）
- **THEN** judge SHALL NOT 把這對判為 dup（它們是同一篇的雙語版本）
- **AND** `en-sp-165-...` SHALL 被 lang pre-filter 或 slug 模式豁免排除在候選外

#### Scenario: 無 pre-filter 命中視為 clean-diff 候選

- **WHEN** 稿件的 `clusterIds` 為空、`seriesId` 不存在、`authorCanonical` 無相符 corpus post
- **THEN** judge 視為 clean-diff 候選
- **AND** dupCheck 傾向 10 分（除非 topic 明顯跟某篇 corpus 撞但被 frontmatter 漏掉）

---

### Requirement: Eval Harness 支援 `--run` 模式計算 precision/recall

`scripts/eval-dedup-harness.mjs` SHALL 支援以下兩種 CLI 模式：

1. **預設模式（無 flag）**：只做 schema validation + coverage warning，不呼叫 judge。退出碼：schema 違規 = 1，其他 = 0。
2. **Evaluator 模式（`--run` flag）**：對每筆 fixture 呼叫 `v2-factlib-judge`、比對 `expectedAction`、算 per-category precision + recall、輸出 markdown report。

預設模式 SHALL 與 Level D 行為一致（不破壞現有 pre-commit / CI gate）。

#### Scenario: 預設模式不打 LLM

- **WHEN** 執行 `node scripts/eval-dedup-harness.mjs`
- **THEN** 腳本 SHALL NOT 呼叫任何 Claude subprocess
- **AND** 僅印出 fixture loader 結果 + schema 檢查結果

#### Scenario: `--run` 模式呼叫 judge 並輸出 report

- **WHEN** 執行 `node scripts/eval-dedup-harness.mjs --run`
- **THEN** 腳本 SHALL 對每筆 fixture 呼叫 `v2-factlib-judge`（via spawnClaudeAgent 或等效 subprocess）
- **AND** 腳本 SHALL 把每筆 judge 輸出跟 fixture 的 `expectedAction` 比對
- **AND** 腳本 SHALL 輸出 markdown report 到 `scores/dedup-eval-YYYYMMDD-HHMMSS.md`
- **AND** report SHALL 含 per-category precision + recall（四類 × 2 指標 = 8 個數字）
- **AND** report SHALL 列出所有誤判 fixture 的 slug + expectedClass + actualClass

#### Scenario: Evaluator 注入 corpusSnapshot 時 judge 不 glob 真實 corpus

- **WHEN** evaluator 建立 judge 的 task prompt 並注入 `CORPUS SNAPSHOT` 區塊
- **THEN** judge SHALL NOT glob `src/content/posts/` 或讀任何真實 corpus 檔案
- **AND** judge SHALL 只用 prompt 中的 `CORPUS SNAPSHOT` 作為比對基準
- **AND** 此規則確保 evaluator 可重現性：同一筆 fixture 跑兩次得到同樣結果（不受真實 corpus 新增 / 刪除影響）

---

### Requirement: Per-category Precision / Recall 計算公式

Evaluator SHALL 對每一類別 `C ∈ {hard-dup, soft-dup, intentional-series, clean-diff}` 計算下列兩個指標：

```
Precision(C) = | judge predicted C AND expected C | / | judge predicted C |
Recall(C)    = | judge predicted C AND expected C | / | expected C |
```

分母為 0 時 evaluator SHALL 標記 `n/a`，SHALL NOT 填 0（避免誤導讀者）。

Report MAY 附 overall accuracy 作為補充，但 SHALL NOT 只回報 overall accuracy 而省略 per-category。

#### Scenario: hard-dup 一筆 judge 誤判為 clean-diff

- **WHEN** 只有 1 筆 hard-dup fixture 且 judge 把它判為 clean-diff
- **THEN** `Recall(hard-dup) = 0 / 1 = 0.00`
- **AND** `Precision(hard-dup) = 0 / 0 = n/a`（judge 沒有任何 prediction 為 hard-dup）
- **AND** `Precision(clean-diff)` 若有其他 clean-diff 判對 SHALL 對應調整

#### Scenario: 所有 fixture 判對

- **WHEN** evaluator 跑 4 筆 fixture 且全部判對
- **THEN** 四類的 precision = recall = 1.00
- **AND** overall accuracy = 1.00

---

### Requirement: 誤判 fixture 必於 report 列出

對每筆判錯的 fixture，evaluator report SHALL 至少列出：

- `inputPost.slug`
- `expectedClass`
- `actualClass`（judge 的 prediction）
- `expectedAction`
- `actualAction`（judge 的 verdict）
- `dupCheckScore`（judge 給的分數）
- fixture YAML 路徑（方便人類直接開啟檢視）

#### Scenario: 誤判列表格式

- **WHEN** evaluator 偵測到一筆 fixture 判錯
- **THEN** report 的 「誤判清單」區塊 SHALL 為該 fixture 新增一列
- **AND** 該列 SHALL 含上述 7 項欄位
- **AND** 方便人類直接開啟 YAML 檢視原因

---

### Requirement: `FactLibJudgeOutput` 型別向後相容性

加入 `dupCheck` 後的 `FactLibJudgeOutput.scores` SHALL 仍維持 `Record<string, number>` 的 base contract（BaseJudgeOutput 的 scores type）。既有消費方（如 UI、report generator、git-format）若未特別處理 `dupCheck`，SHALL 可以忽略該欄位而不 crash。

Agent .md 的 `judge_version` SHALL 從 `2.0.0` 升到 `2.1.0` 以標記 schema 變動。

#### Scenario: 既有消費方不 crash

- **WHEN** 舊版 report generator 讀新版 `FactLibJudgeOutput`
- **AND** 它只關心 `factAccuracy` / `sourceFidelity` / `linkCoverage` / `linkRelevance`
- **THEN** 它 SHALL 能正常取值
- **AND** 忽略 `dupCheck` 不致 crash

#### Scenario: judge_version 升級

- **WHEN** `v2-factlib-judge` 輸出 JSON
- **THEN** `judge_version` SHALL 為 `"2.1.0"`（反映 Level E 的 schema 變動）
