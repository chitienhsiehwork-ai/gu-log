## 1. 角色頂層心智模型（E）

- [ ] 1.1 在 `.agents/openspec-sdlc.md` 的「三個角色」小節上方加一層：human = coach、main agent = controller、subagents = workers，明訂 coach 的介入點 = explore + 審 proposal(①) + 終審(②) + escalation 例外
- [ ] 1.2 三層角色頂層 sync 進 `.agents/openspec-sdlc.md` 本體（流程 SSOT）；`AGENTS.md` 路由表指標已加（本 PR）；**不動 `CLAUDE.md`**（sync 時不要帶「13 行 shim」這種會過期的計數）
- [ ] 1.3 明訂 controller 聚合 reviewer verdict + 測試結果做收斂判定（= #481「驗收」職責），不讓渡給單一 reviewer

## 2. 收斂訊號 executable-first（A）+ scenario rubric（B）+ 雙軌

- [ ] 2.1 改寫 `.agents/openspec-sdlc.md` 階段 6：把「兩個 reviewer 都滿意」換成三層收斂（Tier-1 測試綠 / Tier-2 LLM judge binary / Tier-3 不可單獨採信）
- [ ] 2.2 規定正確性 reviewer 的輸出格式：逐條列出每個 spec scenario 的對上／未對上 + 所屬 Tier
- [ ] 2.3 定義收斂判定：所有 Tier-1 scenario 測試綠 AND 所有 Tier-2 scenario 經 reviewer 判為對上（binary）AND 簡潔度 reviewer 無未解 blocking finding
- [ ] 2.4 規定 Tier-2（主觀）verdict 必須明確標記，供 controller 聚合與階段 8 終審辨識
- [ ] 2.5 規定 builder 交 scenario→tier 清單（Tier-1 附測試）；正確性 reviewer 覆核分類與 test↔scenario 對應忠實度，可把「不可測」宣稱打回 Tier-1

## 3. Escalation 機制（C + D）

- [ ] 3.1 階段 6 iterate 加 max-N 上限；耗盡帶未對上 scenario + 未解簡潔度 finding 升 coach
- [ ] 3.2 寫明升級順序：先 `opsx explore` 釐清，trivial 無 ambiguity 可跳過
- [ ] 3.3 規定 builder 的 writable scope 排除 `openspec/**/specs/**/*.md`（main specs + change delta 都對 builder 唯讀；階段 7 archive 由 controller 動）
- [ ] 3.4 撞唯讀牆（需改 scenario）= design decision，自動停手升 coach；coach 核可後由 controller 改 delta、迴圈以新合約重啟輪數重計

## 4. 唯讀牆強制點（形態待 coach 拍板，見 design D4）

- [ ] 4.1 依 coach 拍板的強制形態實作唯讀牆：(a) runtime PreToolUse hook / (b) 近似 CI「同 commit 動 spec + 實作 = 違規」/ (c) doc-only + reviewer 覆核
- [ ] 4.2 **不依賴不存在的 archive-gate CI**（查證：workflows 無此 job）；若 coach 決定一併收 archive-gate doc-only drift，另立 task

## 5. 驗證

- [ ] 5.1 `openspec validate harden-openspec-sdlc-review-loop --strict` 通過
- [ ] 5.2 `openspec validate --all` 通過
- [ ] 5.3 `.agents/openspec-sdlc.md` 與本 spec 的 requirement 對得上（無 drift；spec 權威、散文 derived）
- [ ] 5.4 跑一個小 change 走完階段 6，確認三層收斂 + 雙軌 + 唯讀牆 escalation 實際 work
