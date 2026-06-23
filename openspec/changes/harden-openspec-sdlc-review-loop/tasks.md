## 1. 角色頂層心智模型（E）

- [ ] 1.1 在 `.agents/openspec-sdlc.md` 的「三個角色」小節上方加一層：human = coach、main agent = controller、subagents = workers，明訂 coach 只停 explore + 審 proposal 兩座標
- [ ] 1.2 三層角色頂層 sync 進 `.agents/openspec-sdlc.md` 本體（流程 SSOT）；`AGENTS.md` 路由表指標已加（本 PR）；**不動 `CLAUDE.md`**（#484 後是 13 行 shim）

## 2. 收斂訊號 executable-first（A）+ scenario rubric（B）

- [ ] 2.1 改寫 `.agents/openspec-sdlc.md` 階段 6：把「兩個 reviewer 都滿意」換成三層收斂（Tier-1 測試綠 / Tier-2 LLM judge / Tier-3 不可單獨採信）
- [ ] 2.2 規定正確性 reviewer 的輸出格式：逐條列出每個 spec scenario 的對上／未對上 + 所屬 Tier
- [ ] 2.3 定義收斂判定：所有 Tier-1 scenario 測試綠 AND 所有 Tier-2 scenario ≥ bar
- [ ] 2.4 規定 Tier-2（主觀）verdict 必須明確標記，供階段 8 終審辨識

## 3. Escalation 機制（C + D）

- [ ] 3.1 階段 6 iterate 加 max-N（預設 3）上限；耗盡帶未對上 scenario 清單升 coach
- [ ] 3.2 寫明升級順序：先 `opsx explore` 再 `opsx propose`；trivial 無 ambiguity 可直接 propose
- [ ] 3.3 規定 builder 的 writable scope 排除 `specs/**/*.md`（spec delta 對 builder 唯讀）
- [ ] 3.4 撞唯讀牆（需改 scenario）= design decision，自動停手升 coach

## 4. 強制點（guard，沿用 archive-gate 模式）

- [ ] 4.1 設計 spec-delta 唯讀牆的可執行強制（git-diff 偵測 builder commit 有沒有動 `specs/`）；policy 在 doc、觸發以 workflow YAML 為準
- [ ] 4.2 確認強制點「只驗證不執行」，不新增執行責任給 CI

## 5. 驗證

- [ ] 5.1 `openspec validate harden-openspec-sdlc-review-loop --strict` 通過
- [ ] 5.2 `openspec validate --all` 通過
- [ ] 5.3 `.agents/openspec-sdlc.md` 與本 spec 的 requirement 對得上（無 drift）
- [ ] 5.4 跑一個小 change 走完階段 6，確認三層收斂與唯讀牆 escalation 實際 work
