## Context

Level A + B 定義了 dedup 五維 taxonomy 跟四條規則。Level C 把對應欄位擴充到 frontmatter schema。但 Level E (Librarian `dupCheck`)、Level F (gate 語義層)、Level G (corpus scanner) 這三個 change 都會引進數字門檻（embedding 距離、Jaccard 相似度、時間窗天數、主旨重疊比例），沒有客觀基準就沒有辦法校準。

本 change 先建 eval harness —— 把已知案例凍結成 fixture，供 Level E/F/G 調參時使用。

本文件記錄 Level D-1 ~ D-5 討論中定案的設計取捨。

## 關鍵設計決策

### 1. Fixture 目錄 `tribunal/fixtures/` 獨立於 post tree

**決策**：fixture 住在 `tribunal/fixtures/`，與 `src/content/posts/` 完全分離。

**被拒絕的替代方案 A**：fixture 放在 `src/content/fixtures/`，讓 Astro 統一管理。失敗原因：Astro content collection 會試圖 render，且 Ralph Loop 的 file glob 容易誤傷。

**被拒絕的替代方案 B**：用 post frontmatter 的特殊欄位（例如 `isFixture: true`）標記。失敗原因：同一個 post 不能同時是 live content 又是 frozen fixture；兩者生命週期相反。

**理由**：tribunal 長期會以 24 小時 cron 跑，觸發 post 重寫。若 fixture 指回 post slug 或住在 post tree，Ralph Loop 一跑就污染 fixture，失去 reproducibility。獨立目錄 + 凍結 convention 是唯一乾淨解。

### 2. Fixture 格式為 YAML，不是 JSON / MDX

**決策**：每筆 fixture 一個 `.yaml` 檔。

**被拒絕的替代方案 A**：JSON。失敗原因：fixture 內含多行 post 內文 + 多行 humanReasoning，JSON 不支援註解、多行字串全靠 `\n` 拼接，人讀人寫都痛苦。

**被拒絕的替代方案 B**：MDX。失敗原因：MDX 是 render 用格式，fixture 只是資料、不 render。用 MDX 拖進 Astro content collection 又回到決策 1 要避免的問題。

**被拒絕的替代方案 C**：每筆 fixture 一個目錄 + 拆多檔（`input.md`、`corpus/*.md`、`answer.yaml`）。失敗原因：一筆 fixture 拆四五個檔，新增 / 檢視都麻煩，且 `corpus/` 內的 markdown 仍可能被誤當成 content 處理。

**理由**：YAML 是配置檔通用格式，支援多行字串 block、支援註解、Astro 生態已經在用（Starlight、content config 衍生）、純資料不會被 Astro content collection 誤當 post 處理。

### 3. Fixture 目錄結構依 `expectedClass` 分子目錄

**決策**：`tribunal/fixtures/{class}/{slug}.yaml`，其中 `{class}` 為四種 `expectedClass` 之一。

**被拒絕的替代方案**：flat 目錄全部塞在 `tribunal/fixtures/{slug}.yaml`，靠 fixture 內的 `expectedClass` 欄位分類。

**理由**：flat 目錄無法一眼看出某分類有幾筆、是否缺 coverage。分目錄 + evaluator 啟動時檢查每目錄至少 1 筆，coverage gap 立刻可見。

### 4. `contentSnapshot` 不收全文，只收 title + summary + lead paragraph

**決策**：`corpusSnapshot[].contentSnapshot` 跟 `inputPost.contentSnapshot` 只保留約 200-400 字足以判斷重複的片段。

**被拒絕的替代方案 A**：收全文。失敗原因：一篇 post 平均 1500-3000 字，fixture 收全文 + 5 篇 corpusSnapshot = 單檔 20KB+，fixture 集合膨脹後 git diff 難以審閱。

**被拒絕的替代方案 B**：只收 title。失敗原因：Librarian 判定重複本來就需要讀內文細節，光看 title 無法模擬真實 dupCheck 情境。

**理由**：Librarian 實際執行 `dupCheck` 時要判斷的就是「摘要 + 開頭 = 兩篇有無撞」。用這個長度的 snapshot 足以模擬，同時把 fixture 檔案控制在可讀範圍。

