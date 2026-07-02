@AGENTS.md

## Claude Code 專屬

> 上面 `@AGENTS.md` 是所有 agent 共讀的 Tier-0 中性憲法 + 路由。這段只放「換成別的 agent 就不成立」的 Claude Code 限定操作細節。其餘規則一律以 `AGENTS.md` 和它指向的 playbook / Tier-2 文件為準。

- **開 PR / 追 CI 用 GitHub MCP**：`mcp__github__create_pull_request` 開 PR，`mcp__github__pull_request_read`（`get_status` / `get_comments` / `get_check_runs`）追 CI 跟撈 Vercel preview URL，`mcp__github__merge_pull_request` 合併，`mcp__github__subscribe_pr_activity` 訂閱自己的 PR。CCC 的 self-merge / 收尾 / preview-URL SOP 全在 [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md)。
- **Tribunal judges 一律走 tribunal script，絕不用 `Agent` tool spawn**：只有 script 能 pin 到指定 Opus 版本（`claude -p --model <完整-id>`）；`Agent` tool 只吃 alias（`opus`/`sonnet`…）pin 不到版本，拿來跑 tribunal 會悄悄用錯 model 評分。跑法 / 版本 pin / model 路由 / stream idle timeout 全是 [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) 的 SSOT——CLAUDE.md 只留這條硬規則 + 指標，**不複述方法（複述 = drift）**。
- **本地 skill（路徑是 `.claude/skills/`）**：
  - `playwright-cli`（`.claude/skills/playwright-cli/`）：截圖驗證 UI
  - `uiux-auditor`（`.claude/skills/uiux-auditor/`）：改完任何視覺的東西（CSS / component / color / spacing / typography / layout）就跑一次，強制雙主題截圖 + WCAG 對比 + flag 寫死的 hex。不要等 user 來挑錯
  - `skill-creator`（`.claude/skills/skill-creator/`）：建立 / 修改 skill（官方 anthropic/skills 的來源）
- **不確定時找誰**（Claude subagent 路徑）：技術決策不確定用 `AskUserQuestion`（先把問題想清楚、給選項）；內容風格不確定讀 `GU-LOG_WRITER_PROMPT.md`，**要正式打分一律走 tribunal script**（見上條，不要 spawn scorer subagent——model pin 不到）；架構不確定 spawn `Plan` subagent 規劃再動手。
