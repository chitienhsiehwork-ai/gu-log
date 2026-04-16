## Context

此 change 的 proposal.md 闡述「為什麼要做」。本文件記錄「怎麼設計的」— 具體的 trade-off、被拒絕的替代方案、特定參數值的來源。Level A + Level B 教學討論的結論在此 crystallize。

## Design Principles 總覽

五條設計原則驅動整個 dedup 系統設計。#1 已納入 `dedup-taxonomy/spec.md`；#2–#5 納入 `dedup-policy/spec.md`。

| # | 原則 | 範圍 |
|---|---|---|
| 1 | 離散標籤優於 fuzzy weighting（連續維度例外） | taxonomy 結構 |
| 2 | BLOCK 嚴格度 MUST 有 escape hatch | policy 規則設計 |
| 3 | AI slop 為首要設計敵人 | policy 目的性 |
| 4 | LLM 為 ground truth，其他 metric 只當 pre-filter | policy 判定機制 |
| 5 | Override 必留 audit trail | policy override 機制 |

## 關鍵設計決策

### 1. 離散標籤優於 fuzzy weighting（Principle #1）

**決策**：Taxonomy 的 categorical 維度使用 enum；fuzzy scoring 只保留給本質連續的維度（如時間間隔、內容重疊度百分比）。

**被拒絕的替代方案**：在 author type 上加權重（例如 `individual ↔ org match = 0.3 weight`）。此設計引入隱藏 tuning 旋鈕和不透明度。

**理由**：規則必須對 writer 可解釋（「你這篇被擋是因為 X」）、可 unit test、可人工推翻。Fuzzy weighting 三點都犧牲。User 在 Level A-4 MCQ 時自己講出這個直覺：「C 感覺有合理部分，但邏輯難到靠杯，我偏好 B」。

### 2. 時間不製造 duplicate

**決策**：Post 的年齡 SHALL NOT 單獨觸發 `deprecated` status。只有 cluster 內被另一篇取代才 deprecate。

**被拒絕的替代方案**：自動 deprecate 老的 event-driven post（例如「GPT-4o 發佈文過一年就 deprecate」）。此設計混淆了兩種獨立關切：dedup（cluster 內重疊）跟 UX/routing（首頁顯示哪些 post）。

**理由**：老的 event post 是歷史紀錄。首頁隱藏邏輯屬於 routing layer，不屬於 dedup。

### 3. 同作者規則的時間梯度（B-3-A）

**決策**：時間間隔用梯度 BLOCK / WARN / INFO，而非 binary 門檻。

**Individual 參數**：
- 1–7 天 `BLOCK`
- 8–14 天 `WARN`
- 15–30 天 `INFO`
- `>30 天` 不觸發

**Org 參數**：
- 1–3 天 `BLOCK`
- 4–7 天 `WARN`
- 8–14 天 `INFO`
- `>14 天` 不觸發

**被拒絕的替代方案**：Binary 門檻（例如「14 天、70% 一律觸發」）。

**理由**：時間間隔本質連續（Principle #1 允許連續維度加權）。Binary 門檻會有 boundary 效應 — 13 天跟 15 天行為完全不同，但語意上沒差異。梯度符合直覺。

**參數來源**：
- 7 天 = 人類寫手「新思考 cycle」的實務下限
- 14 天 = 兩週，涵蓋大多數「連續獨立寫作 session」
- 30 天 = 一個月，考慮 post 相關的實務上限
- Org 變體壓縮是因為組織的 posting rhythm（產品更新、研究發佈）本就比個人更密

這些是 sense-based 初始值。Level D evals 會校準。

### 4. Individual vs org 參數分離

**決策**：個人跟組織使用**不同**參數組（個人 14 天 / 70%；組織 7 天 / 85%）。

**被拒絕的替代方案 A**：同一組參數。組織的正常 product-update cycle 會被誤判。

**被拒絕的替代方案 B**：豁免組織完全不查。組織也會產出 AI slop（collaborative LLM-assisted content 會主題重複）。

**理由**：組織 posting rhythm 本就較密，個人預期更高的獨立性。兩者 normal baseline 不同 → 不同門檻。

### 5. LLM 為 ground truth，embedding 為 pre-filter（Principle #4）

**決策**：最終判定一律由 LLM 做。Embedding cosine 只用於 O(n²) retroactive scan 的 pre-filtering。

**被拒絕的替代方案 A**：純 Jaccard。無法跨語言抓語意重複（zh-tw vs en 翻譯文）。

**被拒絕的替代方案 B**：純 LLM 到底。在 n = 487 post，全 pairwise = 118k 次 LLM call，成本 $100–$1000+ 不可負擔。