### 5. 初始 bootstrap 3 筆 + clean-diff 1 筆 outstanding

**決策**：archive 前硬性要求 3 筆（Gemma 4 / Mythos / Karpathy），clean-diff 1 筆列為 outstanding，可延至 Level E 開始前補齊。

**被拒絕的替代方案 A**：全 4 類一次到位。失敗原因：Gemma / Mythos / Karpathy 都是已解決案例，標準答案明確；clean-diff 目前 corpus 內沒有已判決的 clear case，強求一次到位會逼手刻 synthetic fixture，品質比延後補真實案例差。

**被拒絕的替代方案 B**：3 類即可，clean-diff 整個從 eval harness 拿掉。失敗原因：該分類是 precision 這邊的代表 —— 沒有 clean-diff 就無法驗證「系統不會過度擋」。

**理由**：clean-diff 暫缺不致命（三類已經可驗 recall），但必須在 Level E 前補齊（Librarian `dupCheck` 若無 clean-diff 對照，會調成過嚴的模型）。列為 outstanding、綁 Level E dependency 是合理 trade-off。

**補充（Level D 執行階段調整）**：原規劃 Karpathy trilogy (CP-36/116/137) 做 intentional-series 代表，但 session memory 實際把三篇判為 SOFT-DUP（不同 source event、不同 core metaphor、只是同作者）。執行時改採 ECC "Everything Claude Code 全解析" 系列（SP-143 / SP-144 / SP-151，每篇顯式宣告 `series: { name, order }`），這是 intentional-series 更乾淨的案例 —— 有 explicit declaration，跟 B-3-A override 規則的 `seriesId` 對應點更清晰。

### 6. 評估指標 per-category precision + recall，overall accuracy 僅作補充

**決策**：evaluator 主要輸出 per-category precision + recall。overall accuracy 允許顯示但不能取代 per-category 數字。

**被拒絕的替代方案 A**：只看 overall accuracy。失敗原因（Level D-4 MCQ 討論過）：HARD-DUP 漏抓的代價 ≠ clean-diff 誤殺的代價，單一分數掩蓋方向性錯誤。

**被拒絕的替代方案 B**：複雜加權分數（HARD 答錯 3 分 / soft 答錯 1 分 / ...）。失敗原因：加權比例本身又是一個無客觀依據的參數，引進新的瞎猜問題。

**理由**：per-category precision + recall 是最誠實的呈現 —— 8 個數字（4 類 × 2 指標）直接攤開，使用者看完自己判斷「哪個方向不能妥協」。加權留給 Level E 真正要做決策時再引進。

### 7. Fixture 凍結靠 convention + commit message 自律，先不寫 hook

**決策**：Level D 不寫 pre-commit / pre-push hook 擋 `tribunal/fixtures/` 修改。僅定義 convention：Ralph Loop / tribunal runner 跳過該目錄；人類手動修正時 commit message 以 `fix(fixture)` / `chore(fixture)` 前綴標記。

**被拒絕的替代方案**：Level D 立刻寫 hook，禁止 non-interactive commit 改 fixture。

**理由**：hook 邏輯要判斷「是人類改的、還是自動化工具改的」並不容易（需要 env var / cli flag），寫不好反而擋到合法修正。Level G 統一重做 hook 時一併處理更乾淨。Level D 先靠 convention + Ralph Loop runner 自己跳過 `tribunal/fixtures/` glob。

## 未定案項目

- `contentSnapshot` 的精確長度上限（200? 400? 按 token 算？）—— Level D 執行階段看實際 3 筆 bootstrap fixture 決定。
- clean-diff 那筆 fixture 要用哪個 corpus case —— Level E 開始前再挑。候選：CP-7 / CP-12 / CP-32 (Claude Code workflow 三篇) 若 Librarian 判定為 clean-diff，可擷取；或從 corpus 掃描中挑一對明顯不重複的。
- evaluator 的實際命令列介面（輸出 JSON？markdown 報告？stdout table？）—— Level E 要用時再定；Level D 只約束「per-category precision + recall 必出」。
- 若未來 fixture 數量 > 50 筆，是否需要子分類（例如 `hard-dup/cross-source/` vs `hard-dup/republish/`）—— 現在 3 筆不需要，先保留 flat 設計。
