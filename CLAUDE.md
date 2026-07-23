@AGENTS.md

## Claude Code 專屬

> 上面 `@AGENTS.md` 是所有 agent 共讀的 Tier-0 中性憲法 + 路由。這段只放「換成別的 agent 就不成立」的 Claude Code 限定操作細節。其餘規則一律以 `AGENTS.md` 和它指向的 playbook / Tier-2 文件為準。

- **開 PR / 追 CI 用 GitHub MCP**：`mcp__github__create_pull_request` 開 PR，`mcp__github__pull_request_read`（`get_status` / `get_comments` / `get_check_runs`）追 CI 跟撈 Vercel preview URL，`mcp__github__merge_pull_request` 合併，`mcp__github__subscribe_pr_activity` 訂閱自己的 PR。CCC 的 self-merge / 收尾 / preview-URL SOP 全在 [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md)。
- **Tribunal judges 預設一律走 tribunal script**：script 才是 model routing、provenance 與完整四評審流程的正常入口。只有 script／provider 路徑真的壞掉時，才照 [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) 的 fallback 做；不要自行用 `Agent` tool 猜 model。exact-version pinned 的 voice role 仍必須用 agent frontmatter 的完整 ID。跑法 / fallback / model 路由 / stream idle timeout 全以該 playbook 為 SSOT，CLAUDE.md 不複述方法。
- **本地 skill（路徑是 `.claude/skills/`）**：
  - `playwright-cli`（`.claude/skills/playwright-cli/`）：截圖驗證 UI
  - `uiux-auditor`（`.claude/skills/uiux-auditor/`）：改完任何視覺的東西（CSS / component / color / spacing / typography / layout）就跑一次，強制雙主題截圖 + WCAG 對比 + flag 寫死的 hex。不要等 user 來挑錯
  - `skill-creator`（`.claude/skills/skill-creator/`）：建立 / 修改 skill（官方 anthropic/skills 的來源）
- **不確定時找誰**（Claude subagent 路徑）：技術決策不確定用 `AskUserQuestion`（先把問題想清楚、給選項）；內容風格不確定讀 `GU-LOG_WRITER_PROMPT.md`，正式打分依上條；架構不確定 spawn `Plan` subagent 規劃再動手。
- **動手建機制前先審「該不該做」**：要新增 openspec capability / 機制 / 非小型 refactor，或正要照自己（或 user）的直覺蓋東西前，先用 `Agent` tool spawn 2–4 個 zero-context、預設懷疑的 reviewer subagent（價值 / 替代 / 失敗模式各一視角），能講「別做」才算數。收斂說不做就別硬推；不做但分析有價值就記成 openspec 決策記錄。全文（含 runtime 差異、範式）見 [`docs/value-review-runbook.md`](docs/value-review-runbook.md)。**最好的 code 常常是不寫 code、做一個好決定。**
