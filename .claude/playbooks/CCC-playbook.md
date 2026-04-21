# CCC Playbook

> **CCC** = **Cloud Claude Code** — Claude Code 網頁版，在 Anthropic 的 GCP sandbox 跑，每次被叫醒都在 harness 自動建的 `claude/xxx` branch 上。
>
> 這份 playbook **只給 CCC 看**。如果你是 mac-CC（在 user 個人 Mac 上跑），讀 `mac-CC-playbook.md`。用 `./scripts/detect-env.sh` 確認自己是誰。

## 精神

**Move fast, merge fast, fix fast.** Branch 是拋棄式的，sandbox 是拋棄式的。不要珍惜。快速做事、快速合、壞了快速修。

## 授權範圍（user 已 pre-approved）

- 直接 push 到 `claude/xxx` branch
- 自己開 PR 到 `main`
- CI 全綠後**自己 merge**（不用等 user 按按鈕）
- 順手修發現的小問題（有 scope 限制，見下）

## Commit discipline

- **PR scope 可以大、可以雜**。做任務時順手修相關的東西，不用 split PR。
- **Commit 內部維持 atomic**（一個 commit 做一件事）——revert 時才好下刀。這是放手做事的保險。
- 不要把「改 import script + 升 astro + 改 CSS + 加新頁」塞同一個 commit——revert 一個會連累其他四個。

## Scope ceiling（順手修的上限）

**一般情況**：只修「當前任務路徑相關」的問題。別的等下次任務，不要 yak-shaving。

**例外（永遠順手修，不管 scope）**：
- Production 炸了（Vercel 上線掛了，user 會看到）
- main CI broken（有 regression 溜過 pre-push）
- 這類緊急事件沒有 scope 之分，看到立刻修。

## Self-merge policy

1. `git push -u origin claude/xxx`
2. 用 GitHub MCP (`mcp__github__create_pull_request`) 開 PR 到 main
3. **等 CI 全綠**後自己 `mcp__github__merge_pull_request`
4. 合完跟 user 回報 PR URL + 簡短 summary

### Merge method 選擇

PR 合併用 `merge_method` 參數指定，三個選項：

| 情況 | 選擇 | 原因 |
|---|---|---|
| Branch 上 commits 乾淨 atomic，每個都有獨立意義 | **`merge`** 或 **`rebase`** | 保留個別 commits，未來可 `git revert <sha>` 單一 commit |
| Branch 上有 `wip` / `fix lint` / `oops typo` 廢 commits | **`squash`** | 保留這些沒有 revert 價值，只會弄髒 main history |
| 預設 | **`merge`** | CCC 的 commits 應該都是乾淨 atomic 的，squash 會害你未來修不回來 |

**判斷規則**：看 PR 的 commit list，每個 commit subject 自己讀都有意義 → `merge`；有廢 commit → `squash`。CCC 理論上不該產廢 commit，所以預設是 `merge`。

### CI 等待 timeout

**15 分鐘規則**：CI 超過 15 分鐘沒進展就停下來 check 一次。

- 重新 `get_check_runs` / `get_status` 確認狀態
- 如果還是卡住：
  - 可能是**幽靈 check job**（舊 workflow 被改過，殘留 in_progress 狀態，但實際不存在）。Cross-check web UI 或最新 check_runs，看其他 checks 是不是都綠了
  - 可能是 GitHub Actions runner 卡住——可以考慮 re-run
  - 可能是真的慢——再等一輪
- 等超過 25 分鐘沒進展 → **escalate 回 user**，report 狀況，讓 user 決定繼續等 / re-run / cancel / merge anyway。不要無限卡 waiting 狀態。

### 幽靈 check job 警示

MCP API 的 `get_check_runs` 可能返回「舊 workflow 被改過後殘留的 in_progress job」，這些 job 實際不會跑完。症狀：
- 某個 job 的 `started_at` 比其他 jobs 早很多
- 同名的新 job 已經存在並成功
- Web UI 看不到那個 job

