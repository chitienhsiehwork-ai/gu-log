# Tribunal v2 — Tests-as-Spec (TDD Planning)

> Status: **Pseudo code only — not runnable**
> Purpose: Teaching artifact for CEO (junior backend eng) + spec handoff for Builder
> Date: 2026-04-11
> Author: Test Writer agent (Opus), per team-lead brief

---

## 這份文件要幹嘛

Tribunal v2 的 mental model 和 decisions 都 locked 了（見 `.score-loop/specs/`），但**還沒寫任何 code**。這份 pseudo code 是 **test-first spec** — 你可以把它讀成「未來 Builder 要讓這些 invariants 成立」。

但更重要的是，它是**教學**。每個 test 檔案都有 What / Why / Pros / Cons / Alternatives，告訴你：

- 哪些東西值得寫 test（deterministic、高價值、低維護成本）
- 哪些東西**不值得寫 test**（LLM quality、主觀、需要 eval dataset）
- 哪些東西**延後寫**（等 impl 穩定再說）

這是 TDD 階段最難學的事：**分辨「該測」和「不該測」**。

---

## 核心哲學：TDD 階段的 Test Triage

### ✅ 該測（deterministic、高價值）

    這些東西**不需要跑 LLM 就能測**，只要餵 input 就能 assert output。寫一次、跑一輩子，regression 保護很紮實。

| 類別                         | 範例                                             | 為什麼值得測                                          |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| **Programmatic constraints** | Writer diff check (URLs/headings 不變)           | LLM 靠 prompt 守不住，只能靠 script enforce           |
| **Pure logic functions**     | Pass bar calculation, relative degradation       | 一行公式，改壞會立刻壞很多篇文章                      |
| **Schema validation**        | Judge output shape, frontmatter Zod schema       | Upstream 壞掉，downstream 全部崩                      |
| **State machine**            | Stage transitions (PASS/FAIL/retry/NEEDS_REVIEW) | 迴圈 cap 錯了會燒死 quota                             |
| **String parsing**           | Git commit message format, LUXURY_TOKEN audit    | 以後要 `git log --grep` 靠這個吃飯                    |
| **Contract tests**           | Mock LLM 但驗 prompt 結構                        | 抓到「有沒有把 checklist 塞進 prompt」這種 regression |

### ❌ 不該測（主觀、非 deterministic、需要 ground truth）

這些東西寫 unit test 會**假陽性**或**假陰性**，浪費你的時間。

| 想測的                                  | 為什麼不該寫 unit test                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| **Vibe 好不好**                         | 主觀判斷，沒有 oracle                                        |
| **FactCorrector 真的找到錯誤嗎**        | 需要 eval dataset（標註過的文章集）才能測                    |
| **ClawdNote 梗好不好笑**                | 人類都無法 agree，測個屁                                     |
| **Judge calibration（分數準不準）**     | 需要 human-labeled ground truth                              |
| **實際翻譯品質**                        | 同上                                                         |
| **LLM 真的遵守 negative constraint 嗎** | 測不到 — 只能測「我們有沒有用 programmatic diff check 兜底」 |

這些東西要靠**人肉 review + 長期 metrics (`completion_rate`, `dwell_time`)**，不是 unit test。

### ⏳ 延後測（等 impl 穩定才寫）

現在寫這些 test 會變成「追著 API 改」的 maintenance 地獄。等 Builder 跑完第一版，再回來補。

- End-to-end pipeline run（一篇文章真的跑完 Stage 0-5）
- Quota pacing 在高 load 下的行為
- Heartbeat cron 真的呼叫 Telegram
- 實際 publish 到 Vercel 後的 banner 呈現（Playwright E2E）
- Cross-run retry cap 在多次失敗後真的 mark `NEEDS_REVIEW`

我們**寫 skeleton**（空殼 describe/it）但不實作，當作 TODO list。

---

## Test 分層哲學（3 層）

```
┌────────────────────────────────────────────────────────────┐
│  Layer 3: Integration (slow, real LLM or real pipeline)  │ ← 延後
│  ────────────────────────────────────────────────────────  │
│  Layer 2: Contract (mock LLM, verify prompt/response)    │ ← 部分現在寫
│  ────────────────────────────────────────────────────────  │
│  Layer 1: Unit (pure functions, no I/O)                   │ ← 大部分現在寫
└────────────────────────────────────────────────────────────┘
```

