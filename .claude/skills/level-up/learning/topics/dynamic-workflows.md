# Dynamic Workflows 與 task/token 效率

## Current Level
- Status: learning（Lv.1 過，進 Lv.2）
- Last updated: 2026-07-13
- Confidence: 高（learner 已 mastered spec-driven SDLC / tribunal，直接高段位開講）

## Evidence
- 2026-07-13: workflow vs agent 的 control-flow 判準一次答對（固定 5 出口的 ticket 分類 → routing workflow，不需 model 握 control flow），並正確排除「語意理解 = 需要 agent」的誘餌。
- 2026-07-13: 自己提出「include/exclude 決策應該內嵌在每關、不要攢到最後」——等於自行推導出 evaluator-in-the-loop 優於 end-stage 驗收，直接用在學習流程設計上。

## Known Gaps
- （尚無）

## Teaching Notes
- 框架沿用 Vainglory 高端類比（教練賽前腳本 = workflow / captain 場上 shotcall = agent / dynamic workflow = 宏觀腳本+微觀 shotcall），命中。
- 可直接掛在已 mastered 的 coach(macro) vs players(micro)（spec-driven SDLC）上。
- 本輪同時是 gu-log 選材任務：每關結尾做該關素材的 include/exclude 判決（learner 指定的流程）。

## Scope 判決（gu-log 文章素材，逐關累積）
- Lv.1 workflow vs agent 判準：待判

## Next Suggested Levels
- Lv.2 五大 workflow patterns 光譜 → Lv.3 token 經濟學 → Lv.4 context engineering 四招 → Lv.5 dynamic runtime graphs 研究前緣 → Lv.6 彙整骨架