遇到懷疑是幽靈 job 的情況：
1. 比對 `total_count` 和 `check_runs` 陣列長度
2. 對照 web UI（叫 user 幫你看 screenshot 或 URL）
3. 確認是幽靈 → 可以忽略它，以其他綠色 checks 為準決定能不能 merge

## 失敗處理

Vercel build / Ralph Loop / validate-posts / CI 沒過：

1. **先試 forward fix**（新 commit 修）
2. 一次不過就想想再試第二次
3. 還不過就 spawn opus subagent 救（最多 3 次 subagent attempt）
4. 全部失敗 → `git revert` 並跟 user report 發生什麼事

**不要**：
- 用 `--no-verify` 跳過 hook
- 用 `git reset --hard` 丟掉別人的 commit
- 硬 force push 蓋掉 user 的改動
- 關掉 Ralph Loop 讓爛文章過

## 品質 gate（全部不能跳）

- `pre-commit` hook（eslint / prettier / validate-posts / contrast check / ticketId dedup）
- `pre-push` hook（dependency / budget / dist checks）
- `validate-posts.mjs`（frontmatter + kaomoji + filename）
- Ralph Loop tribunal（Vibe + Fact + Librarian + FreshEyes）

這些是 CCC 能放手做事的**前提**。關掉任何一個 = CCC 失去工作的資格。

### Tribunal 必跑規則（任何新增/改寫文章的 PR）

**PR 動到 `src/content/posts/*.mdx`（新增 SP/CP/SD/Lv，或實質改寫既有文章）→ 四評審必跑，結果必記錄。沒跑完不開 PR，跑完 FAIL 不 merge。**

**首選**：`scripts/ralph-loop.sh` 或 `sp-pipeline ralph` 自動跑完四審 + rewrite + 寫 frontmatter scores。

**沙箱 fallback**（CCC 常見：`sp-pipeline` 在沙箱因為 `--dangerously-skip-permissions` 不能以 root 跑、或 subprocess 限制跑不起來）：**CCC 自己用 `Agent` tool 一次 spawn 四個 subagent 平行跑**，對應 `.claude/agents/`：

- `vibe-opus-scorer.md`（Opus）→ persona / clawdNote / vibe / clarity / narrative
- `fact-checker.md`（Opus）→ accuracy / fidelity / consistency（要 WebFetch 驗 sourceUrl）
- `librarian.md`（Sonnet）→ glossary / crossRef / sourceAlign / attribution
- `fresh-eyes.md`（Haiku）→ readability / firstImpression

每個 agent 寫 JSON 到 `/tmp/tribunal-<ticketId>-<judge>.json`，schema 照各 agent spec。

**Pass bar（四條全部要過才能 merge）**：
- Vibe composite ≥ 8 **AND** 至少一維 ≥ 9 **AND** 無任何維 < 8
- Fact composite ≥ 8
- Librarian composite ≥ 8
- FreshEyes composite ≥ 8

**沒過怎麼辦**：`tribunal-writer` subagent rewrite → 再跑一輪 → 最多 3 輪。3 輪還不過 → `git revert` + 跟 user 說明卡在哪。

**禁語**（這些話出現在 PR body / commit message / 回報 = 偷工）：
- ❌「Tribunal 背景跑中，等拿到結果再補」— 不行。pending 等於沒跑。開 PR 前就要有結果。
- ❌「Tribunal 跳過」「先 merge 再補分數」「這次例外」— 全不行。
- ❌「只跑 vibe 就好」「不跑 FreshEyes」— 四個都要跑，缺一不可。

**必附證據**：PR body 或一個隨 PR 的 commit 要包含四個 judge 的分數 + verdict，並把 `scores.vibe` / `scores.factCheck` / `scores.librarian` / `scores.freshEyes` 寫進文章 frontmatter（用 `scripts/frontmatter-scores.mjs write <file> <judge> <score_json>`，schema 見 `src/content/config.ts`）。pre-commit 的 score gate（`.githooks/pre-commit` 第 60 行起）會擋掉**新增**且 ticketId 非 PENDING 的 zh-tw 文章 commit，所以 swap PENDING → 真號那個 commit 之前，分數要先進 frontmatter。

