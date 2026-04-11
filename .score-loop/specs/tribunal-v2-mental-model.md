# Tribunal v2 Mental Model

> CTO 對 CEO mental model 的理解。CEO review 後確認。
> Date: 2026-04-09

---

## Pipeline 總覽：6 Stages（含 Stage 0 + 翻譯）

```
文章進來
  ↓
Stage 0: Worthiness Gate（值得發嗎？）
  Judge 評估文章是否有足夠內容品質登上 gu-log
  CP 文章：不夠格 → 直接標 REJECT，不浪費後續 token
  非 CP 文章（SD/SP/Lv）：不夠格 → 標 WARNING，請 human review（不自動 reject）
  ↓ 過了
Stage 1: Vibe（定骨架）
  Opus judge 評分 → 沒過 → Opus writer 大改 → 重新評分（最多 3 輪）
  ↓ 過了
Stage 2: FreshEyes（讀者體驗）
  Haiku judge 評分 → 沒過 → Opus writer 改 readability → 重新評分（最多 2 輪）
  ↓ 過了
Stage 3: FactLib（事實 + 連結，worker-first）
  FactCorrector worker (Sonnet) 主動修事實
  → Librarian worker (Haiku) 主動加連結
  → Combined Judge 評分 → 沒過 → loop 回 workers（最多 2 輪）
  ↓ 過了
Stage 4: Final Vibe（語氣收尾）
  Opus judge 再評一次 vibe → 沒過 → Opus writer 微調語氣（嚴格限制：不能動事實、連結、骨架）
  ↓ 過了
全部 PASS → squash merge 到 main
  ↓
Stage 5: Translation（翻譯成英文）
  只在 zh-tw 版本完全 polish + publish 後才跑
  保持骨架、事實、連結不變
  可以調整口語化說法讓英文版更有趣
  不算 tribunal loop 的一部分 — 是 post-publish step
```

---

## 核心設計哲學

### 0. 先篩值不值得

- Stage 0 是 gate，不是 improvement — 不修改文章，只判斷值不值得花 token 跑後續 pipeline
- CP 文章（自動翻譯推文）品質變異大，有些推文本身就不適合長文 → 直接 REJECT 省 token
- 非 CP 文章（SD 原創 / SP 翻譯 / Lv 教學）是人寫的，通常有一定品質 → WARNING + human review

### 1. 先定骨架，再做細修

- Vibe 是最 invasive 的（可能重寫整篇），所以放第一
- 越後面的 stage 改動範圍越小
- 最後一個 Final Vibe 只做 tone polish，確認前面的修改沒有破壞語氣

### 2. Worker-first（Stage 3）

- 傳統做法：judge 先評分 → 發現問題 → writer 修 → re-judge（reactive）
- 新做法：worker 先主動修 → judge 只需要驗證結果（proactive）
- 類比：code review 前先跑 linter + formatter，reviewer 只看邏輯問題

### 3. Writer Constraints（不准改清單）

每個 stage 的 writer 有明確的權限範圍，越後面越嚴格：

| Stage         | Writer 可以改                               | Writer 不能改                  |
| ------------- | ------------------------------------------- | ------------------------------ |
| Vibe          | 全部（骨架、narrative、persona、ClawdNote） | frontmatter                    |
| FreshEyes     | 用詞、段落拆分、過渡句、術語解釋            | 骨架、段落順序、ClawdNote 觀點 |
| FactCorrector | 事實數字、hedge words、來源標註             | narrative、readability、連結   |
| Librarian     | glossary link、站內連結                     | 文字內容、事實、narrative      |
| Final Vibe    | 語氣微調、persona 潤色                      | 事實、連結、骨架、段落順序     |

### 4. 只 iterate zh-tw，翻譯是最後一步

- 整個 tribunal pipeline 只跑 zh-tw 版本
- 所有 judge/writer/worker 都只看 zh-tw 版
- zh-tw 版完全 polish + publish 後，才翻譯成英文（Stage 5）
- 英文翻譯保持骨架、事實、連結不變，但可以調整口語說法讓英文更有趣

### 5. Per-Article Git Branch

- 每篇文章開 `tribunal/<article-name>` branch
- 每個 worker/judge 做完都 commit 一次（方便 debug 誰改了什麼）
- PASS → squash merge 回 main（main 上只有一個乾淨 commit）, still keep the remote branch, so possible to debug, refine, fine-tune the future agent prompts, or just enable the possibility to learn something from history
- FAIL → branch 保留（可以回去看哪個 agent 搞砸的，tuning prompt 用）

