## Why

Level A–D 已經把 dedup taxonomy（source / temporal / sequence / author / cluster 五維）、policy 規則（B-1 / B-2 / B-3 四組 BLOCK / WARN / allow 嚴格度）、frontmatter schema 擴充、以及 eval harness 題庫（3 + 1 筆 bootstrap fixture）全部落地。現在 tribunal v2 的 Stage 3 Librarian worker 只做 glossary link + cross-reference，沒有在審稿當下做「這篇是不是跟 corpus 重複」的判定。

Level E 要補上這塊缺口 —— 把 `dupCheck` 作為**評分維度**加進 tribunal v2 Stage 3 的 FactLib judge，讓重複偵測直接進到每篇稿子的審稿流程裡，而不是事後由 corpus scanner（Level G）才發現。同一套 fixture 也被 judge prompt 拿去當 few-shot 範例，一魚兩吃。

關鍵設計判斷：**dupCheck 是一個「評分維度」，不是 worker 動作。** Worker 的職責是「動手做事」（改 fact / 加 link / 改文字），judge 的職責是「看現況評分」。判斷「這篇跟哪篇重複、該 BLOCK / WARN / allow」本質是評分，不是動手，所以 dupCheck 屬於 judge。為了少改 pipeline 架構，把 dupCheck 塞進現有 `v2-factlib-judge` 共用 Stage 3，而不是新開 Stage 3b。

Eval harness 目前只做 schema validation，拿到 Librarian 判決之前沒有數據可以算 precision / recall。Level E 同步擴充 harness 的 evaluator 邏輯，串進 `claude --agent v2-factlib-judge` 的 subprocess，讓 fixture → prediction → metrics 整條路走通。

## What Changes

### 新增 `dupCheck` 維度到 `v2-factlib-judge`

- `FactLibJudgeOutput.scores` 新增一個整數欄位 `dupCheck`（0-10）
- Judge prompt 新增一段 dupCheck scoring rubric（10 = clean-diff 放行無疑義；8 = hard-dup/BLOCK 或 soft-dup/WARN 或 series/allow 正確判決；5 = 邊界案例；2 = 誤判）
- Judge prompt 從 `tribunal/fixtures/{class}/*.yaml` 讀 few-shot 範例（每類 1 筆）
- Judge 比對被審稿件的 frontmatter + 首 300 字 vs. corpus 前 300 字的 snapshot
- Pass bar 擴充：Stage 3 整體 pass 條件為 `fact_pass AND library_pass AND dupCheck_pass`（`dupCheck_pass = dupCheck >= 8`）

### 新 capability：`librarian-dupcheck`

- 定義 dupCheck 作為 Stage 3 評分維度的行為規範（rubric、pass bar、few-shot 合約）
- 定義 dupCheck verdict 與 Level B policy 嚴格度（BLOCK / WARN / allow）的對映

### 擴充 `scripts/eval-dedup-harness.mjs`

- 從 schema validator 擴成 evaluator
- 新增 `--run` flag：對每筆 fixture 呼叫 `claude --agent v2-factlib-judge --print`（或等效 subprocess），拿到 judge 輸出後跟 `expectedAction` 比對
- 算 **per-category precision + recall**（四類各自 P/R，共 8 個數字）
- 輸出 markdown 報告到 `scores/dedup-eval-YYYYMMDD-HHMMSS.md`
- 沒加 `--run` 的情況下維持現行 schema validator 行為（不破壞 Level D 的 CI gate）

### `FactLibJudgeOutput` type 擴充

- `scores.dupCheck: number`
- `improvements.dupCheck?: string` 對於 FAIL 情境
- 新增 helper pass-bar 函式（`checkFactLibPassBar` 擴張）

### 被排除的項目

- **獨立 Stage 3b dupcheck judge**：評估過但拒絕（見 design.md §1）。塞進 factlib judge 比較省 pipeline 架構改動。
- **hard-block on FAIL**：dupCheck FAIL 會讓 Stage 3 整體 FAIL，workers 下輪改寫；但 dupCheck 的「正確行為」是 `allow` 時 10 分，不是「擋不擋」。真正的 BLOCK 動作留給 Level F gate。
- **替換 v1 Librarian 的 dupCheck 角色**：v1 Librarian 的 sourceAlign 跟 attribution 維度不改；Level E 只在 v2 pipeline 加新維度。
- **接上 Level F dedup-gate**：Level F 的 pre-publish gate 是另一條路線（pre-tribunal），Level E 只處理 Stage 3 judge 維度。

## Impact

### Affected specs

- `librarian-dupcheck`（新 capability）

### Affected code

- `src/lib/tribunal-v2/types.ts` — `FactLibJudgeOutput.scores` 加 `dupCheck`
- `src/lib/tribunal-v2/pass-bar.ts` — `checkFactLibPassBar` 加第三個獨立 pass 條件
- `.claude/agents/v2-factlib-judge.md` — 新增 dupCheck 評分 rubric + few-shot 指引
- `scripts/eval-dedup-harness.mjs` — 加 `--run` 模式 + per-category precision/recall + markdown report
- `tribunal/fixtures/README.md` — 更新狀態：「Level E 已接上 judge」

### Affected agents

- `v2-factlib-judge` —— 多一個評分維度 + 要讀 fixture 當 few-shot
- `v2-librarian-worker` —— **不改**。dupCheck 是 judge 評分行為，不是 worker 動手行為。
