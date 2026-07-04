## Why

Tribunal 目前是「一篇文章 = 單一 provider」：`scripts/tribunal-helpers.sh` 的 `tribunal_llm_provider()` 是全域解析（codex 在 PATH 就 codex，否則 claude），**完全不吃 `agent_name`**。因此在 mac/VPS 上四個 judge 全跑 Codex/GPT-5.5，包含 VibeScorer。

但 VibeScorer 是唯一的**主觀品味**判斷（Persona / ClawdNote / Vibe / Narrative），owner 要它跟 writer 保持同一個品味來源。這件事 repo 內部其實**已經 drift 成互相矛盾的兩個 SSOT**：

- `.claude/agents/vibe-opus-scorer.md`：pin `claude-opus-4-5`，附 owner sign-off（2026-06-18：writer + rewriter + vibe 都 Opus 4.5，保持一致品味）。
- `.codex/agents/vibe-opus-scorer.toml` + `scripts/vibe-scoring-standard.md` 配置表：`gpt-5.5`。

現況 mac 跑的是後者（GPT-5.5），跟 owner 對 vibe 品味的意圖不符。本 change 讓 VibeScorer 走 Claude Opus 4.5、其餘三個客觀 judge（Librarian / FactChecker / FreshEyes）維持 Codex/GPT-5.5，並收斂這個 drift。

## What Changes

- **新增 agent-aware provider resolver `tribunal_judge_provider(agent_name)`**：預設完全委派現有 `tribunal_llm_provider()`，只對 `vibe-opus-scorer` 硬編選 `claude`。這是最小、additive 的改動——**沒有走 judge path 的 caller 行為 byte-for-byte 不變**。
- **把 `agent_name` thread 進** `tribunal_llm_model_id` / `tribunal_runner_label` / `tribunal_llm_exec_raw` / watchdog 的 quota+fallback 判斷，讓它們改用新 resolver。VibeScorer 因此在 mac/VPS 解析成 Claude，`tribunal_claude_agent_model` 讀 `.claude/agents/vibe-opus-scorer.md` 的 `model: claude-opus-4-5`。
- **CCC fallback 不變**：CCC 沙箱沒有 codex → 三個 Codex judge 自然沿用既有 Claude fallback（讀各自 `.claude/agents/*.md`），整個 tribunal 仍全 Claude。**不新增任何 codex→claude fallback model mapping**。
- **誠實性修正**：`TRIBUNAL_PROVIDER` 全域 preflight/label 改成「可用 provider summary」，每 stage 實際 provider 以 `actual_provider_file` 為準；watchdog 的 quota/Claude-fallback 判斷改用 per-judge resolver，避免把 VibeScorer 的 Claude 失敗誤判成 Codex quota 用盡。
- **文件收斂**：`scripts/vibe-scoring-standard.md` 配置表把 VibeScorer runtime 從 `gpt-5.5` 改為 `claude-opus-4-5`；`tools/sp-pipeline/internal/pipeline/ralph.go` 的「tribunal 自動選單一 provider」註解更新；quota controller 相關 log/docs 誠實標明「controller gates Codex only」。

## Capabilities

### Modified Capabilities
- `codex-tribunal-runtime`: 把「所有 judge stages SHALL 用 Codex GPT-5.5」放寬為 per-judge provider——三個客觀 judge 維持 Codex/GPT-5.5，VibeScorer 在 codex 可用時 SHALL 用 Claude Opus 4.5；`.claude/agents/vibe-opus-scorer.md` 的 `model:` 成為 VibeScorer runtime 的權威來源（其餘 judge 的 `.claude/*.md` 仍只在 CCC fallback 生效）。

## Impact

- **`scripts/tribunal-helpers.sh`** — 新增 `tribunal_judge_provider`；`tribunal_llm_model_id` / `tribunal_runner_label` / `tribunal_llm_exec_raw` / watchdog quota 判斷改吃 `agent_name`。
- **`scripts/tribunal.sh`** — `run_stage` 把 `agent_name` 傳進新 resolver；`TRIBUNAL_PROVIDER` 全域 label 改成 availability summary。
- **`.codex/agents/vibe-opus-scorer.toml`** — 不動（維持 `gpt-5.5`，僅在 emergency `TRIBUNAL_FORCE_PROVIDER=codex` 全域覆寫時才會被用到）。
- **`scripts/vibe-scoring-standard.md`** — 配置表 vibe runtime 改 `claude-opus-4-5`，收斂 SSOT drift。
- **`scripts/tests/test-tribunal-safety-contract.sh`** — 更新斷言：三個客觀 judge → `codex-gpt-5.5-medium`、VibeScorer → `claude-opus-4-5`；`.codex/agents/*.toml` 全 `gpt-5.5` 的既有斷言維持（我們沒改 toml）。
- **`tools/sp-pipeline/internal/pipeline/ralph.go`** — 更新過期註解。
- **不影響**：`scripts/tribunal.sh` 仍是 canonical entrypoint；score-file transfer / validation 契約不變；`TRIBUNAL_FORCE_PROVIDER` 全域 override 仍可用（emergency / A-B test）。