**理由**：
- **預發佈 gate（Level F）**：候選 3–5 篇 → LLM 直判
- **Retroactive scan（Level G）**：一次性 precompute embedding → cosine matrix → top-K nearest → LLM 對 top-K 最終判定

**Jaccard 完全下線** — embedding 在相似成本下語意保真度更高。User 明確偏好 LLM 判斷（「for Q2, i prefer LLM 判斷」），此設計保留偏好同時解決 scale 問題。

### 6. BLOCK 必有 escape hatch（Principle #2）

**決策**：每條 `strictness = BLOCK` 規則 SHALL 有 explicit 且 auditable 的 override。

**被拒絕的替代方案**：沒有 escape 的硬擋。Writer 會 hack 繞過（改檔名、拆文、關 gate 跑一次）。Policy 變成 fiction。

**理由**：Human override 對 edge case 是必要的。正大光明設計 override（留 audit trail）優於讓 hack 累積成 tech debt。User 在 B-1 MCQ 時捕捉到這個直覺：「看起來也是因為留了活路？」

### 7. Override audit trail（Principle #5）

**決策**：每次 override 留雙重痕跡 — frontmatter + git commit + tribunal metadata。

**被拒絕的替代方案**：Silent override（bypass flag 不要求 justification）。

**理由**：Gu-log 是單人編輯站。Audit trail 是未來的 user（或未來分析模式的 AI）理解過去決策的唯一方式。沒有 audit trail，「為什麼 override 這篇」變成考古學。

### 8. Commentary 間互檢（B-2-C）

**決策**：同 cluster 內 commentary 互相檢查 thesis 重疊。

**被拒絕的替代方案**：Commentary 完全豁免 dedup（允許無限 angle）。

**理由**：AI-assisted commentary 生成會把 cluster 灌滿近重複觀點。User 明確反映此情境：「reader 看到 20 篇 commentary 有 10 個重複 idea，會覺得 wtf is this author doing, just letting AI keep generating slop?」符合 Principle #3。

**實作細節**：「thesis 重疊度」判定仰賴 LLM（Principle #4），具體門檻跟 prompt 留到 Level E（Librarian dupCheck 維度）定案。

### 9. AI slop 為首要設計敵人（Principle #3）

**決策**：所有規則設計都圍繞「防 AI 生出近重複內容」，不只是防人工重複。

**Context**：Gu-log 是 AI-assisted editorial 站。Clawd VM 自動產 CP post；Ralph Loop 反覆改寫；subagent 翻譯。每個 layer 都可能產生 convergent 輸出。沒有主動防守，corpus 會自然漂移向 repetition。

**規則層面的反映**：
- B-2-C（commentary 間互檢）— 防同 AI 灌 cluster
- B-3-A（同作者湧現梯度）— 防同作者 LLM 連發
- Individual vs org 參數分離 — 因應不同 AI slop profile
- Concept cluster 的 post 量提醒（規劃中，Level F）— 防特定 concept 被 AI 灌爆

### 10. Hybrid post 歸類（Level A-2 Q3）

**決策**：同時承載 event 跟 evergreen 成分的 post 以**內容重心**決定套用規則 — primary 成分占 >50% → 套 event 規則；否則套 evergreen 規則。

**被拒絕的替代方案**：Multi-label（post 同時套兩條規則）。會產生衝突（event 規則要 deprecate、evergreen 規則要 cross-link）。

**理由**：明確的 fallback，容易解釋。重心由寫手標註 `temporalType: event | evergreen | hybrid` 表明，hybrid 情境由 tribunal 判斷重心。

## 尚未定案（留給下游 changes）

1. **`independentDiff` 判定細節**（Level E）— Librarian prompt 怎麼寫？門檻怎麼定？
2. **LLM 模型選擇**（Level F）— Haiku 4.5 vs Sonnet 4.6 for gate / scanner？成本 vs 準度 trade-off？
3. **Evals 黃金資料集**（Level D）— HARD / SOFT / intentional-series / clean-diff 各種 case 的 ground truth，用於校準所有門檻
4. **Pipeline 整合點**（Level H）— CP / SP / Ralph Loop / tribunal 哪一步插 gate？失敗訊號怎麼向上傳？
5. **`thesis 重疊` 門檻**（Level E）— Commentary 間互檢的觸發門檻，需要 evals 校準

## 與既有系統的相容性

- `src/content/config.ts` 的 schema（`status`, `deprecatedBy`, `retiredReason`）已支援 deprecation，此 change 不動。
- `scripts/dedup-gate.mjs` 現有 3-layer gate（URL + Jaccard + intra-queue）將於 Level F 演進為 embedding + LLM cascade。Jaccard 淘汰。
- Librarian tribunal judge 將於 Level E 新增 `dupCheck` 維度，讀本 spec 作為 policy context。
