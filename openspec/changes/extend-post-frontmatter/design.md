## Context

`add-dedup-policy`（Level A + B）定義了 dedup 五維 taxonomy 跟四條規則，但這些規則要能執行必須要有 frontmatter 欄位可讀。本 change 把 taxonomy / policy 的概念映射 (mapping) 到 Astro content collection 的 Zod schema。

本文件記錄在 Level C-1 ~ C-4 討論中定案的設計取捨。

## 關鍵設計決策

### 1. 必填欄位的劃分原則

**決策**：「post 本身屬性」必填（`sourceType`、`temporalType`、`authorCanonical`、`authorType`、`clusterIds`）；「dedup 情境觸發物」選填（`seriesId`、`dedup.*`、`metadata.gateWarnings`）。

**被拒絕的替代方案 A**：全部必填。既有 922 篇會整批 build 失敗。

**被拒絕的替代方案 B**：全部選填。`sourceType` 沒填 → B-2-B 規則根本算不出來，沉默的 bug 比 build 失敗更糟。

**被拒絕的替代方案 C**：只 required `sourceType` + `authorCanonical`。漏掉 `clusterIds` → 「同 cluster 內」這個 policy 前提無法成立。

**理由**：必填對應「這篇 post 本來就有這個屬性」（戶籍類資料）；選填對應「只有觸發規則時才出現」（違規紀錄類）。強迫後者必填會讓 99% 的 post 都填 null，語意髒掉。

### 2. Schema 驗證的邊界

**決策**：Schema 只做「一篇 post 內部不自相矛盾」的 cross-field invariants。規則判定（需要讀其他 post 或呼叫語言模型）全部留給 dedup-gate 跟 tribunal。

**被拒絕的替代方案 A**：把 policy 規則全寫進 Zod refine。Zod 無法呼叫語言模型、無法讀其他文章，強寫會癱瘓或 false positive。

**被拒絕的替代方案 B**：schema 完全不做 invariant 檢查，連 `deprecated` 但缺 `deprecatedBy` 都不管。產生孤兒狀態難以除錯。

**理由**：schema 擅長 structural 檢查；跨文章判定本來就要由 dedup-gate 負責。分層清楚 —— schema 看單兵，gate 看部隊。

**一句話**：schema 在 build 階段跑，不能慢、不能錯、不能呼叫外部服務；gate 在 publish 階段跑，允許慢、允許呼叫語言模型、允許有 reasoning log。

### 3. `clusterIds` 允許空陣列

**決策**：`clusterIds: z.array(z.string())`，空陣列 `[]` 合法，代表「目前未納入任何 cluster」。

**被拒絕的替代方案**：`clusterIds` 必須至少一個 element。

**理由**：獨立 standalone post（真正 evergreen、無既有 cluster 可歸）必然存在。強迫有 element 會逼 writer 亂塞假 cluster，污染 cluster 語意。之後如果發現某 post 屬於某 cluster 再補即可。

### 4. `authorType: 'proxy'` 的必要性

**決策**：`authorType` 三值：individual / org / proxy。proxy 代表「轉述者」（翻譯、轉寫、二手 thread 整理）不是真正作者。

**被拒絕的替代方案**：只保留 individual / org。把 proxy case 併入 individual。

**理由**：proxy case 在 gu-log 常見 —— 有人轉寫 Anthropic blog 的 thread、有人翻譯某篇論文。這時 `authorCanonical` 是原作者（Anthropic / 論文作者），`author` 欄位是轉寫者。B-3-A 同作者規則只能看真正作者（`authorCanonical`），不能看轉寫者，否則會把「多位不同作者的轉寫」誤判成「同一作者連發」。

**Invariant**：`authorType = proxy` → `author` 欄位不可等於 `authorCanonical`（否則 proxy 身分無意義）。

### 5. 遷移策略 — 硬性一次到位（A 方案）

**決策**：走 A 方案。`.optional()` 只當短期施工支架，backfill 完立刻拆掉變必填，不允許長期保留。

**被拒絕的替代方案 B**：永久保留 `.optional()`，反正以後新文章會填。

**被拒絕的替代方案 C**：漸進三段，`.optional()` 維持一段時間再提升。