**Layer 1 — Unit tests**: 純函數、no mocking、no I/O。跑得飛快。範例：`calculatePassBar(scores)`、`isRelativeDegraded(stage1, stage4)`、`parseCommitMessage(msg)`。

**Layer 2 — Contract tests**: 假設 LLM 是黑盒子，只驗我們自己的 code。用 JSON fixture 當 mock response，或 mock HTTP 層 capture prompt body。範例：「FactCorrector 送給 Opus 的 prompt 有沒有包含 standing checklist 的 7 條」。

**Layer 3 — Integration tests**: 真的跑 pipeline、真的打 Claude API。**現階段不寫**，只留 skeleton。

> Junior eng tip: 85% 的 test 應該在 Layer 1, 10% 在 Layer 2, 5% 在 Layer 3。如果你發現自己想寫一堆 integration test，通常代表 Layer 1 的 code 被設計成難以 unit test（太多 I/O 耦合在一起）— 這是 design smell，不是 test 問題。

---

## Pseudo Code 檔案索引

每個檔案都是獨立的 teaching artifact。建議照順序讀 01 → 09。

| #   | 檔案                                     | 這個測什麼                                                                   | 難度 |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| 01  | `pseudo/01-writer-constraints.pseudo.ts` | Programmatic diff check — URLs/headings/frontmatter 在 writer 跑完後必須不變 | ★★☆  |
| 02  | `pseudo/02-pass-bar.pseudo.ts`           | Pass bar 公式（Stage 1 absolute, Stage 4 relative）                          | ★☆☆  |
| 03  | `pseudo/03-judge-schemas.pseudo.ts`      | Judge output JSON 的 shape validation（Zod / TS types）                      | ★★☆  |
| 04  | `pseudo/04-fact-corrector.pseudo.ts`     | Standing checklist 塞進 prompt、source URL fetch、ClawdNote scope 排除       | ★★★  |
| 05  | `pseudo/05-stage-transitions.pseudo.ts`  | Stage 之間的 state machine（PASS/FAIL/retry/max loops/NEEDS_REVIEW）         | ★★★  |
| 06  | `pseudo/06-frontmatter.pseudo.ts`        | Frontmatter schema 擴充（`warnedByStage0`, `warnReason`, `stage4Scores`）    | ★☆☆  |
| 07  | `pseudo/07-banner-rendering.pseudo.ts`   | Banner UI 從 frontmatter 讀資料並渲染（Astro component）                     | ★★☆  |
| 08  | `pseudo/08-git-commit-format.pseudo.ts`  | Squash merge commit message 嵌 stage summary、`git log --grep` 找得到        | ★★☆  |
| 09  | `pseudo/09-luxury-token-audit.pseudo.ts` | `scripts/luxury-token-audit.sh` 能正確 grep 到所有 LUXURY_TOKEN 標記         | ★☆☆  |

---

## 怎麼讀這份 spec

1. **先讀 README**（你現在在讀的這個）— 理解分層哲學 + triage 思維
2. **挑一個 pseudo code 檔案** — 從 01 開始最順
3. **讀 `What / Why / Pros / Cons / Alternatives` header** — 這才是 teaching，pseudo code 只是例證
4. **看 MCQ**（在 chat 裡 team-lead 會傳給你）— 你的答案決定 Builder 的 impl 方向
5. **你的決策寫到 `_decisions.md`** — Test Writer 會幫你 fill

---

## 給 Builder 的 note（未來讀到這份檔案的人）

- 這些 pseudo code 不是 runnable test — 是 **spec written in code shape**
- 把它當 TDD 的 "red" 階段：先有這些 assertion，再寫 impl 讓它們過
- 真正的 test 檔案會放在 `tests/tribunal-v2/*.spec.ts`（dot spec，不是 dot pseudo）
- `_decisions.md` 是 CEO level-up 過程中做的 MCQ 決定，impl 時要對照

---

## 看完這份要學到的東西（for CEO）

- [ ] 能判斷一個需求「該用 unit test / contract test / 還是根本不該 unit test」
- [ ] 理解「mock 要切在哪一層」的 trade-off
- [ ] 理解「為什麼有些 LLM 行為 unit test 永遠測不到」
- [ ] 理解 TDD 的 "tests-as-spec" — test 是合約，不是事後補的 regression safety net
- [ ] 對 tribunal v2 的每個 component 有個 mental model 知道 Builder 會怎麼實作

Go ٩(◕‿◕｡)۶
