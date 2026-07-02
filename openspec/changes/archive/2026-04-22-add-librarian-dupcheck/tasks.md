## 1. 擴充 `FactLibJudgeOutput` 型別

- [ ] `src/lib/tribunal-v2/types.ts`
  - [ ] `FactLibJudgeOutput.scores` 新增 `dupCheck: number`
  - [ ] 註解補 dupCheck rubric 摘要
- [ ] `src/lib/tribunal-v2/pass-bar.ts`
  - [ ] `checkFactLibPassBar` 的 scores 參數加 `dupCheck: number`
  - [ ] 回傳型別加 `dupCheck_pass: boolean`
  - [ ] 計算 `dupCheck_pass = scores.dupCheck >= 8`
  - [ ] 整體 `pass = fact_pass AND library_pass AND dupCheck_pass`

## 2. 更新 `v2-factlib-judge` agent prompt

- [ ] `.claude/agents/v2-factlib-judge.md`
  - [ ] 新增「dupCheck 維度」scoring rubric 段落（10 / 8 / 5 / 2 四階）
  - [ ] 新增 few-shot 讀取指引：工作開始時 Read `tribunal/fixtures/{class}/*.yaml` 每類 1 筆
  - [ ] 新增 corpus 比對限制：frontmatter + 首 300 字，先用 clusterIds / seriesId / authorCanonical pre-filter
  - [ ] 更新 Pass Bar Calculation：加第三個 `dupCheck_pass = dupCheck >= 8`，整體 pass = `fact_pass AND library_pass AND dupCheck_pass`
  - [ ] 更新 Output Format 範例 JSON：加 `dupCheck` 欄位 + `judge_version: "2.1.0"`
  - [ ] 更新 description 頂部摘要（FactLib combined judge 現在評 5 個維度而非 4 個）

## 3. 擴充 `scripts/eval-dedup-harness.mjs`

- [ ] 解析 CLI：無 flag 走現行 schema validator 行為；`--run` 走 evaluator 模式
- [ ] `--run` 模式：
  - [ ] 對每筆 fixture 呼叫 `claude -p --agent v2-factlib-judge --dangerously-skip-permissions <prompt>`（透過 `spawn`）
  - [ ] Prompt 把 fixture 的 `inputPost` + `corpusSnapshot` 注入為「被審稿 + 凍結 corpus」
  - [ ] 拿 judge 輸出的 `FactLibJudgeOutput`，由 dupCheck 分數 + judge 在 improvements/critical_issues 留下的 verdict 推出 actualClass / actualAction
  - [ ] 跟 fixture 的 `expectedClass` / `expectedAction` 比對
- [ ] Per-category precision + recall：
  - [ ] 實作 confusion matrix（四類 × 四類 + N/A 處理）
  - [ ] 對每類算 P/R，分母 0 標 `n/a`
- [ ] 誤判清單：
  - [ ] 每筆誤判列 `slug / expectedClass / actualClass / expectedAction / actualAction / dupCheckScore / fixturePath`
- [ ] Markdown report：
  - [ ] 輸出路徑 `scores/dedup-eval-YYYYMMDD-HHMMSS.md`
  - [ ] 含：fixture 總數、四類分佈、confusion matrix、per-category P/R、overall accuracy、誤判清單
  - [ ] 若 `scores/` 目錄不存在則建立
- [ ] 退出碼：
  - [ ] schema 違規 → 1
  - [ ] `--run` 模式中 judge 呼叫失敗 → 2
  - [ ] 其他 → 0（即使有 fixture 判錯也 exit 0，因為錯誤判斷本身是評估結果、不是程式錯誤）

## 4. 更新 fixture README

- [ ] `tribunal/fixtures/README.md`
  - [ ] 「當前狀態」表加一行：Level E 已接上 `v2-factlib-judge` dupCheck
  - [ ] 「Level E 展望」段落改為「Level E 已完成」+ 指向 `openspec/specs/librarian-dupcheck/spec.md`
  - [ ] clean-diff outstanding 若仍缺 → 備註「Level E judge 能運作，但 clean-diff 缺一筆時 Precision(clean-diff) = n/a」

## 5. 驗證

- [ ] `openspec validate add-librarian-dupcheck --strict` PASS
- [ ] `pnpm exec astro check` PASS（types.ts / pass-bar.ts 改動）
- [ ] `node scripts/eval-dedup-harness.mjs` 預設模式 PASS（不破壞 Level D 行為）
- [ ] `node scripts/eval-dedup-harness.mjs --run` 能跑起來、輸出 markdown report（就算 judge 判錯也該 exit 0）
- [ ] 人工檢查 report 格式：含 per-category P/R、誤判清單、格式正確

## 6. 交接到 Level F

- [ ] Level F (`add-semantic-dedup-gate-layers`) 可開始設計 pre-publish gate
- [ ] Gate 的 semantic layer 判定可共用 dupCheck 的 rubric（或獨立寫，看 Level F 判斷）
- [ ] clean-diff 第 4 筆 fixture 若仍未補齊，Level F 要把它當 dependency 一併解
