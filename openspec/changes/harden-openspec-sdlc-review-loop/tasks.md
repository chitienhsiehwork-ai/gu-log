## 1. 角色頂層心智模型（E）

- [x] 1.1 在 `.agents/openspec-sdlc.md` 加 coach 頂層：human = coach、main agent = controller、subagents = workers，coach 介入點 = explore + 審 proposal(①) + 終審(②) + escalation 例外
- [x] 1.2 sync 進 `.agents/openspec-sdlc.md` 本體；`AGENTS.md` 路由表指標已加（本 PR）；不動 `CLAUDE.md`、不帶「13 行 shim」計數
- [x] 1.3 明訂 controller 聚合 reviewer verdict + 測試結果做收斂判定（= #481「驗收」職責）

## 2. 收斂訊號 executable-first（A）+ scenario rubric（B）+ 雙軌

- [x] 2.1 改寫階段 6：三層收斂（Tier-1 測試綠 / Tier-2 LLM judge binary / Tier-3 不可單獨採信）
- [x] 2.2 正確性 reviewer 輸出格式：逐條列每個 scenario 對上／未對上 + 所屬 Tier
- [x] 2.3 收斂判定 = Tier-1 綠 AND Tier-2 對上 AND 簡潔度無 blocking
- [x] 2.4 Tier-2 verdict 明確標記，供 controller 聚合與階段 8 終審辨識
- [x] 2.5 builder 交 scenario→tier 清單；正確性 reviewer 覆核分類與 mapping 忠實度

## 3. Escalation 機制（C + D）

- [x] 3.1 階段 6 加 max-N = 3（tunable、SSOT 在 .agents/openspec-sdlc.md）；耗盡升 coach
- [x] 3.2 升級先 `opsx explore`，trivial 可跳過
- [x] 3.3 builder writable scope 排除 `openspec/**/specs/**/*.md`（main specs + delta）
- [x] 3.4 撞牆升 coach；coach 核可後 controller 改 delta、迴圈重啟輪數重計

## 4. 唯讀牆強制點（coach 拍板：(b) 近似 CI + (c) reviewer backstop）

- [ ] 4.1 實作近似 CI 檢查：PR 裡「同一 commit 同時動 openspec spec 檔 + 實作檔」視為違規（script + ci.yml job，warn-only MVP）
- [x] 4.2 reviewer backstop 寫進階段 6：正確性 reviewer 覆核 builder 有沒有偷改 scenario
- [x] 4.3 收 drift：`.agents/openspec-sdlc.md`「archive 由 CI 強制」改誠實（現況 = policy、CI 尚未實作）

## 5. 驗證

- [ ] 5.1 `openspec validate harden-openspec-sdlc-review-loop --strict` 通過
- [ ] 5.2 `openspec validate --all` 通過
- [ ] 5.3 `.agents/openspec-sdlc.md` 與本 spec 的 requirement 對得上（spec 權威、散文 derived）
- [ ] 5.4 近似牆 script 本地測：propose/archive commit 不誤殺、spec+實作混動 commit 被抓
