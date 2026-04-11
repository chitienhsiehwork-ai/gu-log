# Tribunal v2 Mental Model

> CTO 對 CEO mental model 的理解。CEO review 後確認。
> Date: 2026-04-09
> Updated: 2026-04-11 — **DECISIONS LOCKED** (see `devils-advocate-review.md` Part 1)
> Status: Ready for Test Writer / Builder handoff

---

## Pipeline 總覽：6 Stages（含 Stage 0 + 翻譯）

```
文章進來
  ↓
Stage 0: Worthiness Gate（值得發嗎？）
  Opus judge (LUXURY_TOKEN) 評分
  All WARN 模式 — 不 auto-reject (包含 CP)
  WARN 文章仍進入後續 pipeline，frontmatter 標 warnedByStage0
  UI 永久顯示 banner (reader_friendly_reason) 邀請讀者 feedback
  ↓
Stage 1: Vibe（定骨架）
  Opus judge 評分 → 沒過 → Opus writer 大改 → 重新評分（最多 3 輪）
  Writer constraint: magnitude/direction 不能錯，vibe 近似 OK
  ClawdNote 完全免 fact-check（creative scope）
  ShroomDogNote 要 fact-check 但保留 hedge words
  ↓ 過了
Stage 2: FreshEyes（讀者體驗）
  Opus judge (LUXURY_TOKEN) → 沒過 → Opus writer 改 readability → 重新評分（最多 2 輪）
  ↓ 過了
Stage 3: FactLib（事實 + 連結，worker-first + split sessions）
  Session 1: FactCorrector (Opus, LUXURY_TOKEN) 主動修事實
    - fetch source URL 做語意檢查（不是 lexical diff）
    - standing checklist (7 條) 當 rules
    - scope: body + ShroomDogNote, exclude ClawdNote
    - 不確定就 flag 不改
  Session 2: Librarian (Opus, LUXURY_TOKEN) 主動加連結
    - 跑在 FactCorrector 修改後的版本上（因果依賴）
  Combined Judge (Opus, LUXURY_TOKEN): fact_pass + library_pass 獨立計算
  沒過 → loop 回 workers（最多 2 輪）
  ↓ 過了
Stage 4: Final Vibe（regression check + 語氣微調）
  Opus judge 再評一次 vibe → 沒過 → Opus writer 微調語氣（最多 2 輪）
  Relative pass bar: 每維不能比 Stage 1 PASS 時低超過 1 分
  Writer constraint: structural (URLs/headings) 由 programmatic diff check enforce
  On fail: 不阻擋 publish，frontmatter 記錄 scores，UI banner 顯示退化維度
  ShroomDog 讀 site 時手動決策（保留 / 改 / 重跑）
  ↓ 過了
全部 PASS → squash merge 到 main
  Commit message 嵌 stage summary (scores + loop counts)
  Remote branch 保留（方便 prompt tuning）
  ↓
Stage 5: Translation（翻譯成英文）
  zh-tw publish 後自動觸發
  保持骨架、事實、連結不變
  可以調整口語化說法讓英文版更有趣
  不算 tribunal loop 的一部分 — 是 post-publish step
```

---

## 核心設計哲學

### 1. 先篩值不值得，但不 auto-reject

- Stage 0 是 gate，不做 rewrite — 只判斷值不值得
- **但不 auto-reject 任何文章**（包括 CP）
- 所有 WARN 文章仍進入 pipeline，frontmatter 標記 warn 原因
- WARN banner 永久顯示在文章頂部，邀請讀者 feedback
- 追蹤 `completion_rate` + `dwell_time` + `comment_count` 當 judge tuning ground truth
- **Insight**: `completion_rate` 是 Opus judge 永遠學不到的 signal — human behavior > AI judgment 作為 ground truth

### 2. 先定骨架，再做細修

- Vibe 是最 invasive 的（可能重寫整篇），所以放第一
- 越後面的 stage 改動範圍越小
- 最後一個 Final Vibe 只做 tone polish + regression check

### 3. Worker-first（Stage 3）

- 傳統做法: judge 先評分 → 發現問題 → writer 修 → re-judge（reactive）
- 新做法: worker 先主動修 → judge 只需要驗證結果（proactive）
- **關鍵改進**: FactCorrector 第一輪不是「盲修」，而是用 **standing checklist + source URL fetch** 指導 — 等於有一份 linter rules + 原文對照，避免盲改風險

