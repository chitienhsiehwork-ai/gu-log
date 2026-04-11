# Claude Code Agent Teams — Research Notes

> Research date: 2026-04-09
> Researcher: Web Research Agent (claude-sonnet-4-6)
> Status: Experimental feature — CC v2.1.32+

---

## TL;DR

Agent Teams 是 CC 的 **experimental** 功能，預設關閉。核心概念：一個 Lead session 管理多個獨立的 Teammate sessions，透過 shared task list + mailbox 協調。與 subagents 最大差異是 teammates **可以互相通訊**，subagents 只能回報給 parent。

---

## Subagents vs Agent Teams — 一張表搞懂

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Feature           Subagents                Agent Teams (Teammates)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Communication     只能回報給 parent         Teammates 可以互傳訊息
Context           獨立 context window      獨立 context window
Coordination      Parent 管一切            Shared task list 自協調
Tool              Agent (previously Task)  Agent with team_name
Token cost        Lower                    Higher (each = full session)
Best for          Focused single tasks     Parallel exploration/debate
Nesting           不可 spawn 子 subagents  不可 spawn 子 teams
Version req       任何版本                  v2.1.32+
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> 注意：CC v2.1.63 起，Task tool 已改名為 **Agent tool**。舊的 `Task(...)` 語法仍有效作為 alias。

---

## 啟用方法

在 `~/.claude/settings.json` 加入：

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

或設定 shell 環境變數 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。

---

## 正確 Spawn 流程（Step by Step）

### 方法 A：自然語言（推薦，最簡單）

直接跟 Lead 說要做什麼、要幾個人、各自負責什麼：

```
Create an agent team with 3 teammates to refactor the auth module in parallel:
- One teammate on JWT token handling (src/auth/jwt.py)
- One teammate on session management (src/auth/session.py)
- One teammate on input validation (src/auth/validators.py)
Use Sonnet for each teammate.
```

CC 會自動呼叫 TeamCreate → Agent(team_name=...) 幫你生成。

### 方法 B：Tool 層級手動控制（當你在寫 skill/agent 定義時）

```
Step 1 — Create the team:
  TeamCreate({ team_name: "my-team", description: "描述這個 team 的目標" })

Step 2 — Create tasks in the shared task list:
  TaskCreate({ subject: "Task A", description: "詳細說明", team_name: "my-team" })
  TaskCreate({ subject: "Task B", description: "詳細說明", team_name: "my-team" })

Step 3 — Spawn each teammate:
  Agent({
    name: "worker-a",
    team_name: "my-team",
    subagent_type: "general-purpose",
    prompt: "You are responsible for Task A. ...",
    run_in_background: true
  })

Step 4 — Teammates self-claim tasks from the shared list via TaskList() + TaskUpdate()

Step 5 — Shutdown sequence:
  Lead sends shutdown_request → Teammate approves → Lead calls TeamDelete (cleanup)
```

---

## 關鍵參數說明

### Agent tool (spawning a teammate)

| Parameter | Type | Required | 說明 |
|-----------|------|----------|------|
| `name` | string | 建議填 | Teammate 的識別名稱，之後用這個名字互傳訊息 |
| `team_name` | string | 要加入 team 必填 | 指定這個 agent 屬於哪個 team，沒有這個就是普通 subagent |
| `subagent_type` | string | 否 | 可引用 `.claude/agents/` 或 `~/.claude/agents/` 裡的定義 |
| `prompt` | string | 是 | Teammate 的 spawn prompt，不會繼承 Lead 的對話歷史 |
| `run_in_background` | bool | 建議 true | **非同步執行**，不阻塞 Lead。設 false 會讓 Lead 等它完成 |
| `model` | string | 否 | "haiku" / "sonnet" / "opus" / full model ID |
| `mode` | string | 否 | "plan" 表示需要 Lead approve 才能執行 |

### TeamCreate

| Parameter | 說明 |
|-----------|------|
| `team_name` | Team 識別碼，生成 `~/.claude/teams/{team-name}/config.json` |
| `description` | Team 目標描述 |

### TeammateTool messaging operations

| Operation | 說明 |
|-----------|------|
| `write` | 發訊息給特定 teammate（by name） |
| `broadcast` | 廣播給所有 teammates — 慎用，費用乘以人數 |
| `requestShutdown` / `approveShutdown` | Graceful 關閉流程 |
| `approvePlan` / `rejectPlan` | Plan mode 審核 |

---

## Display Mode 設定

CC 支援兩種顯示模式：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Mode            設定方式                      適用情境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
in-process      預設，或 --teammate-mode       任何 terminal 都能用
                in-process                   Shift+Down 切換 teammate
tmux split      ~/.claude.json 設定            需要 tmux 或 iTerm2+it2
                "teammateMode": "tmux"        每個 teammate 獨立 pane
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Auto-detection 順序：
1. 在 tmux session 內 → 使用 tmux backend
2. 在 iTerm2 且裝了 it2 CLI → 使用 iterm2 backend
3. tmux 可用但不在其中 → tmux external session
4. 都不符合 → in-process

