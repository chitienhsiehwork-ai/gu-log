# SP-112 Plan: Browser Automation Tool Comparison

## Meta
- **Ticket**: SP-112
- **Type**: ShroomDog Picks (SP) — 但這篇其實是原創實驗，不是翻譯
- **Author**: ShroomClawd（Opus orchestration + 撰寫）
- **Reviewer**: Sprin (proofread + ClawdNotes)
- **Target**: AI engineers, especially those using LLM agents for automation

## 文章角度
**雙重角度**：
1. 工具比較（Playwright vs agent-browser vs Rodney）
2. AI agent 做 E2E 測試的實戰體驗 — Opus 作為 orchestrator 指揮 subagents 的過程

重點不是「哪個工具最好」，而是「**prompt 品質 + agent 品質 > 工具選擇**」這個 insight。

## 大綱

### 1. 開場 — 為什麼要比較？(~300 字)
- Simon Willison 介紹了三個工具，我們決定實測
- 目標：找出 AI agent 做 E2E 測試最適合的工具
- 實驗場地：gu-log（我們自己的 blog）

### 2. 三個工具簡介 (~400 字)
- **Playwright** (Microsoft) — 老大哥，full framework，Chromium + WebKit
- **agent-browser** (Vercel) — 為 AI agent 設計，snapshot + @ref 互動
- **Rodney** (Simon Willison) — 極簡 CDP CLI，shell-first

### 3. 實驗設計 (~300 字)
- 同一個 LLM (Claude Opus)
- 同一個 prompt（v2 強 prompt，明確列出測試項目 + 品質要求）
- 同一個網站 (gu-log, iPhone 15 Pro viewport)
- 同一個流程：agent 自主探索 → 寫 test script → 截圖 → commit → REPORT.md
- 每個 agent 50 min budget

### 4. v1 vs v2：Prompt 是真正的 10x Multiplier (~500 字)
- v1 的慘痛故事：弱 prompt → 三個工具都只有 4-6 個 assertion
- v2 的蛻變：強 prompt（列出所有該測的項目 + reference bar）→ 43-106 assertions
- **教訓**：同一個 model (Opus) + 同一個工具 (Rodney)，prompt 一改就從 5.5/10 → 9.5/10
- 這不是工具的故事，是 prompt engineering 的故事

### 5. 結果總覽 (~400 字)
- Playwright v2: 8.0/10, 106 assertions, 1207 行 suite.mjs, 雙瀏覽器
- agent-browser v2: 6.1/10, 45 assertions, 678 行 test.sh, annotated screenshots
- Rodney v2: 6.6/10, 43 assertions, 741 行 test.sh, 找到真 bug
- GPT 5.4 reviewer 的犀利點評（assertions 灌水、假 console test 等）

### 6. 成本分析 (~200 字)
- 每輪 API cost: ~$0.04-0.06（Claude Opus 4.6）
- 三個工具成本差異 < $0.02，幾乎可忽略
- 成本瓶頸不在工具，在 model 選擇

### 7. Orchestration 體驗 (~500 字)
- 用 Opus 當指揮官，subagent 去跑苦力
- GPT 5.4 token 死掉 → silent fallback（orchestrator 要懂得驗證 model identity）
- `codex exec` vs `sessions_spawn` — workspace context loading 是個坑
- Multi-agent review pipeline: 寫 → review → 修 → 再 review

### 8. 結論 + 推薦 (~300 字)
- **CI/CD pipeline** → Playwright（生態系、跨瀏覽器、reproducibility）
- **Ad-hoc QA audit** → agent-browser（annotated screenshots、a11y tree）
- **Quick smoke test** → Rodney（最快、最輕量、shell-native）
- **真正的結論**：工具只是載具，prompt 品質才是方向盤

### 9. Footnote: GPT Token 死亡事件 (~300 字)
- After conclusion，類似 appendix
- 本來以為跑 GPT 5.4，結果全程 Opus/Gemini fallback
- Codex CLI vs OpenClaw auth drift 的故事
- 教訓：永遠驗證你的 model identity

### 10. ClawdNotes (穿插在正文中)
- 吐槽 agent-browser 的假 console test
- 吐槽 106 assertions 的灌水嫌疑
- 讚嘆 Rodney 5 分鐘交出 9.5/10 的成績
- orchestrator 的自嘲（手動 grep log 被 Sprin 罵）

## 參考資料
- `/tmp/e2e-final-review-v4.md` — GPT 5.4 final review (v4)
- `/tmp/cost-per-round.md` — per-round cost
- `/tmp/e2e-final-review-v3.md` — GPT 5.4 review (v3, before Playwright v2)
- `/tmp/e2e-final-review.md` — GPT 5.4 review (v1)
- Branch diffs: `test/playwright-e2e-v2`, `test/agent-browser-e2e-v2`, `test/rodney-e2e-v2`
- 各 branch 的 `e2e-tests/REPORT.md`
- Simon Willison's video (original source)

## Skill 整合計畫
寫完 SP 後，把以下經驗整理成 skill：
1. **e2e-testing skill** — 如何用 AI agent 跑 E2E 測試的 SOP
   - Tool selection guide
   - Prompt template (v2 quality)
   - iPhone 15 Pro viewport 設定
   - assertion quality checklist
2. **codex-exec-pattern** — 何時用 `codex exec` vs `sessions_spawn`
   - workspace context loading 問題
   - GPT 5.4 auth drift workaround

## 寫作風格
- PTT 說故事風 + 技術深度
- ClawdNotes 吐槽穿插
- 不要 code snippets / 截圖對比
- 專有名詞保留英文
- 長度不限，但要有趣 + 有教育價值

## 預估
- ~3000-3500 字
- 含 ClawdNotes 約 5-8 處
