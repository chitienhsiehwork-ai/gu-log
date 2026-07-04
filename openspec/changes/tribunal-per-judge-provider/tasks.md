## 1. Agent-aware provider resolver（D1 + D2）

- [ ] 1.1 在 `scripts/tribunal-helpers.sh` 新增 `tribunal_judge_provider(agent_name)`：`vibe-opus-scorer` → `claude`，其餘委派 `tribunal_llm_provider()`
- [ ] 1.2 `TRIBUNAL_FORCE_PROVIDER` 設定時，`tribunal_judge_provider` SHALL 全域覆寫所有 judge（含 vibe），優先序最高
- [ ] 1.3 vibe 偏好 claude 但 claude 不可用時，落既有 availability fallback（不硬失敗）

## 2. Thread agent_name 進解析鏈（D1）

- [ ] 2.1 `tribunal_llm_model_id`（helpers:474）改吃 `agent_name`、內部呼叫 `tribunal_judge_provider "$agent_name"`
- [ ] 2.2 `tribunal_runner_label`（helpers:501）同上——vibe 回 `claude-opus-4-5`、其餘回 `codex-gpt-5.5-medium`
- [ ] 2.3 `tribunal_llm_exec_raw`（helpers:605）改用 `tribunal_judge_provider "$agent_name"` 選 claude/codex exec
- [ ] 2.4 確認 `tribunal_claude_exec` 對 vibe 讀到 `.claude/agents/vibe-opus-scorer.md` 的 `model: claude-opus-4-5`

## 3. Watchdog quota / fallback 誠實性（D3）

- [ ] 3.1 `tribunal-helpers.sh:1040/1044` watchdog 的 provider 判斷改吃 `tribunal_judge_provider "$agent_name"`
- [ ] 3.2 驗證：VibeScorer 的 Claude 執行失敗 NOT 被誤判成 Codex quota 用盡 → 不觸發錯誤 fallback
- [ ] 3.3 `actual_provider_file` 對每個 judge 各自記錄真實 provider/model/runner

## 4. 全域 label → availability summary（D4）

- [ ] 4.1 `scripts/tribunal.sh:1129` `TRIBUNAL_PROVIDER` 改成「可用 provider summary」，只做 preflight（至少一 provider 在 PATH）
- [ ] 4.2 stage log line（tribunal.sh:778）改為顯示該 stage 實際 resolver 結果，不是全域值

## 5. 文件 / 註解 / 測試收斂

- [ ] 5.1 `scripts/vibe-scoring-standard.md` 配置表：VibeScorer runtime `gpt-5.5` → `claude-opus-4-5`，並說明其餘三 judge 維持 codex
- [ ] 5.2 `tools/sp-pipeline/internal/pipeline/ralph.go:106` 更新「tribunal 自動選單一 provider」過期註解
- [ ] 5.3 quota controller 相關 log/docs 誠實標「controller gates Codex only；Claude vibe 不受 controller 管」
- [ ] 5.4 更新 `scripts/tests/test-tribunal-safety-contract.sh`：斷言 vibe → `claude-opus-4-5`、其餘三 → `codex-gpt-5.5-medium`；`.codex/agents/*.toml` 全 `gpt-5.5` 既有斷言保留

## 6. 驗證

- [ ] 6.1 靜態測試：`tribunal_judge_provider vibe-opus-scorer` = claude、`tribunal_judge_provider fact-checker` = codex（codex 在 PATH 時）
- [ ] 6.2 向後相容：無 `agent_name` 的 `tribunal_llm_provider` 呼叫路徑輸出 byte-for-byte 不變（daemon / publisher / vibe-scorer.sh 回歸）
- [ ] 6.3 `TRIBUNAL_FORCE_PROVIDER=codex` 全域覆寫仍讓 vibe 回 codex；`=claude` 讓全部回 claude
- [ ] 6.4 端到端：mac 上跑一篇 tribunal，確認 frontmatter `scores.vibe.model=claude-opus-4-5`、其餘三 = `codex-gpt-5.5-medium`
- [ ] 6.5 `openspec validate tribunal-per-judge-provider --strict` 通過（CLI 可用時）；CI tribunal 測試綠
