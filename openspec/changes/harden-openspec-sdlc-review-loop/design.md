## Context

#481 把 openspec SDLC 流程定成 SSOT（`.agents/openspec-sdlc.md`）：九階段、三角色（controller / builder / reviewer）、兩個人類檢查點、archive gate。但階段 6 的收斂訊號是「兩個 reviewer 都滿意」——純 LLM 主觀判斷。

三層指揮鏈（本 change 新增頂層 coach）：

```
human = coach        ── 高層方向、拍板 critical design decision
   │                    介入點：opsx explore + 審 proposal(①) + 終審(②) + escalation 例外
   ▼
main agent = controller / orchestrator (mac-CC / CCC)
   │                    拆 task、給 spec、聚合 verdict 做收斂判定、當 coach 介面；context 乾淨
   ▼
subagents = workers   ── builder（做）+ reviewer（審、產逐條 verdict），各自獨立 context
```

## Goals / Non-Goals

**Goals:**
- 階段 6 收斂從「reviewer 滿意」升級為可機器判定（executable-first）。
- reviewer 的 rubric 明錨在該 change 的 spec scenario 上；收斂 = 所有 scenario 對上 AND 簡潔度 reviewer 無 blocking finding（雙軌都保留）。
- escalation 有明確、可偵測的觸發（spec 唯讀牆）與順序（explore-first）。
- 把 human=coach 的頂層心智模型寫進 SSOT，讓 agent 知道自己在指揮鏈哪一格。

**Non-Goals:**
- 不重寫 #481 的九階段骨架、兩個人類檢查點、controller/builder/reviewer 分工。
- 不規定 builder / reviewer 用哪種 runtime（Claude subagent / cmux / MCP）——沿用 #481「看環境能力決定」。
- 不在本 change 清理既有 archive backlog（grandfathered）。

## Decisions

### D1：收斂訊號分三層，code 線 executable-first

關鍵洞察：**內容線（tribunal）用 LLM judge 是因為 prose 沒有客觀真值；code 有（測試）。** 所以 code 線不該 1:1 複製 tribunal 的主觀收斂。

```
Tier 1  executable  scenario→測試，綠才算對上   ← 盡量往這推（客觀）
Tier 2  judged      真測不了的→LLM judge 判 binary 對上/未對上  ← fallback（主觀，需標記）
Tier 3  checkbox    agent 自報                   ← SHALL NOT 當唯一依據
```

收斂定義：**所有 Tier-1 scenario 測試綠 + 所有 Tier-2 scenario 經 reviewer 判為對上（binary，非分數）+ 簡潔度 reviewer 無未解 blocking finding**。

**誠實揭露（本 change 自己 dogfood）**：這個 change 自身的 requirement 多半是流程 / 文件型（角色頂層、escalation 語意、唯讀牆 policy），**難編成 Tier-1 測試**——唯一可能 Tier-1 的是「唯讀牆」（強制形態未定，見 D4）。其餘落 Tier-2（reviewer 照 scenario 判 + 散文與 spec 一致性）。也就是說本 change 自己就是 R1「Tier-1 覆蓋率不足」的活例——這不削弱 D1，反而證明 D1 的價值：**明確標記哪些靠主觀，比假裝全部客觀誠實**。

### D2：escalation 邊界做成「builder 對 spec 唯讀」的可偵測訊號

不教 builder「怎麼判斷這是不是 design decision」，改用可偵測訊號：**builder 對 openspec spec 檔唯讀**。一旦 builder 需要改 scenario 才能修好，就撞唯讀牆——那一刻 = 勝利條件變了 = design decision = 升 coach。強制形態見 D4（未定案）。

### D3：升級先 explore 再 propose

升上來的是問題不是答案；直接生完整 change = 在問題沒搞懂前就 commit 一個解。explore 是 thinking-partner 工具，先釐清 intent。但 trivial（無 ambiguity）的 scenario 改可跳過 explore，不儀式化。（**注意**：對一條 in-flight change 的 scenario 微調，「一律走新 propose」vs「coach 核可後 controller in-place 改 delta」是流程重量的方向決策——見「需 coach 拍板」。）

### D4：唯讀牆強制形態未定（需 coach 拍板）+ 一個查證出來的 drift

**查證發現（load-bearing）**：#481 宣稱「archive 由 CI 硬 gate」，但 `.github/workflows/` 實際**沒有**這個 gate（grep 全空，ci.yml 只有 lint / type-check / validate-content / security-gate / unit-tests / build 等 job）——archive-gate 目前是 **doc-only**。所以本 change **不能**「沿用 archive-gate CI 模式」（它不存在）。

唯讀牆的強制形態是 open decision，三個候選都**不需要**先建 archive-gate CI：

- **(a) runtime PreToolUse hook**：對 builder subagent deny 寫入 `openspec/**/specs/**/*.md`。repo 有 `.claude/hooks/block-no-verify.sh` 先例，deterministic；但 #481 明訂不綁 runtime，cmux/codex builder 蓋不到。
- **(b) 近似 CI 檢查**：PR 裡「同一 commit 同時動 spec delta + 實作檔」視為違規。不需要歸因到 builder identity（CI 做不到 per-commit 歸因）。
- **(c) doc-only policy + reviewer 覆核**：最輕、最弱，靠 reviewer 抓。

## Risks / Trade-offs

- **R1：Tier-1 覆蓋率不足**。不是每條 scenario 都編得成測試；落 Tier-2 的比例太高，主觀性就漏回來。緩解：Tier-2 verdict 強制標記 + reviewer 覆核 Tier 分類（不准把可測的推去 Tier-2），coach 終審能看見「有多少收斂是靠主觀」。
- **R2：Tier-2 仍有不動點風險**（reviewer+builder 互捧）。緩解：reviewer 獨立 context、fresh eyes；必要時 pin 不同 model（沿用 tribunal blind eval 經驗）。
- **R3：唯讀牆可能過嚴**——有些 scenario 的微調其實 trivial，硬升 coach 變 ceremony。緩解：D3 的「trivial 可跳過 explore」+ coach 核可後 controller in-place 改 delta 的輕量路徑（見需拍板項）。
- **R4：max-N 取值**。太小把正常 iterate 誤判成卡關、太大失去「有界」意義。先取 tribunal per-stage `max_loops`（2–3）的量級，apply 後依實際 churn 校準；N 的家未定（見需拍板項）。
- **R5：sync-back drift（本 change 自己製造）**。requirement 寫在 openspec spec，apply 又 sync 回 `.agents/openspec-sdlc.md` 散文 = 雙寫。緩解：**權威端 = openspec spec（archive 後進 `openspec/specs/`），`.agents/openspec-sdlc.md` 散文是 derived view，對不上時散文服從 spec**；tasks 5.3 的「無 drift」驗證 SHALL 點明這個方向性；sync 時不要把「13 行 shim」這種計數帶進散文。
- **R6：#481 的 archive-gate CI 是 doc-only（查證發現的既有 drift）**。`.agents/openspec-sdlc.md` 寫「archive 由 CI 強制」，但 workflows 沒有對應 job。本 change 不依賴它；**是否在本 change 一起收這個 drift**（實作 gate，或把 #481 那句改成誠實）留給 coach（見需拍板項）。