**理由**：
- gu-log 是單人經營、無客戶 SLA，停 build 一天沒有商業代價
- 永久 `.optional()` 會讓寫作者養成「反正可以不填」的心態，3 個月後新寫的 post 也開始缺欄位
- 漸進策略是為多人協作 + 客戶 SLA 設計的，gu-log 不需要付這個 overhead

User 在 Level C-4 MCQ 中明確選擇 A：「because gu-log → 單人經營，沒有客戶 SLA」。

### 6. 分批 commit 的批次大小

**決策**：每 50 篇一 commit。

**被拒絕的替代方案 A**：全部一個 commit（atomic）。

**被拒絕的替代方案 B**：每篇一 commit。

**理由**：
- 單一 commit 922 篇檔案改動太大，code review 跟 revert 都難
- 每篇一 commit 會在 git log 塞 922 個 commit，污染歷史
- 50 篇是平衡點：掛了重跑損失可控（最多損失 49 篇的算），revert 顆粒度也合理

### 7. 抽檢機制 —— 隨機 30 篇

**決策**：語言模型跑完一批 50 篇後，隨機抽 30 篇給 user 審。通過整批放行。

**被拒絕的替代方案 A**：語言模型跑完直接寫回，不抽檢。

**被拒絕的替代方案 B**：每篇都要 user 逐篇打勾。

**理由**：
- 不抽檢 = 讓語言模型幻覺污染 922 篇 frontmatter，事後查 bug 會痛苦
- 逐篇打勾 = user 疲勞 + 失去遷移速度優勢，實務上 user 會草率勾選
- 隨機 30 篇 = 統計上夠抓系統性錯誤（例如語言模型 consistently 把某類主題誤判），又不會壓垮 user

Note：抽檢對象的隨機種子 SHALL 固定以便重跑（以該批次的 git tree SHA 為種子），避免同一批審過的 30 篇下次重跑變另外 30 篇。

### 8. 事後誤判當場改

**決策**：遷移完成後發現誤判 → 當場改那一篇，commit 訊息 `fix: 修正 <ticketId> 分類`。

**被拒絕的替代方案 A**：累積批次改。

**被拒絕的替代方案 B**：加 `needsReclassification` 欄位標記可疑 post，之後批次掃。

**理由**：
- 單人經營沒批次處理的協調優勢
- 每個誤判獨立發生，批次改沒效率
- 新增 `needsReclassification` 欄位 = 為一次性需求留永久 schema 噪音，違反 Principle #1（discrete / 不要模糊中間狀態）

## 與既有 schema 的相容性

- `src/content/config.ts` 既有的 `status: published | deprecated | retired`、`deprecatedBy`、`retiredReason` 等欄位 SHALL 保留不變
- 既有的 `series: { name, order }` 欄位 SHALL 保留作為「series 顯示用中繼資料」；新增的 `seriesId` 是獨立 key，用於 dedup 豁免比對。兩者不衝突
- 既有的 `warnedByStage0` / `warnReason`（tribunal v2）SHALL 保留不變；新增的 `metadata.gateWarnings` 是 dedup-gate 專用

## 尚未定案（留給下游 changes）

1. **`clusterIds` 的 cluster 命名規範**（Level E / G）—— 誰產生 cluster ID、格式是什麼、誰負責維護 cluster canonical list
2. **`authorCanonical` 正規化規則**（Level C 執行階段決定）—— e.g., twitter handle lowercased、domain 去 www.、org 名用 slug；統一由 `scripts/backfill-dedup-frontmatter.mjs` 的第一階段 deterministic extraction 實作
3. **backfill 的具體 prompt**（Level C 執行階段決定）—— 語言模型補 `temporalType` 跟 `clusterIds` 的 prompt 格式、輸出結構、error handling
4. **`commentaryAngle` 的標準列表**（Level E）—— 當 B-2-C 比對 commentary 重疊時要能對到，需要一份 canonical angle 列表或允許自由描述

## 為什麼現在做

Level D / E / F 都需要讀這些欄位才能動工：

- **D（evals）**：golden dataset 的每筆 case 要能標出 `sourceType` / `clusterIds` 預期值，沒有 schema 就標不了
- **E（Librarian dupCheck）**：tribunal judge prompt 要 reference 這些欄位
- **F（semantic dedup-gate layers）**：gate 讀這些欄位做規則判定

本 change 是後續四個 change 的前置依賴 (prerequisite)，優先級最高。