強制設定：
```json
// ~/.claude.json
{ "teammateMode": "in-process" }
```

或 CLI flag：
```bash
claude --teammate-mode in-process
```

> **重要**：Ghostty 不支援 split-pane mode！你的環境強制使用 in-process 或先開 tmux。

---

## 已知 Bugs 與 Pitfalls (截至 2026-04)

### Bug 1 — Agent tool + team_name = Internal Error (Issue #40270)

**症狀**：`Agent({ team_name: "...", ... })` 回傳 `[Tool result missing due to internal error]`

**根因**：Race condition，`TeammateModeSnapshot` 在 `getTeammateModeFromSnapshot()` 呼叫前尚未 capture。也有 tmux 偵測在 TMUX env var 存在的情況下仍回傳 false 的問題。

**版本**：v2.1.86 確認有此問題，已 closed as duplicate of #23528。

**Workaround**：不帶 `team_name` 直接用 Agent tool 作為普通 subagent，或等 patch 版本。

---

### Bug 2 — TeamCreate spawns teammates that silently exit (Issue #34614)

**症狀**：tmux pane 開了但 process 立刻結束，沒有錯誤輸出。

**根因 A**：`PaneBackendExecutor.spawn()` 生成的指令缺少 `cd` 前綴（spawn command 格式錯誤）。

**根因 B**：`--teammate-mode=tmux` 在 non-interactive session 中被短路忽略，因為 isInProcessEnabled() 先 check non-interactive 再 check mode。

**Workaround**：
```yaml
# 用 Agent tool + run_in_background 繞過 TeamCreate 的 spawn 邏輯
Agent:
  prompt: "Do X in /path/to/project"
  run_in_background: true
```
這條路可靠但所有通訊都要透過 Lead 轉送。

---

### Bug 3 — tmux split panes open but teammates disconnected (Issue #24771)

**症狀**：pane 開了、CC session 啟動了，但 teammates 停在 `>` prompt 沒動作，Lead 的 SendMessage 送不到。

**根因**：Teammate process routing 到那些 pane 的邏輯壞掉，panes 是 orphaned instances，沒連上 team coordination layer。

**Trigger 條件**：`tmux -CC` in iTerm2 + `--teammate-mode tmux`，CC v2.1.32。

**Workaround**：改用 `in-process` mode。

---

### Bug 4 — tmux pane layout corruption when spawning 4+ teammates (Issue #23615)

**症狀**：
- 現有 tmux pane layout 被強制 split 破壞
- `send-keys` 在多個 agent 同時 spawn 時發生 race condition，指令被亂碼（`cd` 變成 `mmcd`）
- 2+ agents 直接 crash

**根因**：CC 用 `tmux split-window -h` 直接切割現有 pane，而不是開新 window；多個 split 並發時 send-keys 有 sync 問題。

**Workaround**：
- Spawn 人數限制在 2 以下（不推薦）
- 先開一個乾淨的 tmux window 再啟動 CC
- 或用 `in-process` mode（最保險）

---

### Pitfall — Orphaned tmux sessions

Agent team 異常結束（terminal crash、network disconnect、force quit Lead）後，tmux session 可能殘留。

**清除方法**：
```bash
tmux ls
tmux kill-session -t <session-name>
```

Subagent 被 `tmux kill-session` 砍掉後可能變成 orphan process（PPID=1），繼續佔用 ~200MB 記憶體。原因：tmux kill-session 只對 foreground process 送 SIGHUP，fork/reparent 的 subagent 可以逃過。

---

### Pitfall — Lead implements instead of delegating

Lead 有時會自己開始做事而不等 teammates 完成。處理方式：

```
Wait for your teammates to complete their tasks before proceeding.
```

---

### Pitfall — Task status lag

Teammates 有時忘記把 task 標成 completed，導致 dependent tasks 被卡住。需要手動確認或叫 Lead 去 nudge。

---

### Pitfall — No session resumption for in-process teammates

`/resume` 和 `/rewind` 無法恢復 in-process teammates。Resume 後 Lead 可能嘗試傳訊息給不存在的 teammates。

**處理**：告訴 Lead spawn 新的 teammates。

---

## Best Practices (實戰建議)

### Team size
- 3-5 teammates 是 sweet spot
- 每個 teammate 分配 5-6 個 tasks 讓他們保持忙碌
- 超過這個數字協調 overhead 大於效益

### Token cost 控制
- Lead 用 Opus，teammates 用 Sonnet
- Research/review tasks 用 Haiku teammates
- 不要 broadcast（費用 × 人數），改用 targeted message

### Spawn prompt 寫法
Teammates 不繼承 Lead 的對話歷史，所以 spawn prompt 要自帶上下文：
```
"Review the authentication module at src/auth/ for security vulnerabilities.
Focus on token handling, session management, and input validation.
The app uses JWT tokens stored in httpOnly cookies.
Report any issues with severity ratings."
```

### 避免 file conflict
兩個 teammates 改同一個檔案 = race condition overwrite。在 spawn prompt 裡明確劃分 file ownership。

