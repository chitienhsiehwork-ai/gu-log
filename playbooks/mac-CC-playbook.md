# mac-CC Playbook

> **mac-CC** = **Mac-local Claude Code** — 跑在 user 個人 Mac 上的 Claude Code（terminal / VS Code / Cursor / 各式 harness）。
>
> 這份 playbook 只給 mac-CC 看。CCC（Cloud Claude Code）讀 `CCC-playbook.md`。用 `./scripts/detect-env.sh` 確認自己是誰。

## 精神

跟 CCC 一樣：**move fast, be independent, make good decisions, don't be a 伸手牌**。User 常開 yolo mode 離開現場，mac-CC 該自己做 research / 自己判斷 / 自己動手。**不要一有模糊就問 user**——先讀 docs、讀 code、跑 script、試驗、查 git log。問 user 是最後一步，不是第一步。

## 差別只在環境，規則跟 CCC 共用

**工作規則**（commit discipline、scope ceiling、失敗處理、品質 gate）**全部共用 CCC-playbook.md 的內容**。那些是 Claude Code 在這個 repo 的通則，不是 CCC 專屬。讀 CCC-playbook 的這幾段當 mac-CC 自己的規則：

- Commit discipline（atomic commits）
- Scope ceiling（相關路徑 + prod/CI 緊急事件例外）
- 品質 gate（不能跳任何 hook 或 tribunal）
- 失敗處理（forward fix → opus subagent → revert）

## 環境差異（mac-CC 該知道、CCC 不會遇到）

### Branch 位置不固定

mac-CC 可能在任何 branch 上，不一定在 `claude/xxx`：
- 可能在 `main`（solo author 直接開發）
- 可能在 worktree（user 常用 `git worktree`，一次開多個 feature）
- 可能在 feature branch

**開場先觀察**：
```bash
./scripts/detect-env.sh
git worktree list
git branch --show-current
git status
git log --oneline -5
```

不要假設在 main。不要擅自切 branch。尊重 user 當下的 working state——如果 user 已經在某個 branch 上 iterate，就在那個 branch 上做。

### Merge flow 更直接

mac-CC 不一定要走 PR + self-merge 流程：
- 在 main 上 → commit + push 就直接 Vercel deploy 上 prod（solo author policy 授權的）
- 在 feature branch 上 → push 到同名 remote branch，要不要開 PR 看情況
- 在 worktree 上 → 照該 worktree 的 scope 做事

GitHub MCP 不一定可用（看 user 的 Claude Code 設定）。可能有 `gh` CLI、可能沒有。觀察現況，不要硬叫 MCP tool。

### 本地環境優勢，該用

mac-CC 有的 CCC 沒有的：
- **本地 dev server**：自己跑 `pnpm run dev` iterate，不要煩 user（user 只看 production）
- **playwright-cli skill**（`.claude/skills/playwright-cli/`）：截圖驗證 UI
- **uiux-auditor skill**（`.claude/skills/uiux-auditor/`）：改完視覺跑一次，強制雙主題截圖 + WCAG 對比
- **iCloud Drive 直接存取**：可以直接讀 Obsidian vault 裡的草稿（`~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/`），跑 `pnpm run obsidian:import`
- **沒有沙箱網路限制**：可以下載、可以 curl、可以 fetch 外部 API
- **Tribunal VM 存取**：tribunal daemon 跑在 `ssh clawd-vm`（`~/clawd/projects/gu-log`）。查狀態用 `/tribunal-monitor` skill（一鍵全面診斷），完整 ops 見 [`docs/tribunal-runbook.md`](../docs/tribunal-runbook.md)

這些都該主動用，不要因為 CCC 不能用就不用。

## 這份 playbook 是 living doc

mac-CC 如果遇到 Mac 專屬的狀況需要 codify（例如發現某個本地工具的坑、某個 skill 的新用法、某個 iCloud sync 的陷阱），直接編輯這份 playbook 加進去。

保持精簡——這份不是 CCC-playbook 的 duplicate，只寫 Mac-specific 的部分。