---

## Stage 細節

### Stage 0: Worthiness Gate（值得發嗎？）

- **Judge**: 待定 model（Haiku 可能就夠？只是判斷值不值得）
- **維度**: 待定（內容深度？原創性？目標讀者價值？）
- **CP 文章**: 不過 → REJECT（跳過後續 pipeline）
- **非 CP 文章**: 不過 → WARNING + `NEEDS_HUMAN_REVIEW`（不自動 reject）
- **Max loops**: 0（不做 rewrite，pure gate）
- **目的**: 省 token — 不值得的文章不要浪費 4 stages 的 budget

### Stage 1: Vibe（Opus → Opus → Opus）

- **Judge**: vibe-opus-scorer agent, Opus
- **維度**: persona, clawdNote, vibe, clarity, narrative（5 維）
- **Pass bar**: composite >= 8, 至少一維 >= 9, 沒有任何維 < 8
- **Writer**: Opus, 沒有限制（可以大改）
- **Max loops**: 3
- **目的**: 確保文章有個性、有故事感、ClawdNote 有梗

### Stage 2: FreshEyes（Haiku → Opus）

- **Judge**: fresh-eyes agent, Haiku（模擬 3 個月經驗的新手工程師）
- **維度**: readability, firstImpression（2 維）
- **Pass bar**: composite >= 8
- **Writer**: Opus（readability improvement 需要文字功力）
- **Max loops**: 2
- **目的**: 確保新手讀者也能帶走 mental model

### Stage 3: FactLib（Worker-first design）

- **FactCorrector worker**: Sonnet, 主動掃全文修正事實錯誤
- **Librarian worker**: Haiku, 主動加 glossary links 和站內連結
- **Combined Judge**: 一個 judge 同時評 fact + library 維度
- **Judge model**: 待定（Opus 或 Sonnet）
- **Judge 維度**: 待定（從原本 7 個維度精簡）
- **Pass bar**: 待定
- **Max loops**: 2
- **Loop 機制**: judge fail → feedback 傳回 workers → workers 根據 feedback 修改 → re-judge

### Stage 4: Final Vibe（Opus → Opus, 嚴格限制）

- **Judge**: 同 Stage 1 的 vibe-opus-scorer（或 lighter variant）
- **維度**: 同 Stage 1（persona, clawdNote, vibe, clarity, narrative）
- **Pass bar**: 待定（跟 Stage 1 一樣嚴格？還是放寬？）
- **Writer**: Opus, 只能微調語氣
- **Max loops**: 待定（1 或 2）
- **目的**: 確認 Stage 2-3 的修改沒有破壞語氣

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

### Judge Output（FAIL 時）

- `improvements`: 每個低分維度的具體改善建議
- `critical_issues`: 1-3 個 root causes
- PASS 時省略（省 token）

---

## 待定問題（reviewer should clarify with CEO, if needed）

### Stage 0 相關

1. Stage 0 Worthiness judge 的 model？（Haiku 夠嗎？）
2. Stage 0 的評分維度？（內容深度、原創性、目標讀者價值？）
3. CP 文章的 reject 門檻？（多低才 reject？）
4. CP 文章未通過 Stage 0 的 status label: `MARKED_AS_UNQUALIFIED_FOR_REVIEW_BY_QUALITY_GATE`
   - UI 上顯示 banner 告訴 human：AI 品質門檻已標記此文不夠格，但尚未人工處理
   - Banner/UI 設計待 CEO 跟 reviewer 討論

### Stage 3 FactLib 相關

4. FactLib combined judge 的評分維度？（原本 7 個要精簡到幾個？）
5. FactLib combined judge 的 model？（Opus vs Sonnet）
6. FactCorrector 和 Librarian 分開 session 還是合併？
7. FactCorrector 第一次跑沒有 judge feedback — 怎麼知道要改什麼？

### Stage 4 Final Vibe 相關

8. Final Vibe pass bar？（同 Stage 1 / 放寬 / 失敗直接 human review）
9. Final Vibe max loops？

### 整體

10. Stage 1 Vibe 目前 2/3 fail rate — pass bar 太嚴還是 writer 品質問題？
11. Stage 5 Translation 的觸發時機？（自動 after publish？手動？）

---

## 不在範圍內

- 現有 v1 tribunal 繼續跑，v2 開發完成後才替換
- Frontmatter schema 不改（improvements/critical_issues 只存 progress JSON）
- 不做 parallel article processing（先 sequential，未來 per-article branch 可以開啟 parallel）