### 先用 read-only tasks 熱身
新手先從 PR review、library research 等不寫程式的 tasks 開始，搞清楚 coordination pattern 之後再做 parallel implementation。

### Plan mode + approval workflow
高風險任務要求 teammates 先 plan、等 Lead approve：
```
Spawn an architect teammate to refactor the auth module.
Require plan approval before they make any changes.
```

### Cleanup 要透過 Lead
```
Clean up the team
```
永遠用 Lead 做 cleanup，不要讓 teammate 自己 cleanup（team context 可能 resolve 不正確）。

---

## Simon Willison 的觀點

Simon 的幾篇文章主要聚焦在 **subagents 和 parallel coding agents**，對 agent teams 這個 experimental feature 著墨不多。幾個他反覆強調的重點：

1. **Parallel 不代表零認知負擔**：同時跑 4 個 agent 在心理上很累，11 AM 就精力耗盡。
2. **用 dedicated repo 隔離 agent 工作**：讓 agent 有完整 filesystem + network access，不用擔心踩到正式 code。
3. **Fire-and-forget 是最佳心態**：給清楚的 goal，讓 agent 去跑，human 的工作是 review PR，不是盯著螢幕。
4. **Review burden 是真實的**：收到一堆 out-of-nowhere 的 code 要 review 很累。事先給 spec 可以大幅降低 review 成本。

---

## Team Config 的儲存位置

```
~/.claude/teams/{team-name}/
├── config.json          # runtime state: session IDs, tmux pane IDs, members list
└── inboxes/{agent}.json # mailbox messages

~/.claude/tasks/{team-name}/  # numbered task files
```

**不要手動編輯 config.json**，每次 state 更新都會被覆寫。

Teammate 的環境變數：
```
CLAUDE_CODE_TEAM_NAME
CLAUDE_CODE_AGENT_ID
CLAUDE_CODE_AGENT_NAME
CLAUDE_CODE_AGENT_TYPE
CLAUDE_CODE_AGENT_COLOR
CLAUDE_CODE_PLAN_MODE_REQUIRED
CLAUDE_CODE_PARENT_SESSION_ID
```

---

## Subagent Definitions 作為 Teammate Templates

在 `.claude/agents/` 或 `~/.claude/agents/` 定義 subagent，可以在 spawn teammate 時引用：

```
Spawn a teammate using the security-reviewer agent type to audit the auth module.
```

Teammate 會繼承該 definition 的 `tools` allowlist 和 `model`，definition body 附加到 teammate system prompt。  
注意：`skills` 和 `mcpServers` frontmatter 在 teammate 模式下**不會被套用**，這兩者從 project/user settings 載入。

---

## 我的環境注意事項

- **Ghostty** 不支援 split-pane mode，必須用 `in-process` 或先在 Ghostty 裡開 tmux
- **開 tmux 之後**：`claude --teammate-mode tmux` 或在 `~/.claude.json` 設 `"teammateMode": "tmux"` 才能看到 split panes
- **目前 v2.1.86 的 Agent + team_name bug**：如果直接用 tool 層 spawn 失敗，改用自然語言請 Lead 幫你 spawn

---

## Sources

- [Official Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
- [Official Sub-agents Documentation](https://code.claude.com/docs/en/sub-agents)
- [GitHub Issue #34614 — TeamCreate spawns teammates that silently exit](https://github.com/anthropics/claude-code/issues/34614)
- [GitHub Issue #40270 — Agent tool with team_name fails with internal error](https://github.com/anthropics/claude-code/issues/40270)
- [GitHub Issue #23615 — Agent teams should spawn in new tmux window](https://github.com/anthropics/claude-code/issues/23615)
- [GitHub Issue #24771 — tmux split panes open but teammates disconnected](https://github.com/anthropics/claude-code/issues/24771)
- [Claude Code Swarm Orchestration Skill (kieranklaassen gist)](https://gist.github.com/kieranklaassen/4f2aba89594a4aea4ad64d753984b2ea)
- [Simon Willison — Parallel Coding Agents](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)
- [Simon Willison — Claude Code Sub-agents](https://simonwillison.net/2025/Oct/11/sub-agents/)
- [Simon Willison — Async Code Research with Agents](https://simonwillison.net/2025/Nov/6/async-code-research/)
- [Simon Willison — Lenny's Podcast Highlights](https://simonwillison.net/2026/Apr/2/lennys-podcast/)
- [Addy Osmani — Claude Code Agent Teams](https://addyosmani.com/blog/claude-code-agent-teams/)
- [30 Tips for Claude Code Agent Teams (getpushtoprod)](https://getpushtoprod.substack.com/p/30-tips-for-claude-code-agent-teams)
- [From Tasks to Swarms: Agent Teams in Claude Code (alexop.dev)](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)
- [Claude Code Multi-Agent tmux Setup (Medialesson, Medium)](https://medium.com/medialesson/claude-code-multi-agent-tmux-setup-7361b71ff5c4)
- [Eric Buess on X — tmux cleanup behavior](https://x.com/EricBuess/status/2028217923760959976)