### 4. Writer Constraints（structural vs semantic 分開處理）

LLM 不可靠地遵守 negative constraints，所以要用兩種方式 enforce：

| Constraint 類型   | 例子                                             | Enforcement                                    |
| ----------------- | ------------------------------------------------ | ---------------------------------------------- |
| **Structural**    | URL、heading 順序、glossary link 存在、frontmatter | Programmatic diff check（lexical，deterministic） |
| **Semantic**      | 數字 magnitude、技術宣稱方向                     | Stage 3 FactCorrector + source URL 語意檢查    |

權限表（越後面越嚴格）：

| Stage         | Writer 可以改                        | Writer 不能改                          |
| ------------- | ------------------------------------ | -------------------------------------- |
| Vibe          | 全部，但 magnitude/direction 不能錯  | frontmatter、事實的 magnitude/direction |
| FreshEyes     | 用詞、段落拆分、過渡句、術語解釋     | 骨架、段落順序、ClawdNote 觀點         |
| FactCorrector | 事實數字、hedge words、來源標註      | narrative、readability、連結           |
| Librarian     | glossary link、站內連結              | 文字內容、事實、narrative              |
| Final Vibe    | 語氣微調、persona 潤色               | 事實、連結、骨架、段落順序             |

### 5. Component Scope（ClawdNote / ShroomDogNote 分開處理）

不同 component 套用不同 rule，避免模糊情境判斷：

| Component     | Fact-check         | Vibe-check | Hedge words          |
| ------------- | ------------------ | ---------- | -------------------- |
| 文章 body     | ✅                  | ✅          | N/A                  |
| ClawdNote     | ❌（creative scope）| ✅          | N/A                  |
| ShroomDogNote | ✅                  | ✅          | 保留，不改成肯定句   |

**ShroomDogNote special rule**: `calibrated uncertainty` 本身就是「準確」的一部分，不是軟弱的用字。如果 ShroomDog 用肯定語氣說了不確定的事 → flag 給 judge，建議加 hedge（「我想」「應該是」「大概」）。

### 6. 只 iterate zh-tw，翻譯是最後一步

- 整個 tribunal pipeline 只跑 zh-tw 版本
- 所有 judge/writer/worker 都只看 zh-tw 版
- zh-tw 版完全 polish + publish 後，才翻譯成英文（Stage 5，自動觸發）
- 英文翻譯保持骨架、事實、連結不變，但可以調整口語說法讓英文更有趣

### 7. Per-Article Git Branch

- 每篇文章開 `tribunal/<article-name>` branch
- 每個 worker/judge 做完都 commit 一次（方便 debug 誰改了什麼）
- PASS → **squash merge 回 main，commit message 嵌 stage summary**（scores + loop counts，未來 `git log --grep` 找得到）
- 保留 remote branch（方便 prompt tuning + 從歷史學東西）
- FAIL → branch 保留（可以回去看哪個 agent 搞砸的，tuning prompt 用）

### 8. Cross-cutting Philosophies

這些是整個 design session 中反覆出現的價值觀：

1. **Vibe > factual precision, within reason** — 近似 OK，離譜不行
2. **Contract by component** — ClawdNote / ShroomDogNote 各自 opt-in/out 於特定檢查
3. **Human-in-the-loop via UI, not via queue** — Pipeline 產 structured data，ShroomDog 讀 site 時做最終決策
4. **Quality first, optimize later** — All-Opus + `LUXURY_TOKEN` tags 標出未來優化路徑
5. **Honest AI collaboration** — Stage 0 WARN banner 公開顯示 AI 不確定，反而增加 credibility
6. **High bar = respect for reader's time** — 2/3 fail rate 是 feature，不是 bug

---

## Stage 細節

### Stage 0: Worthiness Gate（值得發嗎？）

- **Judge**: Opus `LUXURY_TOKEN`
  - 升級原因: worthiness 判斷需要理解「核心觀點值不值得展開」，非 trivial
  - 降級路徑: Sonnet（詳見 `devils-advocate-review.md` Appendix B）
- **維度**: `coreInsight`（核心觀點有無價值）/ `expandability`（展開成長文的潛力）/ `audienceRelevance`（對 gu-log 目標讀者的價值）
- **Policy**: **All WARNING mode, no auto-reject**
  - 所有 WARN 文章仍進入後續 pipeline
  - CP 和非 CP 一視同仁
  - Pass bar 偏寬鬆 — 寧可讓不太好的文章進 pipeline 再篩，也不要 false reject
