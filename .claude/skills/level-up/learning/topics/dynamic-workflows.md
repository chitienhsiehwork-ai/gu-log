# Dynamic Workflows 與 task/token 效率

## Current Level
- Status: learning（Lv.1-4 過，進 Lv.5 dynamic workflow 本體）
- Last updated: 2026-07-13
- Confidence: 高（learner 已 mastered spec-driven SDLC / tribunal，直接高段位開講）

## Evidence
- 2026-07-13: workflow vs agent 的 control-flow 判準一次答對（固定 5 出口的 ticket 分類 → routing workflow，不需 model 握 control flow），並正確排除「語意理解 = 需要 agent」的誘餌。
- 2026-07-13: 自己提出「include/exclude 決策應該內嵌在每關、不要攢到最後」——等於自行推導出 evaluator-in-the-loop 優於 end-stage 驗收，直接用在學習流程設計上。
- 2026-07-13: orchestrator-workers 分界（runtime dispatcher 決定派哪些 judge）MCQ 答對。
- 2026-07-13: multi-agent 何時值得 15× token（廣度可平行 + 超過單一 context + 任務價值）MCQ 一次答對，並正確排除「序列 evaluator-optimizer 假扮 multi-agent」誘餌。
- 2026-07-13: context engineering 四招中 isolate+compress 組合（subagent 髒活隔離 + 只回結論）MCQ 一次答對。
- 2026-07-13: 主動抓航向 drift——指出教學一直在講 multi-agent 而非主目標 dynamic workflow。回應：補上「dynamic（結構何時決定）⊥ multi-agent（worker 數量）」正交性澄清，Lv.5 轉正為 dynamic 本體。
- 2026-07-13: 憑對自家 tribunal 的正確直覺（「有很多 rewriter↔judge loop」）抓到教學者的事實 drift，並要求派 subagent ground-truth。實查結果：tribunal.sh 是 4 個 sequential stage、每 stage 各自帶 judge→writer→re-judge loop（= 四個 evaluator-optimizer 串 chain），非 parallelization；過標由 check_pass_bar code 判定，judge verdict 不算數。

## Known Gaps
- （2026-07-13 曾把「worker 在做評估」誤判成 evaluator-optimizer，但後續證明其直覺（tribunal 有 rewrite loops）比出題者的題目前提更接近實作。pattern 形狀判準已在重驗 MCQ 證實掌握 → 移出 gap。）

## Teaching Notes
- MCQ 互動協定（learner 指定，已寫進 SKILL.md）：多題編號 1/2/3 + ABCD，接受 `1A 2D` 極簡回覆；MCQ 同時當決策工具（[理解] / [判決] 混排），判決包成選項而不是「我建議 X 有異議再說」。
- 框架沿用 Vainglory 高端類比（教練賽前腳本 = workflow / captain 場上 shotcall = agent / dynamic workflow = 宏觀腳本+微觀 shotcall），命中。
- 可直接掛在已 mastered 的 coach(macro) vs players(micro)（spec-driven SDLC）上。
- 本輪同時是 gu-log 選材任務：每關結尾做該關素材的 include/exclude 判決（learner 指定的流程）。

## 素材事實（ground-truthed）
- gu-log 已有 SP-214（2026-06-02，zh+en，tribunal v8 過）= Anthropic dynamic workflows 官方公告翻譯。新文章 dedup 底線：不重複公告的 what/how。
- Claude Code dynamic workflows（research preview）：runtime 生成 JS 編排腳本、確定性執行、1000 agent / 16 併發上限、budget API、ultracode 常駐 opt-in。對應框架：generate 級 dynamic + 生成後 static 執行的混血；script-holds-the-loop = write+isolate+compress。

## Scope 判決（gu-log 文章素材，逐關累積）
- Lv.1 workflow vs agent 判準：**include**，但 learner 修正角度——不轉述 Anthropic 2024「不要建 agent」教條（已過時：2026 baseline 是人人有 Claude Code/Codex 現成 agent），改寫成「agent vs workflow trade-off + 什麼時候從 agent 手上拿回 control flow」。吐槽點：2024 聖經 2026 還被原文背誦。
- Lv.2 五大 patterns：**include**，但不做名詞解釋文——用自家 tribunal 當實例講「pattern 名字描述 control flow 形狀（有無回饋循環、拆解權在誰手上）」+「真實系統是 pattern 組合技（tribunal = 四個 evaluator-optimizer 串 chain）」+「code wins over agent verdict（check_pass_bar）」。附教訓：憑印象描述系統形狀會翻車，要讀實作。

## Next Suggested Levels
- Lv.2 五大 workflow patterns 光譜 → Lv.3 token 經濟學 → Lv.4 context engineering 四招 → Lv.5 dynamic runtime graphs 研究前緣 → Lv.6 彙整骨架
