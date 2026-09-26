# Proposal

## Why

ShroomDog 在 2026-09-26 拍板：「目前前沿模型裡，只有 Claude 寫得出 gu-log 等級的繁體中文。」但 VM runtime profile 仍讓 Grok 翻 GP 正文、寫 MoguNote 候選與英文 sidecar，讓 Codex 改 GP 字句；本機寫作 chain 在沒有 `claude` 時也會退回 Codex，Tribunal 背景改寫則由 `GP_WRITER_MODE=grok|codex` 決定。這些路徑和 owner 的品質判斷直接衝突，而且散在 config、Go dispatcher、shell executor 與 spec，沒有單一規範能擋住回流。

## What Changes

- **BREAKING**：所有會產生或改寫讀者可見文章字句的自動化角色一律改用 Claude，model 只來自既有 Claude 寫手 pin 的 SSOT：
  - GP 正文翻譯（translator）、GP bounded corrector、MoguNote commentary 候選。
  - 英文 sidecar 翻譯、MP write／refine（含 `write`／`refine`／`translate` 子命令）。
  - Tribunal 評審不過的背景改寫與 final-build 修復（`GP_WRITER_MODE=claude`，含 systemd unit、wrapper 與 gp-pipeline wrapper 預設）。
- **BREAKING**：退役寫作用的 Codex／Grok 路徑：`GP_WRITER_PROVIDER=codex`、`GP_WRITER_MODE=codex|grok` 會在呼叫任何 model 前明確失敗；本機寫作 chain 不再在缺少 `claude` 時退回 Codex；`.codex/agents/tribunal-writer.toml` 不再綁定 Codex model。
- VM runtime profile 的 `requiredProviders` 改為實際使用的 `codex` 與 `claude`；Grok 不再擔任任何角色，移出 preflight，並移除只為 Grok 寫手存在的額度政策。Claude preflight 驗證 CLI 登入與寫手 pin。
- Claude 寫作呼叫改為最小權限：只回 JSON 的角色不給任何工具並用 structured output；需要寫檔的角色只有檔案工具，編修只限該步驟的私有工作目錄；部署版 Tribunal 寫手沿用暫態 systemd service 與寫入 canary。
- GP 角色獨立性從「翻譯、修正、語感評審三個不同 model」改成「寫作角色與 gate 角色不共用 model」，因為所有寫作角色依規定共用同一個 Claude pin。
- 只打分或審查、不寫文章字句的角色（Tribunal 四位評審、eval、review、GP source reviewer、natural-zh vibe gate）維持原狀。

## Capabilities

### New Capabilities

- `claude-prose-writing-runtime`：規範「文章內容的撰寫與改寫角色一律使用 Claude」，涵蓋角色範圍、model 來源、退役供應端的封閉失敗，以及 Claude 寫作呼叫的最小權限與乾淨輸出。

### Modified Capabilities

- `codex-exec-writing-runtime`：整個 capability 退役（寫手不再是 Codex），由 `claude-prose-writing-runtime` 取代。
- `gp-source-preservation`：`GP text roles MUST use independent models and contracts` 改成寫作角色走 Claude pin、gate 角色不得與寫作角色共用 model。
- `tribunal-24-7-operations`：部署版改寫改由 Claude 寫手與 Claude 寫入 canary 負責；Claude 寫手額度錯誤以 unknown 暫停，控制器仍只讀 Codex 額度。
- `codex-tribunal-runtime`：評審仍全用 Codex，寫手改用受限 Claude 執行器；VM runtime profile 的評審 model 來源寫回 spec。

## Impact

- 設定：`config/llm-pipeline.json` 的 vm-codex profile（寫作角色、`requiredProviders`、Grok 額度區塊）。
- Go：`tools/gp-pipeline/internal/llm`（Claude provider、runtime routing、GP profile 驗證、寫作 chain）、GP run 的 sidecar dispatcher、corrector structured output、doctor。
- Shell：`scripts/tribunal-model-router.sh`、`scripts/tribunal-helpers.sh`、`scripts/tribunal.sh`、batch runner、systemd unit、wrapper、gp-pipeline wrapper。
- 測試：Go routing／profile／provider 測試與 Tribunal shell 合約測試。
- 文件：runbook、gp-pipeline README／SKILL、playbooks、ShroomDog 回饋紀錄。
- VM：需要安裝並登入 Claude Code CLI、重新安裝 systemd unit；Claude 額度成為背景改寫的新耗用來源。