- **Judge output**: `internal_reason`（debug/tuning）+ `reader_friendly_reason`（UI banner）
- **Frontmatter**: WARN 時設 `warnedByStage0: true` + `warnReason: "..."`
- **UI**: Banner 永久顯示（不 dismiss），邀請 giscus 留言 feedback
- **Max loops**: 0（pure gate，不 rewrite）
- **Ground truth signal**: `completion_rate` + `dwell_time` + `comment_count`

### Stage 1: Vibe（Opus → Opus → Opus）

- **Judge**: vibe-opus-scorer agent, Opus
- **維度**: persona, clawdNote, vibe, clarity, narrative（5 維）
- **Pass bar**: `composite >= 8 AND 至少一維 >= 9 AND 沒有任何維 < 8`（整數制）
  - 「至少一維 >= 9」= 要有亮點（creative）
  - 「全部 >= 8」= 不能有短板（no missing parts）
  - **2/3 fail rate 是 feature** — 2026 attention economy，沒硬傷但無聊 = 白燒 token
- **Writer**: Opus
- **Writer constraints**:
  - 可以大改骨架、narrative、persona、ClawdNote
  - **硬規則**: magnitude/direction 不能錯（`40% → 將近一倍` OK，`40% → 十倍` NOT OK）
  - 離譜偏離由 Stage 3 FactCorrector + source URL 抓
  - ClawdNote 裡的誇飾 analogy 完全免檢
- **Max loops**: 3
- **目的**: 確保文章有個性、有故事感、ClawdNote 有梗

### Stage 2: FreshEyes（Opus → Opus，LUXURY_TOKEN on judge）

- **Judge**: fresh-eyes agent, Opus `LUXURY_TOKEN`（模擬「3 個月經驗的新手工程師」persona）
  - 升級原因: Haiku 的問題不是「像新手一樣困惑」，而是判斷力不足；Opus 執行 persona 更穩定
  - 降級路徑: Sonnet with confidence threshold fallback
- **維度**: readability, firstImpression（2 維）
- **Pass bar**: composite >= 8
- **Writer**: Opus（readability improvement 需要文字功力）
- **Writer constraints**: 只能改用詞、段落拆分、過渡句、術語解釋。不能改骨架、段落順序、ClawdNote 觀點。
- **Max loops**: 2
- **目的**: 確保新手讀者也能帶走 mental model

### Stage 3: FactLib（Worker-first, split sessions, all Opus）

**Session 1 — FactCorrector worker** (Opus `LUXURY_TOKEN`)

- 主動掃文章 body + ShroomDogNote（**排除 ClawdNote**）
- 第一輪有 guidance：**standing checklist + source URL fetch**
- Standing checklist (初稿):
  1. 數字/百分比 → 跟 source URL 原文比對
  2. 技術名詞拼寫 → 查正確寫法
  3. 時間/日期/人名/公司名 → 跟 source 比對
  4. 技術宣稱 → source 有就保留，source 沒有且自己不確定就 flag
  5. ClawdNote 裡的一切 → SKIP（creative scope）
  6. ShroomDogNote 的 hedge words（我想/應該/大概）→ 保留，不改成肯定句
  7. 不確定 → flag + 附上理由，不要改
- Output: 修改後的文章 + flag list（給 Combined Judge 看的疑慮項目）

**Session 2 — Librarian worker** (Opus `LUXURY_TOKEN`)

- 跑在 FactCorrector 修改後的版本上（因果依賴 — Librarian 要看到修正後的文字來決定哪裡加連結）
- 主動加 glossary links + 站內連結
- 不動文字內容、事實、narrative

**Combined Judge** (Opus `LUXURY_TOKEN`)

- 同時評 fact + library 維度，但 **pass bar 獨立計算**（不用 composite）
  - `fact_pass`: factAccuracy + sourceFidelity
  - `library_pass`: linkCoverage + linkRelevance
- 必須 `fact_pass AND library_pass` 才過
- 理由: link coverage 高不能補償 fact accuracy 低

**Max loops**: 2（整個 Stage 3 的 worker → judge cycle）

### Stage 4: Final Vibe（regression check，relative pass bar）

- **Judge**: 同 Stage 1 的 vibe-opus-scorer
- **維度**: 同 Stage 1（persona, clawdNote, vibe, clarity, narrative）
- **Pass bar**: **relative** — 每個維度分數不能比 Stage 1 PASS 時低超過 1 分
  - 理由: 你關心的是「有沒有變差」，不是「絕對水準」
