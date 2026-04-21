## Context

Level A–D 已經建好 dedup 的 taxonomy / policy / frontmatter / fixture 四塊骨架。Level E 要把這套抽象規則「接到 tribunal v2 的實際審稿流程裡」，作為每篇稿子發佈前的第一道自動判讀。

Tribunal v2 的 Stage 3 現在是 worker-first 架構：FactCorrector（改事實）→ Librarian（加連結）→ FactLib Judge（評 fact + library，各自獨立 pass bar）。Librarian worker 沒有評分職責，它只「做事」；FactLib Judge 才是評分入口。

本文件記錄 Level E 關鍵的設計取捨。

## 關鍵設計決策

### 1. dupCheck 屬於 Judge（評分維度），不屬於 Worker（動手動作）

**決策**：把 `dupCheck` 加在 `v2-factlib-judge` 的 scores 上，不在 `v2-librarian-worker` 加動作。

**被拒絕的替代方案 A — 新開獨立 Stage 3b dupcheck judge**
塞成獨立 stage 最乾淨（pipeline 責任更分明），但代價是：
- 要改 `pipeline.ts` 新增 `runStage3B()` 跟對應的 `stage.status` 狀態機
- 要新增 runner / timeout / git commit hook
- 要改 `BaseJudgeOutput` 家族的 stage map

整體改動面大，只是為了把一個評分維度隔離。Level E 的 scope 不該開這麼大的洞。

**被拒絕的替代方案 B — 讓 Librarian worker 回傳 dupCheck 判決**
Librarian worker 的職責是「動手加 link」，不是「評分」。讓它多一個 scoring output 違反「worker 動手 / judge 評分」的 v2 架構原則。而且 worker 回傳的 output 不會直接影響 stage pass/fail —— 要影響 pass/fail 就必須走 judge 層。

**被選方案 C — 擴 FactLib Judge 的 scores**
FactLib Judge 本來就已經在 Stage 3 末端評 fact 跟 library，再多一個 dupCheck 維度是最小改動：
- `FactLibJudgeOutput.scores` 加一個 `dupCheck` 欄位
- `v2-factlib-judge.md` prompt 加一段 rubric 跟 few-shot 指引
- `pass-bar.ts` 的 `checkFactLibPassBar` 加第三個獨立 pass 條件

**理由**：符合 v2 「worker 做事 / judge 評分」分工原則；最小 pipeline 架構改動；後續 Level F gate 若要共用 dupCheck 邏輯，可以把 judge rubric 跟 gate rule 抽共用函式，不會因為 stage 切太細反而變難複用。

### 2. 三個 pass bar 獨立，互不補償

**決策**：Stage 3 整體 pass = `fact_pass AND library_pass AND dupCheck_pass`，三者 AND 關係，任何一維不過整體不過。

**被拒絕的替代方案**：把 dupCheck 塞進 library composite 一起算（`library_composite = avg(linkCoverage, linkRelevance, dupCheck)`）。

**理由**：dedup 是跟 library linking 完全不同性質的問題 —— linking 是「有沒有把 glossary 連起來」，dupCheck 是「整篇要不要發」。合併計算會讓好的 linking 分數補掉重複判定的失誤，違反 v1 FactLib 設計時立下的「fact 不能補 library 反之亦然」原則。

獨立 pass bar 的設計更可預測：debug 時直接看是哪一維掛了，不用拆 composite 反推。

### 3. Few-shot 範例從 fixture YAML 讀，不 hard-code 在 prompt 裡

**決策**：`v2-factlib-judge` 的 prompt 指示 judge 在工作開始時先讀 `tribunal/fixtures/{class}/*.yaml`（每類挑 1 筆當 few-shot），不把 fixture 內容寫死在 agent .md 裡。

**被拒絕的替代方案 A — 把 few-shot hard-code 在 agent .md 裡**
維護痛苦：新增一筆 fixture 要同時改 agent .md 跟 YAML，容易漂移。而且 agent .md 會膨脹成幾千行。

**被拒絕的替代方案 B — 由 evaluator 腳本把 fixture 注入 prompt**
可行但需要改 runner 層給 fixture 注入機制。Level E 先用簡單方案：agent 自己用 Read tool 讀 fixture。

**理由**：fixture YAML 是 SSOT，Ralph Loop 不改它、凍結原則寫在 spec 裡，judge 每次 fresh session 讀進來當上下文最可靠。Judge 用 Read tool 讀 YAML 不算成本 —— 本來就要讀 article 跟 glossary，多讀幾個檔案負擔可以忽略。

### 4. `expectedAction` → `dupCheck` score 的對映

