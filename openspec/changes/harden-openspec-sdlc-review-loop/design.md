## Context

#481 把 openspec SDLC 流程定成 SSOT（`.agents/openspec-sdlc.md`）：九階段、三角色（controller / builder / reviewer）、兩個人類檢查點、archive 硬 gate。但階段 6 的收斂訊號是「兩個 reviewer 都滿意」——純 LLM 主觀判斷。

三層指揮鏈（本 change 新增頂層 coach）：

```
human = coach        ── 高層方向、拍板 critical design decision
   │                    只停兩座標：opsx explore + 審 proposal
   ▼
main agent = controller / orchestrator (mac-CC / CCC)
   │                    拆 task、給 spec、驗收、當 coach 介面；context 乾淨
   ▼
subagents = workers   ── builder（做）+ reviewer（審），各自獨立 context
```

## Goals / Non-Goals

**Goals:**
- 階段 6 收斂從「reviewer 滿意」升級為可機器判定（executable-first）。
- reviewer 的 rubric 明錨在該 change 的 spec scenario 上，收斂 = 所有 scenario 對上。
- escalation 有明確、可偵測的觸發（spec 唯讀牆）與順序（explore-first）。
- 把 human=coach 的頂層心智模型寫進 SSOT，讓 agent 知道自己在指揮鏈哪一格。

**Non-Goals:**
- 不重寫 #481 的九階段骨架、archive-gate、人類檢查點。
- 不規定 builder / reviewer 用哪種 runtime（Claude subagent / cmux / MCP）——沿用 #481「看環境能力決定」。
- 不在本 change 清理既有 20-change archive backlog（grandfathered）。

## Decisions

### D1：收斂訊號分三層，code 線 executable-first

關鍵洞察：**內容線（tribunal）用 LLM judge 是因為 prose 沒有客觀真值；code 有（測試）。** 所以 code 線不該 1:1 複製 tribunal 的主觀收斂。

```
Tier 1  executable  scenario→測試，綠才算對上   ← 盡量往這推（客觀）
Tier 2  judged      真測不了的→LLM judge 打分    ← fallback（主觀，需標記）
Tier 3  checkbox    agent 自報                   ← SHALL NOT 當唯一依據
```

收斂定義：**所有 Tier-1 scenario 測試綠 + 所有 Tier-2 scenario ≥ bar**。

### D2：escalation 邊界做成物理唯讀牆，而非抽象判斷

不教 builder「怎麼判斷這是不是 design decision」，改用可偵測訊號：**builder 的 writable scope 排除 `specs/**/*.md`**。一旦 builder 需要改 scenario 才能修好，就會撞唯讀牆——那一刻 = 勝利條件變了 = design decision = 升 coach。git-diff 等級可強制，不靠 LLM 自覺。

### D3：升級先 explore 再 propose

升上來的是問題不是答案；直接 propose = 在問題沒搞懂前就 commit 一個解。explore 是 thinking-partner 工具，先釐清 intent 再 propose。但 trivial（無 ambiguity）的 scenario 改可直接 propose，不把 explore 儀式化。

### D4：強制點沿用 #481 archive-gate 的「只驗證不執行」模式

spec 唯讀牆與 Tier-1 收斂的強制由 CI / guard 做「沒做就擋」，實際動作仍由 agent 跑——跟 archive-gate 同一個哲學，不新增執行責任給 CI。

## Risks / Trade-offs

- **R1：Tier-1 覆蓋率不足**。不是每條 scenario 都編得成測試；落 Tier-2 的比例太高，主觀性就漏回來。緩解：Tier-2 verdict 強制標記，coach 終審時能看見「有多少收斂是靠主觀」。
- **R2：Tier-2 仍有 Lv.4 不動點風險**（reviewer+builder 互捧）。緩解：reviewer 獨立 context、fresh eyes；必要時 pin 不同 model（沿用 tribunal blind eval 經驗）。
- **R3：唯讀牆可能過嚴**——有些 scenario 的微調其實 trivial，硬升 coach 變成 ceremony。緩解：D3 的「trivial 可直接 propose」當逃生閥；coach 端判斷成本低（只看一條 scenario diff）。
- **R4：max-N 取值**。太小會把正常 iterate 誤判成卡關、太大失去「有界」意義。先取 tribunal 既有的 3，apply 後依實際 churn 校準。