- **Writer**: Opus, 只能微調語氣
- **Writer constraints**:
  - Structural (deterministic): programmatic diff check — URLs/headings/frontmatter 必須完全一致
  - Semantic: 不能動事實、連結、段落順序
- **Max loops**: 2
- **On fail**: **不阻擋 publish**
  - Frontmatter 記錄 Stage 4 scores
  - UI banner 顯示退化維度（例: `"Final Vibe: persona 9→7"`）
  - ShroomDog 讀 site 時手動決定（保留 / 手改 / 重跑）
- **LUXURY_TOKEN 降級路徑**: 未來可改成 conditional（diff-size threshold 才跑）
- **目的**: regression check，確認 Stage 2-3 沒有破壞語氣

---

## Operational 設計

### Quota Pacing（Headroom-based）

- `headroom = min(5hr_remaining - 20%, weekly_remaining - 3%)`
- headroom > 0 → GO（馬上處理下一篇）
- headroom <= 0 → SLEEP（等 quota 回復）
- Usage-monitor 查詢間隔 >= 5 分鐘（防 429）

### Heartbeat（Zero-token, cron 15min）

- 純 bash, 不用 CC session
- 6 checks: service alive, progress freshness, lock staleness, disk, consecutive fails, git health
- CRITICAL → Telegram push notification

### Full Monitor（3x/day, CC session）

- 11:55 / 18:00 / 23:00 TST
- 讀 heartbeat alert → quota → progress summary → failure analysis

### Cross-Run Retry Cap

- 同一篇文章 full pipeline 失敗 3 次 → 標 `NEEDS_REVIEW` → 跳過
- 防止無限燒 token

### Judge Output

- **FAIL 時**:
  - `improvements`: 每個低分維度的具體改善建議
  - `critical_issues`: 1-3 個 root causes
- **PASS 時**: 省略 improvements/critical_issues（省 token）
- **Stage 0 額外欄位**: `internal_reason` + `reader_friendly_reason`
- **Schema 定義**: 詳見 `devils-advocate-review.md` Appendix A（TypeScript interfaces）

### Git Strategy

- Per-article branch: `tribunal/<article-name>`
- 每個 worker/judge 做完都 commit 一次
- PASS → **squash merge 回 main，commit message 嵌 stage summary**:
  ```
  tribunal: <article-title>

  Stage 0: PASS (no warn)
  Stage 1: PASS @ loop 2/3 (persona:9 clawdNote:8 vibe:9 clarity:8 narrative:8)
  Stage 2: PASS @ loop 1/2
  Stage 3: PASS @ loop 1/2 (fact:9 lib:8)
  Stage 4: PASS @ loop 1/2 (no regression)
  ```
- 未來可用 `git log --grep 'Stage'` 做 pipeline analytics
- 保留 remote branch 方便 prompt tuning

### Rollback Strategy

- **不做 stage-level rollback** — pipeline 永遠往前走
- 如果 Stage 3 改壞了，Stage 4 relative pass bar 會抓到並降分
- 如果 Stage 4 fail → banner 顯示問題，ShroomDog UI 端決策
- Philosophy: human-in-the-loop via UI, not via queue

### Translation Timing

- **Auto triggered** — zh-tw publish 後自動跑 Stage 5
- 不算 tribunal loop 的一部分，是 post-publish step

### LUXURY_TOKEN Audit

- 所有 Opus upgrade 點都標註 `LUXURY_TOKEN:` tag（inline comment）
- 未來撞 quota 牆時用 `grep -r "LUXURY_TOKEN" scripts/ .claude/agents/` 一鍵 audit
- 降級路徑在 comment 裡註記
- **Audit script**: 詳見 `devils-advocate-review.md` Appendix B

---

## 已解決問題

所有 open questions 已在 2026-04-10 level-up session 拍板。
詳見 `devils-advocate-review.md` Part 1: Decision Log (2026-04-10)。

---

## 不在範圍內

- 現有 v1 tribunal 繼續跑，v2 開發完成後才替換
- Frontmatter schema 只擴充必要欄位（`warnedByStage0`, `warnReason`, Stage 4 scores），不重寫
- 不做 parallel article processing（先 sequential，未來 per-article branch 可以開啟 parallel）
- 不做 stage-level rollback（philosophy: human-in-the-loop via UI）
