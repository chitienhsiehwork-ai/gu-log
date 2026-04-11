# Devil's Advocate Review: Tribunal v2 Mental Model

> Reviewer: Devil's Advocate
> Date: 2026-04-09
> Updated: 2026-04-10 (Decision Log after CEO level-up session)
> **Status: DECISIONS LOCKED** — ready for Builder handoff

---

## 目錄

- [Part 1: Decision Log](#part-1-decision-log-2026-04-10) — 最新決策（讀這個就夠）
- [Part 2: Original Challenges](#part-2-original-challenges-2026-04-09) — 原始分析（參考用）
- [Part 3: Appendices](#part-3-appendices) — Judge schemas / scripts / UI mock
- [Part 4: Handoff Notes](#part-4-handoff-notes) — 給 Builder 的下一步

---

# Part 1: Decision Log (2026-04-10)

> 這個 section 是 CEO 跟 Devil's Advocate 跑完 8-level level-up session 後的最終決策。
> 每個 Level 對應 Part 2 的挑戰清單。

## Level 1: Vibe-First 事實炸彈

**挑戰**: Stage 1 Opus 大改文章時會引入新事實錯誤，Stage 3 Sonnet 用弱 model 修強 model hallucination。

**決策**: 採用「constraints + source URL fetch」方向，但有重要修正 —

- Stage 1 Vibe writer 的 constraint 是 **magnitude/direction 不能錯**，不是 lexical 精準
- 允許為了 vibe 做合理近似（如 `40% → "將近一倍"` OK）
- 禁止離譜偏離（如 `40% → "十倍"` NOT OK，由 Stage 3 抓）
- Enforcement 不靠 pure programmatic diff，靠 Stage 3 FactCorrector + source URL 的語意檢查
- ClawdNote 裡的誇飾 analogy 完全免檢（那是 creative 不是事實）

**Philosophy**: vibe > factual precision, within reason. 讀者 engagement 比小數點精準重要。

---

## Level 2: FactCorrector 盲修

**挑戰**: Worker-first 設計讓 FactCorrector 第一輪沒有 judge feedback，可能改錯比沒改更糟。

**決策**: Direct fix (不 scan-only) + standing checklist + source URL fetch

- FactCorrector 第一輪直接動手改（保留 worker-first proactive design）
- 有 standing checklist 作為 rules（像 eslint config）
- Fetch source URL 對照原文（這是 game changer — 不再是盲修）
- **Scope**: 文章 body + ShroomDogNote，**排除** ClawdNote
- 不確定的就 flag 不改（判斷標準：magnitude/direction 對即可，不追求 decimal）

**Standing Checklist (初稿)**:
```
1. 數字/百分比 → 跟 source URL 原文比對
2. 技術名詞拼寫 → 查正確寫法
3. 時間/日期/人名/公司名 → 跟 source 比對
4. 技術宣稱 → source 有就保留，source 沒有且自己不確定就 flag
5. ClawdNote 裡的一切 → SKIP（creative scope）
6. ShroomDogNote 的 hedge words (我想/應該/大概) → 保留，不要改成肯定句
7. 不確定 → flag + 附上理由，不要改
```

---

## Level 3: Writer Constraints Enforcement

**挑戰**: LLM 不可靠地遵守 negative constraints，「只能微調語氣」prompt 是 wishful thinking。

**決策**: Structural vs semantic 分開處理

| Constraint 類型 | 例子 | Enforcement |
|---|---|---|
| **Structural** | URL、heading 順序、glossary link 存在、frontmatter | Programmatic diff check (lexical 比對) |
| **Semantic** | 數字 magnitude、技術宣稱方向 | Stage 3 FactCorrector + source URL 語意檢查 |

**ShroomDogNote special rule**: fact-check claims 內容，但**保留 hedge words**（「我想」「應該是」「我的看法啦」「大概」）。Calibrated uncertainty 本身就是一種「準確」，不是弱弱的用字。

**如果 ShroomDog 用肯定語氣說了不確定的事** → flag 給 judge，建議加 hedge。

---

## Level 4: Model 選擇 — All-Opus Pipeline

**挑戰**: Haiku 當 FreshEyes judge 可能判斷力不足；弱 model 不等於新手視角。

**決策**: **全部升級到 Opus** — All-Opus pipeline

| Stage | Agent | Original | New |
|---|---|---|---|
| 0 | Worthiness judge | 待定 (Haiku?) | **Opus** `LUXURY_TOKEN` |
| 1 | Vibe judge + writer | Opus | Opus |
| 2 | FreshEyes judge | Haiku | **Opus** `LUXURY_TOKEN` |
| 2 | FreshEyes writer | Opus | Opus |
| 3 | FactCorrector | Sonnet | **Opus** `LUXURY_TOKEN` |
| 3 | Librarian | Haiku | **Opus** `LUXURY_TOKEN` |
| 3 | Combined Judge | 待定 | **Opus** `LUXURY_TOKEN` |
| 4 | Final Vibe judge + writer | Opus | Opus |

**Rationale**:
- Quota 目前充足 — 先買品質，撞牆再省
- 一致性優先：debug 時不用猜「是 model 弱還是 prompt 問題」
- 所有 `LUXURY_TOKEN` 標註未來降級路徑（見 Appendix B）

---

## Level 5: Pass Bar 設計

**挑戰**: 「至少一維 >= 9」在測什麼？均衡的好文章會被誤殺？2/3 fail rate 代表什麼？

**決策**: **保持現行 pass bar**（挑戰 6 收回）

```
composite >= 8 AND 至少一維 >= 9 AND 沒有任何維 < 8
```

- **整數制**下這是「創意 + 不漏洞」最準確的編碼
  - 「至少一維 >= 9」編碼了「要有亮點」（creative/fun）
  - 「全部 >= 8」編碼了「不能有短板」（no missing parts）
- 2/3 fail rate 不是 bug — 是對讀者時間的尊重
- **2026 年 attention economy philosophy**: 讀者每一秒都被 TikTok / Shorts / Twitter 搶走，一篇「沒硬傷但無聊」的文章等於白燒 token。High bar 是 feature。

**如果 2/3 fail rate 變成問題**，解決方向是改善 writer（更好的 prompt、更多 context）或增加 max_loops，**不是降低 bar**。

---

## Level 6: Final Vibe

**挑戰**: 每篇都跑完整 Stage 4 Opus judge 是不是浪費？小改動的文章根本不會變差。

**決策**: **保留 Stage 4 完整跑**（不 conditional、不 merge 到 Stage 3），但有 tuning

- **max_loops: 1 → 2**（writer 被綁得緊，一次失敗不代表不能救）
- **Pass bar 改成 relative** — 每個維度不能比 Stage 1 PASS 時低超過 1 分
- **On fail**: 不阻擋 publish，frontmatter 記錄 Stage 4 scores，UI 顯示 banner (`"Final Vibe: persona 9→7"`)
- ShroomDog 讀到 site 時手動決定：保留 / 手改 / 重跑
- 標 `LUXURY_TOKEN: 可改成 conditional (diff-size threshold)` 作為未來降級路徑

---

## Level 7: Stage 0 Gate + Banner/UI

**挑戰**: CP auto-reject 太武斷；worthiness 標準未定；Haiku judge 可能太弱。

**決策**: **透明實驗室模式** — AI 不確定變成 feature 而不是 bug

**Gate policy**:
- **All WARNING, no auto-reject** — 不分 CP / 非 CP，都不 auto-reject
- 所有 WARN 文章仍進入後續 pipeline
- Judge 用 **Opus** `LUXURY_TOKEN`
- Judge dimensions (建議): `coreInsight` / `expandability` / `audienceRelevance`

**Banner 設計** (CEO 已拍板):
- **Q1 顯示範圍**: 永久顯示 (不 dismiss)
- **Q2 拒絕理由**: Judge 同時產出兩個版本 — `internal_reason` (debug/tuning) + `reader_friendly_reason` (banner 顯示)
- **Q3 Feedback 收集**: 現有 giscus 留言系統 (IIRC — 待 Builder 確認掛載狀態)
- **Q4 Analytics**: 追蹤 WARN 文章的 `completion_rate` + `dwell_time` + `comment_count`，作為 judge tuning ground truth

**Banner content 方向** (詳見 Appendix C):
```
Clawd 的 AI judge 對這篇沒把握
Opus judge 覺得這篇可能不太適合登上 gu-log：
{{reader_friendly_reason}}
我們還在 tune gu-log 的 AI judge，你覺得這篇有沒有料？
歡迎下面留言告訴我們 (>w<)
```

**核心 insight**: `completion_rate` 是 Opus judge 永遠學不到的 signal — human behavior > AI judgment 作為 ground truth。

---

## Level 8: Pipeline Operational 收尾

**挑戰**: Worker sessions、git 策略、rollback、translation 時機。

**決策**:

| 項目 | 決策 |
|---|---|
| **Worker sessions** | **Split** — FactCorrector 先，Librarian 後（有因果依賴） |
| **Git strategy** | **Squash merge + commit message 嵌 stage summary**（scores, loop counts，未來用 `git log --grep` 找得到） |
| **Rollback** | **不做** — pipeline 往前走，最後 Stage 4 banner 顯示問題，ShroomDog UI 端決策 |
| **Translation timing** | **Auto** — zh-tw publish 後自動觸發 Stage 5 |

---

## 最終 Pipeline 全貌

```
文章進來
  ↓
Stage 0: Worthiness Gate (Opus judge, LUXURY_TOKEN)
  ├─ WARN → 繼續跑 + frontmatter 標 warnedByStage0 + reader_friendly_reason
  └─ PASS → 繼續
  ↓
Stage 1: Vibe (Opus judge + Opus writer, max 3 loops)
  Writer constraints: magnitude/direction 不能錯，vibe 近似 OK
  Pass bar: composite >= 8 AND 一維 >= 9 AND 全部 >= 8 (integer)
  ↓
Stage 2: FreshEyes (Opus judge + Opus writer, max 2 loops, LUXURY_TOKEN on judge)
  ↓
Stage 3: FactLib (Split sessions, all Opus, LUXURY_TOKEN 全部)
  ├─ FactCorrector: fetch source URL + standing checklist
  │   Scope: body + ShroomDogNote, exclude ClawdNote
  │   第一輪直接改（有 checklist + source URL），不確定就 flag
  ├─ Librarian: 跑在 FactCorrector 修改後的版本上
  └─ Combined Judge: fact_pass + library_pass 獨立計算
  Max loops: 2
  ↓
Stage 4: Final Vibe (Opus judge + Opus writer, max 2 loops)
  Writer constraints: programmatic diff check (URLs/headings/frontmatter)
  Relative pass bar: 不能比 Stage 1 退步 > 1 分
  On fail: 不阻擋 publish + UI banner
  ↓
Squash merge to main (commit message 嵌 stage summary)
  Remote branch 保留（方便 prompt tuning）
  ↓
Publish
  ↓
Stage 5: Translation (auto triggered)
```

---

## Cross-cutting Philosophies (浮現出來的核心設計哲學)

這些不是哪一關的決策，是整個 session 中反覆出現的價值觀：

1. **Vibe > factual precision, within reason** — 近似 OK，離譜不行
2. **Contract by component** — ClawdNote / ShroomDogNote 各自 opt-in/out 於特定檢查，避免模糊情境判斷
3. **Human-in-the-loop via UI, not via queue** — Pipeline 產 structured data，ShroomDog 讀 site 時做最終決策
4. **Quality first, optimize later** — All-Opus + `LUXURY_TOKEN` tags 明確標出未來優化路徑
5. **Honest AI collaboration** — Stage 0 WARN banner 公開顯示「AI 不確定」，反而增加 credibility，順便收 tuning data
6. **High bar = respect for reader's time** — 2026 attention economy 下，2/3 fail rate 是 feature

---

# Part 2: Original Challenges (2026-04-09)

## 挑戰清單

### 挑戰 1: Vibe-First Ordering 會製造事實炸彈

- **現行設計**: Stage 1 Vibe 放第一，Opus writer 可以大改整篇文章（骨架、narrative、persona 全開），Stage 3 FactLib 才來修事實。
- **問題**: Opus 在 Stage 1 做 invasive rewrite 時，極有可能**引入原文沒有的事實錯誤**。創意改寫為了追求 narrative 好看，會潤飾數字、簡化技術細節、甚至捏造比喻裡的技術宣稱。Stage 3 的 FactCorrector（Sonnet）要負責抓出 Opus 創造的錯誤 — 這是**用弱 model 修強 model 的 hallucination**，成功率存疑。
- **Edge case**:
  - 原文寫「延遲降低 40%」，Opus 為了 narrative flow 改成「延遲砍半」→ FactCorrector 沒有原文對照，無法判斷「砍半」是否正確
  - Opus 為了 ClawdNote 加梗，編造一個技術 analogy 含有微妙的技術錯誤 → Sonnet 可能認為 analogy 不算事實宣稱而跳過
- **建議**:
  1. Stage 1 writer 的 prompt 加入硬規則：**不准改動任何數字、百分比、技術宣稱** — 只改結構和語氣
  2. 或者在 Stage 1 PASS 後、Stage 2 之前，跑一次 **fact-diff check**：比較 Stage 1 前後版本，標記所有事實性文字的變動，讓 Stage 3 的 FactCorrector 有個 watchlist

---

### 挑戰 2: FactCorrector 第一輪是瞎子摸象

- **現行設計**: Worker-first — FactCorrector 先主動掃全文修事實，然後 judge 才評分。第一輪沒有 judge feedback。
- **問題**: 沒有 feedback 的 FactCorrector 基本上是在**盲修**。它不知道 judge 在意什麼維度、什麼程度算錯、哪些類型的錯誤是 critical。它只能用自己的判斷掃描全文 — 而 Sonnet 對事實的判斷力本來就有限。
- **Edge case**:
  - FactCorrector 把一個其實正確但措辭不精確的句子「修正」了，結果改錯 → judge 看到的版本反而比原文更糟
  - FactCorrector 專注修小錯，但漏掉一個 judge 認為 critical 的大問題（例如整段的邏輯推論有問題）
  - FactCorrector 對某個技術領域不熟，自信地把正確的內容「修正」成錯誤的
- **建議**:
  1. 第一輪不叫「盲修」，而是 **scan + flag**：FactCorrector 第一輪只輸出「我發現這些可能有問題」的清單，不直接改文章
  2. Judge 看清單 + 原文 → 給出 verdict 和 feedback → 第二輪 FactCorrector 才根據 judge 確認過的問題去修
  3. 這樣雖然多一輪，但避免了「改錯」比「沒改」更糟的風險
  4. **或者**，保持現行 worker-first，但給 FactCorrector 一份 **standing instructions**（類似 linter rules）：列出常見錯誤類型、修正規則、「不確定就不要改」的原則

---

### 挑戰 3: Haiku 當 FreshEyes Judge 可能太弱

- **現行設計**: Stage 2 FreshEyes 用 Haiku 模擬「3 個月經驗的新手工程師」來評 readability。
- **問題**: Haiku 是最弱的 model。用它來「模擬新手」的邏輯是「弱 model ≈ 新手視角」— 但這個對應關係不成立。Haiku 的問題不是「像新手一樣困惑」，而是**判斷力不足**：它可能無法區分「真的寫得不清楚」和「我自己理解力不夠」。
- **Edge case**:
  - 文章用了正確的技術術語（如 "event loop"），Haiku 覺得難懂就扣分 → 但目標讀者其實應該知道這個詞
  - 文章某段確實很混亂，但 Haiku 給了 pass 因為它沒能理解到底哪裡有問題
  - Haiku 的評分不穩定 — 同一篇文章跑兩次，分數差異大（weak model 的 calibration 差）
- **建議**:
  1. 改用 **Sonnet** 當 FreshEyes judge — 有足夠判斷力執行「模擬新手」的 persona，同時不會因為自身能力不足而誤判
  2. 如果堅持用 Haiku 省 token，至少加一個 **confidence threshold**：Haiku 評分低於某值時，escalate 給 Sonnet 再評一次

---

### 挑戰 4: Writer Constraints 無法被可靠 Enforce

- **現行設計**: 每個 stage 的 writer 有明確的「可以改 / 不能改」清單。例如 Final Vibe writer 不能改事實、連結、骨架。
- **問題**: LLM **不可靠地遵守 negative constraints**（「不要做 X」）。尤其是 Opus 這種強 model，越是能力強，越容易在「微調語氣」時順手改了不該改的東西。Prompt 說「只能微調語氣」，但 Opus 可能認為某句話「語氣不好」是因為事實表述方式不好，於是改了事實。
- **Edge case**:
  - Final Vibe writer 為了讓語氣更活潑，把「系統延遲從 200ms 降到 120ms」改成「系統快了一倍」→ 事實被改了但 writer 認為這只是「語氣潤色」
  - FreshEyes writer 為了改善 readability，重新排了段落順序 → 違反「不能改段落順序」但 writer 認為這是 readability 的一部分
- **建議**:
  1. **Programmatic diff check**：每個 stage 的 writer 輸出後，跑一個 deterministic script 比較前後版本，驗證 constraints 是否被遵守（例如：檢查所有 URL 是否不變、數字是否不變、段落 heading 順序是否不變）
  2. 如果 diff check 發現違規 → 自動 reject 這輪修改，回到上一版
  3. 這比靠 prompt 約束 LLM 可靠得多

---

### 挑戰 5: Final Vibe（Stage 4）的存在價值

- **現行設計**: Stage 4 用 Opus 再跑一次 vibe scoring，確認 Stage 2-3 沒有破壞語氣。
- **問題**: Stage 2 FreshEyes 和 Stage 3 FactLib 的 writer constraints 已經很嚴格（不能改骨架、段落順序、ClawdNote 觀點）。如果 constraints 被正確遵守，vibe 應該不會有大幅退化。花一整個 Opus stage 來驗證「沒壞」是否值得？
- **Edge case**:
  - 文章在 Stage 2-3 只改了幾個錯字和加了幾個連結 → Final Vibe 100% 會 pass → 浪費 Opus token
  - Final Vibe fail 了 → writer 只能「微調語氣」但問題可能出在 Stage 2-3 的修改 → 微調語氣解決不了根本問題
- **建議**:
  1. **Conditional Stage 4**：只在 Stage 2-3 的修改量超過某個 threshold（例如 diff 行數 > 10）時才跑 Final Vibe
  2. 或者把 Final Vibe 簡化成 **automated vibe-diff check**：不跑完整 judge，只比較 Stage 1 PASS 時的分數和 Stage 3 後的預估分數（用 lighter model）
  3. 如果 Stage 2-3 constraints 能被 programmatically enforce（見挑戰 4），Final Vibe 的必要性更低

---

### 挑戰 6: Pass Bar 設計 — 「至少一維 >= 9」是在測什麼？

- **現行設計**: Stage 1 pass bar 是 `composite >= 8 AND 至少一維 >= 9 AND 沒有任何維 < 8`。
- **問題**: 「至少一維 >= 9」這個條件很奇怪。它要求文章在某個維度特別出色 — 但**哪個維度出色是不可控的**。一篇 ClawdNote 很有梗但 narrative 普通的文章 (9,8,8,8,8) 和一篇 narrative 很強但 ClawdNote 普通的文章 (8,8,8,8,9) 都能過 — 但這兩種文章的「好」是完全不同的。這個條件到底在篩什麼？
- **Edge case**:
  - 文章五個維度都是 8.5（很好但沒有突出亮點）→ composite = 8.5 但沒有任何維 >= 9 → FAIL。這合理嗎？一篇均衡的好文章被卡住。
  - Writer 為了讓某一維衝到 9，刻意在那個維度用力 → 其他維度因為注意力分散而下降
- **建議**:
  1. 考慮移除「至少一維 >= 9」條件，改用 **composite >= 8.5**（更高的平均值要求）
  2. 或者把「至少一維 >= 9」改成「persona 或 clawdNote >= 9」— 明確指定哪些維度需要突出，因為這些是 gu-log 的品牌差異化

---

### 挑戰 7: Stage 0 的 CP Auto-Reject 太武斷

- **現行設計**: CP 文章（自動翻譯推文）不過 Stage 0 → 直接 REJECT。非 CP 文章 → WARNING + human review。
- **問題**: CP 文章也是有 spectrum 的 — 有些推文本身很短但觀點非常有價值，翻譯出來雖然不長但含金量高。Auto-reject 的邏輯假設「不過 worthiness gate 的 CP 文章 = 垃圾」，但實際上可能只是「太短」或「格式不好」，不代表不值得發。
- **Edge case**:
  - 一條推文是某位大神用一句話總結了一個重要的 architectural insight → CP 翻譯出來很短 → Stage 0 判斷「內容深度不夠」→ auto-reject → 但這其實是很有價值的內容
  - Stage 0 judge 的 worthiness 標準還沒定義 — 如果標準偏嚴，可能 reject 掉大量本來可以救的 CP 文章
- **建議**:
  1. CP 文章也改成 **WARNING + human review**，不要 auto-reject — 至少在 v2 初期，等累積足夠 data 後再考慮 auto-reject
  2. 或者 CP auto-reject 但加 **appeal 機制**：human 可以手動把 REJECTED 的 CP 文章重新送入 pipeline

---

### 挑戰 8: Squash Merge 在 Main 上失去 Stage 粒度

- **現行設計**: 每個 worker/judge commit 一次到 `tribunal/<article>` branch，PASS 後 squash merge 回 main。
- **問題**: Squash merge 在 main 上只留一個 commit — 如果 publish 後發現問題，你需要找到正確的 branch 才能看 stage-by-stage 的歷史。但 branch 名是 `tribunal/<article-name>`，如果你有幾十篇文章，找起來會很痛苦。
- **Edge case**:
  - 六個月後讀者回報某篇文章有事實錯誤 → 想回去看 FactCorrector 改了什麼 → 要從一堆 branch 裡找到對的那個
  - Branch 太多（每篇文章一個），git 效能會受影響（branch list 過長）
- **建議**:
  1. 在 squash merge 的 commit message 裡嵌入 **stage summary**（每個 stage 的 pass/fail 和 loop count）
  2. 定期清理已 merge 的 tribunal branches（例如 30 天後刪除），但在 progress JSON 裡保留 branch commit hash 方便查找
  3. 考慮 branch 命名加日期：`tribunal/2026-04-09-article-name` 方便按時間找

---

## Open Questions 意見

### FactLib Combined Judge 維度和 Model

- **我的看法**: Fact-checking 和 library/link 是完全不同的能力。Fact-checking 需要推理能力（判斷技術宣稱是否正確），library 只需要結構檢查（連結有沒有加、格式對不對）。合併成一個 judge 會讓兩者的 signal 互相稀釋。
- **建議**:
  - 維度：fact accuracy / source fidelity / link coverage / link relevance（4 維就夠）
  - Model：**Sonnet** — Opus 殺雞用牛刀，Haiku 可能判斷力不夠。Sonnet 在 structured evaluation 上表現夠好。
  - 如果堅持 combined，至少讓 fact 和 library 的 pass bar **獨立計算**，不要用 composite。因為 link coverage 高不能補償 fact accuracy 低。

### Final Vibe Pass Bar

- **我的看法**: 不應該跟 Stage 1 一樣嚴格。Stage 1 是定骨架，嚴格合理。Stage 4 是確認沒壞，只需要確保沒有**顯著退化**。
- **建議**:
  - 改成 **relative pass bar**：Stage 4 的每個維度分數不能比 Stage 1 PASS 時低超過 1 分
  - 這比 absolute pass bar 更合理 — 你關心的是「有沒有變差」，不是「有沒有達到某個絕對水準」
  - 如果任何維度掉超過 1 分 → FAIL + feedback（告訴 writer 哪個維度掉了）

### Stage 0 Worthiness 標準

- **我的看法**: 這是整個 pipeline 最危險的 gate，因為它的 false positive（reject 好文章）成本最高 — 被 reject 的文章完全不會被改善，直接消失。
- **建議**:
  - Model：**Sonnet**，不是 Haiku。Worthiness 判斷需要理解「這篇文章的核心觀點值不值得展開」，這不是 trivial 的判斷。
  - 維度建議：`coreInsight`（核心觀點有無價值）+ `expandability`（有沒有展開成長文的潛力）+ `audienceRelevance`（對 gu-log 目標讀者有無價值）
  - Pass bar 要**偏寬鬆** — 寧可讓一些不太好的文章進入 pipeline（反正後面 Stage 1 會再篩），也不要 false reject
  - 初期建議只啟用 WARNING 模式（不管 CP 或非 CP），累積幾十篇 data 後再分析哪些被 warn 的文章最終 pass/fail pipeline，用這個 data 來 calibrate reject 門檻

### FactCorrector 第一輪沒有 Judge Feedback

- **我的看法**: 見挑戰 2。核心問題是「proactive fix without guidance = 高風險」。
- **建議**: 第一輪改成 **scan-only**（列出疑慮但不改文），或者給 FactCorrector 一份 standing checklist（常見錯誤類型 + 修正規則 + 「不確定就標記不改」原則）。

### Worker Sessions: 分開還是合併？

- **我的看法**: **分開**。理由：
  1. FactCorrector（Sonnet）和 Librarian（Haiku）用不同 model — 合併 session 意味著要用較強的 model 跑全部，浪費 token
  2. FactCorrector 修事實可能改變文字 → Librarian 需要看到修正後的版本來決定在哪加連結 → 有**因果依賴**，不能真的 parallel
  3. 分開 session 讓每個 worker 的 commit 獨立 → debug 時更清楚誰改了什麼
- **唯一要注意的**: 確保 Librarian 跑的是 FactCorrector 修改後的版本，不是原版

---

## Stage 0 Banner/UI 討論

### 現行設計理解

CP 文章未通過 Stage 0 → status label `MARKED_AS_UNQUALIFIED_FOR_REVIEW_BY_QUALITY_GATE`，UI 上顯示 banner 告訴 human。

### Banner 設計考量

1. **Banner 語氣問題**: 「AI 品質門檻已標記此文不夠格」太機械。這個 banner 是給 CEO（human reviewer）看的，應該用有用的語氣，不是法律聲明。
   - 差的: "此文章未通過 AI 品質評估門檻"
   - 好的: "Clawd 覺得這篇可能不太適合發 — 你要看看嗎？" + 簡短的拒絕理由

2. **需要顯示拒絕理由**: Banner 不能只說「不夠格」，至少要說**為什麼**。CEO 才能快速判斷要不要 override。例如：「內容太短，核心觀點不夠展開」或「跟站上已有的 [某篇文章] 重複度高」。

3. **Action buttons**: Banner 上要有明確的操作按鈕：
   - `Override → 送入 Pipeline`（CEO 覺得值得發）
   - `確認 Reject`（CPU 同意不發）
   - `稍後再看`（保留在 queue 裡）

4. **Banner 位置**: 應該出現在文章 edit 頁面的頂部（類似 GitHub PR 的 merge conflict banner），而不是只在 list view 裡用 tag 標記。在 list view 也要有明顯標記，但 banner 在文章頁面裡要最醒目。

5. **Status Label 太長**: `MARKED_AS_UNQUALIFIED_FOR_REVIEW_BY_QUALITY_GATE` 太長了。建議：
   - Internal status: `GATE_REJECTED` 或 `NEEDS_REVIEW`
   - Display label: 用 banner 呈現，不要直接 expose 內部 status

---

## 補充觀察

### Pipeline 整體的 Token Budget 估算

文件沒提到**每篇文章跑完整個 pipeline 大概要多少 token**。這很重要 — 如果平均一篇文章要跑完 6 stages（含 retry loops），token 成本是多少？Stage 0 reject 能省多少？建議在 planning 階段做一個 rough estimate，作為 pass bar 和 max loops 決策的 input。

### 沒有 Rollback 機制

如果 Stage 3 把文章改壞了（FactCorrector 改錯事實），pipeline 繼續往下跑到 Stage 4... 有辦法 rollback 到 Stage 2 的版本嗎？目前設計裡沒看到 stage-level rollback。Git commit 歷史理論上可以，但沒有自動化的 rollback path。

> **Note (2026-04-10)**: Rollback 的 open question 已經在 Level 8 決定「不做」— pipeline 往前走，Stage 4 banner 呈現問題，人類在 UI 端決策。

---

# Part 3: Appendices

## Appendix A: Judge Output Schemas (Planning Artifact)

給 Builder 寫 test fixtures 和 type definitions 用。這是 planning spec，不是 final code。

### Base Judge Output

所有 judge 共用的 base interface：

```typescript
interface BaseJudgeOutput {
  pass: boolean;
  scores: Record<string, number>;  // integer 0-10
  composite: number;                // integer 0-10

  // Only populated when pass === false
  improvements?: Record<string, string>;  // per-dimension specific feedback
  critical_issues?: string[];             // 1-3 root causes

  // Metadata for tuning
  judge_model: string;      // e.g. "claude-opus-4-6"
  judge_version: string;    // semver of judge prompt
  timestamp: string;        // ISO 8601
}
```

### Stage 0: WorthinessJudgeOutput

```typescript
interface WorthinessJudgeOutput extends BaseJudgeOutput {
  scores: {
    coreInsight: number;       // 核心觀點價值
    expandability: number;     // 展開成長文的潛力
    audienceRelevance: number; // 對 gu-log 讀者的相關性
  };

  // Special for Stage 0 — dual reasoning output
  internal_reason: string;         // 完整技術分析，for debug/tuning
  reader_friendly_reason: string;  // 一行中文，給 banner 顯示用
}
```

### Stage 1 / Stage 4: VibeJudgeOutput

```typescript
interface VibeJudgeOutput extends BaseJudgeOutput {
  scores: {
    persona: number;
    clawdNote: number;
    vibe: number;
    clarity: number;
    narrative: number;
  };
}

// Stage 4 specific (relative pass bar):
interface FinalVibeJudgeOutput extends VibeJudgeOutput {
  stage_1_scores: VibeJudgeOutput["scores"];  // reference for comparison
  degraded_dimensions: string[];               // 退步 > 1 分的維度
  is_degraded: boolean;                        // any dim dropped > 1 point?
}
```

### Stage 2: FreshEyesJudgeOutput

```typescript
interface FreshEyesJudgeOutput extends BaseJudgeOutput {
  scores: {
    readability: number;
    firstImpression: number;
  };
}
```

### Stage 3: FactLibJudgeOutput

```typescript
interface FactLibJudgeOutput extends BaseJudgeOutput {
  scores: {
    factAccuracy: number;    // 事實正確性
    sourceFidelity: number;  // 對 source 的忠實度
    linkCoverage: number;    // 站內/glossary 連結覆蓋
    linkRelevance: number;   // 連結是否真的相關
  };

  // Fact 和 Library 獨立 pass bar（不用 composite 補償）
  fact_pass: boolean;
  library_pass: boolean;
  // overall `pass` = fact_pass AND library_pass
}
```

### FactCorrector Worker Output

```typescript
interface FactCorrectorOutput {
  changes_made: Array<{
    location: string;        // e.g. "paragraph 3, sentence 2"
    before: string;
    after: string;
    reason: string;          // e.g. "source 原文是 42%，原版寫 40%"
    source_verified: boolean; // 是否用 source URL 對照過
  }>;

  flagged_but_not_changed: Array<{
    location: string;
    concern: string;
    reason_not_changed: string;  // e.g. "不確定原意，交給 judge"
  }>;

  source_urls_fetched: string[];  // 實際 fetch 過的 URL list
  scope_violations_detected: string[];  // 如果發現 ClawdNote 被動到，這裡記錄
}
```

### Librarian Worker Output

```typescript
interface LibrarianOutput {
  glossary_links_added: Array<{
    term: string;
    target: string;     // glossary entry path
    location: string;
  }>;

  cross_references_added: Array<{
    text: string;
    target: string;     // internal post slug
    location: string;
  }>;
}
```

---

## Appendix B: LUXURY_TOKEN Audit Script

```bash
#!/usr/bin/env bash
# scripts/luxury-token-audit.sh
#
# 撞到 quota 牆時用這個 audit 所有 LUXURY_TOKEN 標記，
# 找出可以降級的地方。
#
# Usage: bash scripts/luxury-token-audit.sh
# Save: bash scripts/luxury-token-audit.sh > luxury-audit-$(date +%Y%m%d).txt

set -e

echo "=== LUXURY_TOKEN Audit Report ==="
echo "Generated: $(date)"
echo ""

EXCLUDES="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.astro"

# Total count
TOTAL=$(grep -rn "LUXURY_TOKEN:" . $EXCLUDES 2>/dev/null | wc -l | tr -d ' ')
echo "Total LUXURY_TOKEN markers: $TOTAL"
echo ""

# Group by file (hotspots)
echo "=== By file (hotspots) ==="
grep -rn "LUXURY_TOKEN:" . $EXCLUDES 2>/dev/null | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn
echo ""

# Show all with context
echo "=== All markers with context ==="
grep -rn "LUXURY_TOKEN:" . $EXCLUDES 2>/dev/null
```

### 使用情境

1. **平時不跑** — 有 quota 就不用 audit
2. **撞到 quota 牆或 monthly budget 即將爆表時**跑一次
3. 產出的 report 交給 CTO / Planner review，挑選降級順序（通常從影響最小的開始 — 例如 Librarian 降回 Haiku 影響很小，Stage 1 Vibe judge 降級影響很大）

### 降級優先順序建議（從低風險到高風險）

1. Stage 3 Librarian (Opus → Haiku) — link coverage 判斷不需要強 model
2. Stage 3 FactCorrector (Opus → Sonnet) — 有 source URL 對照，Sonnet 夠用
3. Stage 0 Worthiness judge (Opus → Sonnet) — 三維判斷不複雜
4. Stage 2 FreshEyes judge (Opus → Sonnet) — 還能 play persona
5. Stage 4 conditional — 改成 diff-size threshold，小改動 skip
6. Stage 3 Combined Judge (Opus → Sonnet) — 會影響 fact accuracy
7. **不建議降級**: Stage 1 Vibe judge/writer, Stage 4 Final Vibe judge — 這是品牌維護的核心

---

## Appendix C: Banner UI Mock — Builder Next Steps

這部分需要 Builder 實作，Devil's Advocate 只提供 spec。

### 需要的 Component

**File**: `src/components/Stage0WarnBanner.astro`

**Props interface**:
```typescript
{
  reason: string;            // reader_friendly_reason from judge
  judgeModel?: string;       // e.g. "Opus" — for transparency
  overrideComment?: string;  // ShroomDog 手填（可選）
}
```

### Visual Mock

```
┌──────────────────────────────────────────────────────────┐
│  Clawd 的 AI judge 對這篇沒把握 ಠ_ಠ                       │
│  ────────────────────────────────────────────────────── │
│                                                           │
│  Opus judge 覺得這篇可能不太適合登上 gu-log：            │
│  "{{reason}}"                                             │
│                                                           │
│  我們還在 tune gu-log 的 AI judge 的判斷標準，           │
│  你覺得這篇有沒有料？下面留言告訴我們 (>w<)              │
│                                                           │
│  {{#if overrideComment}}                                  │
│  ────────────────────────────────────────────────────── │
│  ShroomDog 的說明：                                       │
│  "{{overrideComment}}"                                    │
│  {{/if}}                                                  │
│                                                           │
│                                      [↓ 跳到留言區 ↓]    │
└──────────────────────────────────────────────────────────┘
```

### Integration

- 讀 post frontmatter 的 `warnedByStage0` flag（boolean）+ `warnReason` string
- 如果 `warnedByStage0 === true` → 渲染 banner 在 `BaseLayout.astro` 文章頂部（TOC 上方）
- Banner 的「跳到留言區」按鈕 → `<a href="#comments">`
- 確認 giscus component 存在於 layout（如果沒有，先補 giscus 掛載）

### Styling 方向

- 使用 Solarized CSS variables（CLAUDE.md 規定）
- Border/accent color: `--solarized-yellow` 或 `--solarized-orange`
- **不要用紅色** — 那看起來像 error，但這不是 error
- 字體繼承 global (Inter + Noto Sans TC)
- Mobile responsive（gu-log 預設有）

### Frontmatter Schema 擴充

`src/content/config.ts` 需要加（Builder 自己決定 Zod 寫法）：

```typescript
// 在 post schema 裡新增
warnedByStage0: z.boolean().optional().default(false),
warnReason: z.string().optional(),      // reader_friendly_reason
warnOverrideComment: z.string().optional(),  // ShroomDog 的 override 說明
stage4FinalVibeScores: z.object({...}).optional(),  // 給 Stage 4 degraded banner 用
```

### Mock 測試流程（給 Builder）

1. 建立 dummy post `src/content/posts/__banner-mock.mdx`:
   ```yaml
   ---
   title: "Banner Mock Post"
   warnedByStage0: true
   warnReason: "內容很有趣，但核心觀點不夠展開成長文的程度"
   ---
   
   這是 banner 測試文章。
   ```
2. `pnpm run dev` → navigate to `/posts/__banner-mock` → visual check
3. 用 playwright-cli 截圖 → spawn uiux-auditor agent 審（CLAUDE.md 規定）
4. 滿意後，刪 mock post 或加進 `.gitignore`

---

# Part 4: Handoff Notes

## 這份 review 的狀態

- [x] 8 個原始挑戰提出（2026-04-09）
- [x] CEO level-up session 跑完 8 關（2026-04-10）
- [x] 所有 open questions 已決策
- [x] Judge output schemas 寫好（Appendix A）
- [x] LUXURY_TOKEN audit script 寫好（Appendix B）
- [x] Banner UI spec 寫好（Appendix C）
- [ ] **Builder 接手實作**（下面）
- [ ] Mental model v2 文件更新（應反映這些決策）
- [ ] TDD test cases 撰寫（CEO task #3）

## Builder 建議起手順序

1. **先更新 `tribunal-v2-mental-model.md`** — 把所有 open questions 清掉，反映 decision log
2. **寫 judge output type definitions** — 從 Appendix A 複製到 `.score-loop/src/types/judge-outputs.ts` 或類似位置
3. **LUXURY_TOKEN audit script** — 直接把 Appendix B 的 bash 貼到 `scripts/luxury-token-audit.sh`，`chmod +x`
4. **Frontmatter schema 擴充** — 更新 `src/content/config.ts` 加上 `warnedByStage0` / `warnReason` 欄位
5. **Banner component + mock test** — 依 Appendix C 流程
6. **TDD test fixtures** — 從 judge schemas 衍生（CEO task #3）

## 已解決的 Open Questions 清單

| 原 Open Question | 決策 | 見 |
|---|---|---|
| Stage 0 Worthiness judge model | Opus (LUXURY_TOKEN) | Level 4, 7 |
| Stage 0 評分維度 | coreInsight / expandability / audienceRelevance | Level 7 |
| CP 文章 reject 門檻 | 不 auto-reject，WARN 即可 | Level 7 |
| CP 文章 status label | `warnedByStage0: true` + `warnReason` | Level 7 |
| FactLib combined judge 維度 | factAccuracy / sourceFidelity / linkCoverage / linkRelevance | Appendix A |
| FactLib combined judge model | Opus (LUXURY_TOKEN) | Level 4 |
| FactCorrector / Librarian session | Split | Level 8 |
| FactCorrector 第一輪 feedback | Standing checklist + source URL fetch | Level 2 |
| Final Vibe pass bar | Relative (比 Stage 1 不能低 > 1) | Level 6 |
| Final Vibe max loops | 2 | Level 6 |
| Stage 1 2/3 fail rate | 不是 bug，是 feature — 解法是改善 writer 不是降 bar | Level 5 |
| Stage 5 Translation 觸發 | Auto after zh-tw publish | Level 8 |

## 未解決 / 未來可能需要的

- **Pipeline 整體 token budget 估算** — 尚未算出平均一篇文章跑完要多少 token。建議 Builder 在實作過程中收集 metrics，第一篇跑完就有 baseline。
- **Stage 0 worthiness dimensions 的具體 rubric** — 決定了三個維度但沒有詳細 scoring guide。可參考 `scripts/ralph-vibe-scoring-standard.md` 的 format 去寫。
- **Judge prompt versioning** — `judge_version` field 在 schema 裡，但沒有 version management 流程。未來如果 tune prompt 要考慮。

