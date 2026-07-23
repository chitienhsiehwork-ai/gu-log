# Spec-Driven SDLC loop (openspec + multi-agent delegation, gu-log)

> 記耐久結論，不記「在第幾關 / 選了哪個字母」這種 session-local 過程（見 `docs/agent-discipline.md`〈寫 prompt / 規則〉）。

## Current Level
- Status: mastered（full clear；五個概念 + 四個自己推導的 refinement，全程 learner 主導推導）
- Last updated: 2026-06-22
- Confidence: 高 on 整套架構；落地 build 尚未開始（那是 build task，不是 learning gap）

## Evidence（已證明掌握的概念）
- spec = SSOT、code = derived；人類的價值在定義 intent / objective，不在親手補每一刀。
- 自己把類比從 captain 升級成 coach：coach 定 macro / 方向但不碰 micro；agents micro 強但不會自己長出隊伍方向，而 coach 的 touchpoint 只有「賽前」一次，開打後補不回來。
- 自己重新發明 spec-altitude 原則：spec 要寫在「可觀察行為 / 換個實作還滿不滿足」的海拔；function name 出現在 spec 是 smell，該踢到 tasks.md / code。並把自己最初的「只寫 user behavior」修正為「可觀察 / 合約行為」（無 end-user 的系統內部 behavior 也算）。
- 自己設計出實作 loop：high-bar reviewer + simplifier + implementor 迭代到收斂，3 輪不過或撞 design decision 才升 coach——等同 repo 既有 tribunal 架構（writer + judges + max-3 + 升級）。明確不想讀 conformance report，要把 human 從常規路徑整個拔掉、只在例外被 ping。
- 掌握收斂錨點：reviewer + implementor 會收斂到「彼此滿意」但漂離 intent 的不動點（收斂 ≠ 正確）；錨點 = reviewer 照 spec scenario 當 rubric 打分，如 tribunal 照 vibe-scoring-standard.md。
- 掌握 granularity + escalation 邊界：動到 scenario / 合約才升 coach（= design decision）；否則 implementor in-lane atomic 修，不開新 proposal、不爆 change debt。
- 自己再修正：escalation 先 `opsx explore`（surface 的是問題不是答案）再 `opsx propose`；並指出別把 explore 儀式化（trivial scenario 改可直接 propose）。

## 核心結論（系統的鋼筋）
一條 behavior-level spec scenario 同時扮演三角色：coach 的 **gate** + reviewer loop 的 **rubric** + escalation 的 **邊界**。coach 在系統裡只有兩個座標：**opsx explore（釐清 intent）+ 審 proposal（gate）**。

## Known Gaps / Open
- 純 learning gap 已清。剩下的是 **build task**：把 tribunal 架構從內容線移植到 code/實作線（rubric 換成 spec scenario）——尚未開始。

## Teaching Notes
- 框架：coach（不是場上 captain）。Vainglory 高端玩家——直接用進階機制（objective timing / ward / shotcall / draft / scrim dummy），不要從新手村解釋。
- 講數字前先現讀 SSOT（這位 learner 會抓 fact drift）。
- 這位 learner 跑很快、會自己往前推導下一步並反駁弱設計——順著他的推導去 harden、插眼擋漂移，不要硬塞既定流程。整場由他主導推導，教學者角色 = 防漂 + 驗收。
