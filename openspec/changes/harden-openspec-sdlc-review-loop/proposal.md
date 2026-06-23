## Why

#481（`.agents/openspec-sdlc.md`）已經把 gu-log 的 openspec SDLC 流程定成 SSOT：九階段、三角色（controller / builder / reviewer）、兩個人類檢查點、archive 當 merge 前硬 gate。骨架是對的，但**階段 6「實作審查」的收斂訊號是 LLM 主觀的**——doc 只說「兩個 reviewer 都『滿意』才算過」。

「reviewer 滿意」會收斂到「reviewer 跟 builder 彼此滿意」的不動點，而那個點可能已經漂離 spec 的 intent（收斂 ≠ 正確）。內容線（tribunal）被迫用 LLM judge，是因為 prose 沒有客觀真值；但**程式碼有**——測試會跑、會紅綠。照搬 tribunal 的主觀收斂 = 主動把 code 線降級到內容線的主觀性。

同時 #481 缺一層**心智模型的頂端**：它定義了 main-agent 內部的 controller/builder/reviewer，但沒把「human = coach」這層畫進去，導致 agent 不清楚自己在整個指揮鏈的哪一格。

## What Changes

- **新增 capability `spec-driven-review-loop`**，把階段 6 的收斂從「reviewer 滿意」升級為可機器判定，並補上 #481 沒有的 escalation 機制與角色頂層。具體：
  - **(A) Executable-first 收斂**：scenario 能編成測試的走 Tier-1（測試綠才算對上），真測不了的才落 Tier-2（LLM judge 照 scenario 文字打分），checkbox 自報 SHALL NOT 當唯一收斂依據。
  - **(B) Scenario 當 rubric**：正確性 reviewer SHALL 照該 change 的 spec scenario 逐條打分；收斂定義 = 「所有 scenario 對上」，不是「reviewer 沒話講」。
  - **(C) Escalation 機制**：(C1) 升 coach SHALL 先 `opsx explore` 再 `opsx propose`；(C2) builder 的 writable scope SHALL 排除 spec deltas——需要改一條 scenario 才能修好 = 撞唯讀牆 = design decision 訊號，自動升級。
  - **(D) 有界迴圈**：階段 6 的 iterate SHALL 有上限（max-N 輪），耗盡即升 coach，取代 #481 的無界「沒過就 iterate」。
  - **(E) 角色頂層心智模型**：明訂三層指揮鏈——**human = coach**（高層方向、拍板 critical design decision）、**main agent（mac-CC / CCC）= controller / orchestrator**、**subagents = workers（builder / reviewer）**。

- **Apply 階段會把上述 requirement sync 回 `.agents/openspec-sdlc.md`**（#481 的 prose SSOT），讓 doc 與此 spec 一致。

## Capabilities

### New Capabilities
- `spec-driven-review-loop`: openspec 階段 6 審查迴圈的行為規格——三層角色頂層、executable-first 收斂、scenario-as-rubric、有界迭代、explore-first + spec 唯讀牆的 escalation。

### Modified Capabilities
<!-- 無既有 openspec spec 涵蓋 SDLC 流程；#481 是 .agents/ 下的 prose doc，非 openspec capability，故此處為 New 而非 Modified。 -->

## Impact

- **`.agents/openspec-sdlc.md`** — 主要 sync 目標：階段 6 改寫成 executable-first + scenario-rubric + 有界，補 escalation 小節與三層角色頂層。
- **`AGENTS.md`（Tier-0 路由表）** — openspec-sdlc 流程指標已加（本 PR 完成，根治「agent 找不到流程 SSOT」的 friction；#484 context-tiering 後該指標住主題路由表）。三層角色頂層心智模型於 apply 階段 sync 進 `.agents/openspec-sdlc.md` 本體。**不動 `CLAUDE.md`**——#484 後它只剩 13 行 Claude-Code 專屬 shim（`@AGENTS.md` import），SDLC 描述不住那。
- **CI / guard（apply 階段）** — builder 的 spec-delta 唯讀邊界需要一個可執行的強制點（git-diff 等級偵測，沿用 #481 archive-gate「只驗證不執行」的模式）。
- **不影響**：#481 的九階段骨架、archive-gate、兩個人類檢查點、controller/builder/reviewer 分工——這些維持不變，本 change 只強化階段 6 的收斂與 escalation。