**決策**：judge 的 dupCheck score 評的是「判決正確與否」，不是「這篇該 BLOCK 還是 allow」。fixture 的 `expectedAction` 是 ground truth，judge 要做的是「辨認這篇屬於哪一類，應該走哪個 action」。

Rubric：
- **10**：clean-diff，放行無疑義（主題類似但有獨立貢獻 / 切入角度，無須 cross-link）
- **8**：正確識別為 hard-dup / soft-dup / intentional-series 並給對應 verdict（BLOCK / WARN / allow）
- **5**：邊界案例 —— judge 看得出有重疊但類別不確定，保守給 WARN
- **2**：誤判（clean-diff 被當成 dup 誤殺，或 hard-dup 被放行）

Pass bar：`dupCheck >= 8`。

**被拒絕的替代方案**：讓 judge 直接回 `verdict: BLOCK | WARN | allow`，不回數字分數。

**理由**：v2 所有 judge 輸出都是數字 score，合流 pattern 要一致。數字 score 也比較容易跟其他 judge 合成 composite（雖然 Stage 3 的 pass bar 是獨立，但 UI layer 可能想 aggregate）。

### 5. Eval harness 擴充策略 — 兩階段模式

**決策**：`scripts/eval-dedup-harness.mjs` 保留「只 schema 驗證」的預設行為，加 `--run` flag 才呼叫 judge 算 precision/recall。

**被拒絕的替代方案**：預設就跑 judge。

**理由**：
- 每次 pre-commit / CI 跑 judge 會打 LLM，太貴太慢（fixture 4 筆 × judge 每筆數十秒）
- Level D 的 CI gate 已經靠 schema validation 把關 fixture 品質，不需要每次 commit 都跑 judge
- `--run` 模式是「評估 judge 品質」的工具，由人類或 Level E 驗收時按需跑，不綁 pre-commit

### 6. Per-category precision + recall 計算方式

**決策**：四類各自計算 precision 跟 recall，共 8 個數字。

對每個類別 `C`（例如 `hard-dup`）：
- **Precision(C)** = `| judge 判 C 且 expected = C |` / `| judge 判 C |`
- **Recall(C)** = `| judge 判 C 且 expected = C |` / `| expected = C |`
- 分母為 0 時標記 `n/a`

**被拒絕的替代方案**：單一 overall accuracy。

**理由**：在 Level D 的 spec 裡已經明文禁止「僅回報 overall accuracy」（spec R4）。hard-dup 漏抓 vs. clean-diff 誤殺的代價差很多，per-category 才能看出 judge 偏在哪個方向。

### 7. Judge 讀 corpus 不讀全文，只讀 frontmatter + 首 300 字

**決策**：judge prompt 要求比對稿件 vs. corpus 時，只讀 corpus 每篇的 frontmatter + 首 300 字（跟 fixture `contentSnapshot` 對齊）。

**理由**：
- 避免 judge 讀 920 篇全文，token 成本爆炸
- Fixture 的 `contentSnapshot` 就是 200-400 字，judge 在真實稿子上用同樣的範圍判斷，訓練 / 評估分佈一致
- 若 judge 真的需要看更深的內文，可以用 Glob + Read 針對性讀，不需要 bulk load

### 8. Judge corpus scope — 只讀 `src/content/posts/*.mdx`

**決策**：judge 比對 corpus 時 SHALL 只讀 `src/content/posts/**/*.mdx`，SHALL NOT 讀 `tribunal/fixtures/**/*.yaml` 以外的測試資料。

**理由**：fixture 是題庫不是 corpus。Judge 審稿時應該模擬正式環境 —— 就算是在跑 evaluator，judge 也應該對著真正的 corpus 比對。Fixture 的 `corpusSnapshot` 是評估時提供的凍結版 corpus snapshot，evaluator 腳本負責把對應 snapshot 餵給 judge（via prompt context），judge 本身不直接讀 fixture YAML 當 corpus。

## 未定案項目

- **Level F dedup-gate** 是否共用 dupCheck rubric：Level E 先各寫各的，等 Level F 真的要做時再看要不要抽共用。
- **dupCheck 的 timeout**：sharing `TIMEOUT.JUDGE_FACTLIB` 應該夠，但若實務上 judge 因為多讀 fixture 變慢，可能要提升。Level E 第一次跑完看實測再調。
- **Fixture 擴展到 > 4 筆後**：few-shot 挑選策略會變難（每類挑 1 筆還是挑 k 筆？）。現在 4 筆全塞進 prompt 可行，未來再設計 selection heuristic。