## Stream idle timeout 應對（CCC-only failure mode）

這個失敗模式**只在 CCC 沙箱觀察到**（2026-04-21 session 首度記錄）。mac-CC 從沒遇過，mac-CC 可以跳過這段。

**Trigger**：user 回報 `Error happened, resume` / `still error` / `retry` / `continue`，或 API 自己報 `Stream idle timeout - partial response received`。

**Workaround A — `/tmp` chunks + `cat`**（2026-04-21 實測最穩，預設走這條）：

**這是目前最可靠的一招。第一次 retry / resume / continue 且前一個失敗動作是 Write/Edit，立刻切這條**——不要再 retry 任何 long Write/Edit，改走這條。

```bash
# 1. Write 每個 section 到 /tmp/<slug>/NN-xxx.mdx，每個檔案只含一個段落或一個 ClawdNote
Write /tmp/sd20/01-frontmatter.mdx   # frontmatter
Write /tmp/sd20/02-intro.mdx         # intro + 第一個 ClawdNote
Write /tmp/sd20/03-tldr.mdx          # TL;DR 結論
# ...繼續切到 section 級別（每檔 20–80 行）

# 2. 全部寫完後 cat 成最終檔
cat /tmp/sd20/01-frontmatter.mdx /tmp/sd20/02-intro.mdx ... \
  > src/content/posts/sd-20-YYYYMMDD-slug.mdx

# 3. 後續小修正直接用 Edit 改最終檔（短 edits 不會 timeout）
```

為什麼比 in-place skeleton+edit 更穩：`/tmp` 檔案是**獨立 Write 生成**，每個 Write 都是一次短 call，不需要 Read 大檔的 overhead；`cat` 是 Bash，不走 stream。整篇 ~300 行的 MDX 可以切成 10–11 個 chunk，每個 chunk 本身很短所以不會 idle。

**Workaround B — in-place skeleton + edit**（fallback）：
如果 `/tmp` chunks 不合適（例如只是改一個段落），退回舊招：
1. 先 `Write` 一個骨架（frontmatter + imports + 空 section headers）
2. 再用多個 `Edit` 分段填 prose

短 call → stream 不會 idle → timeout window 關不起來。代價是 tool call 變多、吃 context 多一點，但能穩定產出。

**什麼時候切 split mode**（不要等 user 講第三次）：
- **Trigger 精確化**：user 回報 `error` / `retry` / `resume` / `proceed` / `continue` / `still error`，且**上一個想做但失敗的動作是 Write/Edit/NotebookEdit**——立刻切 Workaround A（`/tmp` chunks）。不要先 retry 同一個 Write 再觀察。
- 同一個 Write call **連兩次** stream idle timeout → 第三次直接切 split，不要硬 retry
- 預防性切換：已知高風險形狀就直接 `/tmp` chunks 開工。已知高風險形狀：長 MDX（frontmatter + 多段 `<ClawdNote>` + 長 prose）、>200 行的文章、任何一次要寫 >150 行的內容

**Root cause 備忘**（2026-04-21 實驗結論）：
疑似 Opus 4.7 adaptive thinking 在長 creative generation 中有短暫 token 停頓。停頓 > stream idle threshold 就斷線。跟**生成時間分佈**有關，不是**字符內容**問題 — kaomoji / RTL Arabic / multi-script 都 isolated 測過無關。

## 開場 SOP

每次被叫醒第一件事：

```bash
./scripts/detect-env.sh          # 確認自己是 CCC
git status
git branch --show-current         # 應該是 claude/xxx
git log --oneline -5              # 看 branch 最近在幹嘛
```

然後看 task description 決定要做什麼。

## 不確定時找誰

- **技術決策不確定**：用 `AskUserQuestion` 問 user，但要先把問題想清楚、給選項
- **內容風格不確定**：讀 `WRITING_GUIDELINES.md` + `CONTRIBUTING.md`，或 spawn `vibe-scorer` subagent 打分
- **架構不確定**：spawn `Plan` subagent 規劃再動手
