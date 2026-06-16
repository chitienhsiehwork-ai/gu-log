# mac-cdx / mac-CC Playbook

> **mac-cdx** = **Mac-local Codex Desktop / Codex CLI** — 跑在 user 個人 Mac 上的 Codex runtime。
>
> **mac-CC** = **Mac-local Claude Code-compatible harness** — 歷史名稱仍保留在檔名與部分 workflow 裡，避免打斷舊 script。
>
> 這份 playbook 給 mac-cdx / mac-CC 看。CCC（Cloud Codex / Cloud Claude Code）讀 `CCC-playbook.md`。用 `./scripts/detect-env.sh` 確認自己是誰。

## 精神

跟 CCC 一樣：**move fast, be independent, make good decisions, don't be a 伸手牌**。User 常開 yolo mode 離開現場，mac-cdx / mac-CC 該自己做 research / 自己判斷 / 自己動手。**不要一有模糊就問 user**——先讀 docs、讀 code、跑 script、試驗、查 git log。問 user 是最後一步，不是第一步。

## 差別只在環境，規則跟 CCC 共用

**工作規則**（commit discipline、scope ceiling、失敗處理、品質 gate）**全部共用 CCC-playbook.md 的內容**。那些是 agent 在這個 repo 的通則，不是 CCC 專屬。讀 CCC-playbook 的這幾段當 mac-cdx / mac-CC 自己的規則：

- Commit discipline（atomic commits）
- Scope ceiling（相關路徑 + prod/CI 緊急事件例外）
- 品質 gate（不能跳任何 hook 或 tribunal）
- 失敗處理（forward fix → opus subagent → revert）

## 環境差異（mac-cdx / mac-CC 該知道、CCC 不會遇到）

### Branch 位置不固定

mac-cdx / mac-CC 可能在任何 branch 上，不一定在 `claude/xxx`：
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

mac-cdx / mac-CC 不一定要走 PR + self-merge 流程：
- 在 main 上 → commit + push 就直接 Vercel deploy 上 prod（solo author policy 授權的）
- 在 feature branch 上 → push 到同名 remote branch，要不要開 PR 看情況
- 在 worktree 上 → 照該 worktree 的 scope 做事

GitHub MCP 不一定可用（看 user 的 Claude Code 設定）。可能有 `gh` CLI、可能沒有。觀察現況，不要硬叫 MCP tool。

### 本地環境優勢，該用

mac-cdx / mac-CC 有的 CCC 沒有的：
- **本地 dev server**：自己跑 `pnpm run dev` iterate，不要煩 user（user 只看 production）
- **playwright-cli skill**（`.claude/skills/playwright-cli/`）：截圖驗證 UI
- **uiux-auditor skill**（`.claude/skills/uiux-auditor/`）：改完視覺跑一次，強制雙主題截圖 + WCAG 對比
- **iCloud Drive 直接存取**：可以直接讀 Obsidian vault 裡的草稿（`~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/`），跑 `pnpm run obsidian:import`
- **沒有沙箱網路限制**：可以下載、可以 curl、可以 fetch 外部 API
- **Tribunal VM 存取**：tribunal daemon 跑在 `ssh clawd-vm`（`~/clawd/projects/gu-log`）。查狀態用 `/tribunal-monitor` skill（一鍵全面診斷），完整 ops 見 [`docs/tribunal-runbook.md`](../docs/tribunal-runbook.md)

這些都該主動用，不要因為 CCC 不能用就不用。

### Codex Desktop 專屬提醒

mac-cdx 會有 `CODEX_SHELL=1`、`CODEX_INTERNAL_ORIGINATOR_OVERRIDE` 或 `__CFBundleIdentifier=com.openai.codex` 這類環境線索。需要判斷 runtime 時，先用這些訊號，不要只靠舊的 `CC` 命名。舊命名還在，是為了讓 automation 活著，不是為了讓人類困惑。

## Tribunal writer mode 與子代理 broker

Tribunal 評審仍由 Codex/GPT-5.5 跑；文章正文的改寫永遠只能交給 Claude 寫手。為了避免 `claude -p` 產生額外付費用量，寫手路徑由 `GP_WRITER_MODE` 明確控制：

- `GP_WRITER_MODE=subagent`：Mac 互動式協調使用。pipeline 寫出請求檔，外層 CC session 讀請求後啟動 `tribunal-writer` Claude 子代理，子代理改文，最後寫完成標記。
- `GP_WRITER_MODE=none`：不改寫，只跑評分。這也是未設定或空字串時的預設，避免靜默花 API 錢。
- `GP_WRITER_MODE=cli`：舊的 `claude -p` 路徑，只有 operator 明確選用時可用；這會走 Claude CLI，可能產生額外付費用量。

VM cron 沒有互動式 CC、沒有 `claude -p`，也沒有 API 預算，所以 VM 使用 `GP_WRITER_MODE=none` 或直接不設定；結果是只跑評分，不會嘗試改寫。

### 子代理 broker protocol

外層負責協調的 CC 啟動 pipeline 時設定：

```bash
export GP_WRITER_MODE=subagent
export GP_WRITER_BROKER_DIR=/tmp/gu-log-writer-broker
export GP_WRITER_BROKER_TIMEOUT=1800
```

`GP_WRITER_BROKER_DIR` 若未設定，pipeline 會退回寫手暫存工作目錄裡的 `.writer-broker`，並在輸出中印出實際 broker 目錄；正常 Mac 協調流程應該總是明確設定。`GP_WRITER_BROKER_TIMEOUT` 預設 1800 秒。

寫手步驟會用 temp file 加 `mv` 的方式原子寫出：

```json
{
  "id": "<post-stage-attempt-epoch>",
  "agent_name": "tribunal-writer",
  "post_file": "sp-xxx.mdx",
  "post_path": "<abs path to src/content/posts/sp-xxx.mdx>",
  "en_post_path": "<abs path to en-sp-xxx.mdx, or empty>",
  "prompt": "<full tribunal-writer prompt>",
  "stage": "<stage_key>",
  "attempt": 1,
  "created_at": "2026-06-15T00:00:00Z"
}
```

完成標記檔與請求檔放在同一個目錄：

- `<id>.done`：Claude 子代理已成功在原檔改寫；pipeline 把寫手步驟視為成功。
- `<id>.failed`：Claude 子代理失敗；pipeline 把它視為一般寫手失敗，交給既有 cheap validation / revert 流程處理。
- `<id>.claimed`：由等待 helper 建立，避免兩個 CC loop 拿到同一個請求。

外層 CC loop 範例：

```bash
GP_WRITER_MODE=subagent GP_WRITER_BROKER_DIR="$broker_dir" \
  tools/sp-pipeline/gp-pipeline ralph ... &
pipeline_pid=$!

while true; do
  event="$(scripts/writer-broker-wait.sh --dir "$broker_dir" --pid "$pipeline_pid")"
  case "$event" in
    REQUEST\ *)
      request_path="${event#REQUEST }"
      # 啟動 Claude 子代理：
      # 1. 讀取 "$request_path"。
      # 2. 讀 request.prompt、request.post_path、需要時讀 request.en_post_path，
      #    再讀 GU-LOG_WRITER_PROMPT.md、CONTRIBUTING.md、tribunal-writer agent spec。
      # 3. 在原檔改寫文章。
      # 4. 成功寫 "$broker_dir/<id>.done"，失敗寫 "<id>.failed"。
      ;;
    PIPELINE_DONE)
      break
      ;;
  esac
done
```

等待 helper 介面：

```bash
scripts/writer-broker-wait.sh --dir <broker_dir> --pid <pipeline_pid> [--timeout <s>]
```

它 claim 到新的未處理請求時印 `REQUEST <abs path to request.json>`；pipeline pid 已結束且沒有請求時印 `PIPELINE_DONE`；可選 timeout 到期時印 `TIMEOUT` 並用非零 exit code 結束。

## SD 原創文：Opus 寫手、Codex 編排

當 user 明確指定「叫 Claude Opus 寫」、「writing/refine/rewrite 必須由 Claude Opus 做」時，mac-cdx / Codex 的角色只能是 **orchestrator / scorer / gatekeeper**，不能代寫文章正文。這條包含：

- 首稿 prose 由 Claude Opus 產出。
- refine / rewrite prose 由 Claude Opus 產出。
- Codex 可以整理 brief、挑 context、跑 validator、跑 scorer、萃取評審 feedback、檢查 frontmatter、修格式錯誤；但不能自己補正文段落、改寫句子、加 ClawdNote 當成內容。
- Claude 不可用時，停在「可交接的 Opus brief + scoring plan」，不要用 Codex 代筆硬完成。

低 token 工作流：

1. **Codex 先建短 brief**：只放這篇需要的 source facts、既有文章連結、必寫主軸、禁忌、frontmatter。不要把 `GU-LOG_WRITER_PROMPT.md`、整篇舊文、全部搜尋結果整包貼給 Opus；只引用必要規則與 5-10 條精準事實。
2. **先檢查 Claude auth，不花正文 token**：

   ```bash
   claude -p --model claude-opus-4-6 --tools "" --no-session-persistence "reply OK only"
   ```

   如果回 `Not logged in` 或 auth error，立即停止寫作路徑，回報需要登入，不要 fallback 到 Codex 寫正文。
3. **首稿只要求 MDX**：

   ```bash
   claude -p --model claude-opus-4-6 --permission-mode acceptEdits \
     --tools "" --no-session-persistence "$(cat /tmp/gu-log-opus-brief.md)"
   ```

   預設讓 Opus 輸出到 stdout，由 Codex 審核後再寫入 `src/content/posts/*`。不要讓 Opus 直接拿 repo edit 權限，除非任務明確是透過 broker 改已存在檔案。
4. **Codex scoring 只產生 feedback packet**：評審輸出要短，格式固定：`must_fix`、`nice_to_have`、`line_refs_or_excerpts`、`rubric_scores`。不要把整篇文章貼回 Opus；rewrite prompt 只放評審結論、必要片段、原檔路徑。
5. **Opus rewrite patch**：若需要重寫，Codex 叫 Opus 針對同一份 MDX 輸出完整新版或明確 patch；Codex 只負責套用、跑驗證、確認沒有違反規則。
6. **最後才 allocate 真號，但不要停下來問 user**：SD 原創文可以先用 `SD-PENDING` 和 `sd-pending-YYYYMMDD-*.mdx`；Tribunal / validator 過了、內容不是 critical design decision，就依 `CONTRIBUTING.md` 的 merge 前 swap procedure 自己拿 counter、改 `ticketId` / 檔名、補 en sidecar、validate、commit、push、PR/merge/deploy。`PENDING` 是防撞號的工作狀態，不是 human approval gate。

推薦 brief 骨架：

```md
You are Claude Opus writing an SD original article for gu-log.

Output only MDX.

Non-negotiable:
- zh-tw, Taiwan wording.
- No 「你 / 我」 in body; allowed inside ClawdNote / ShroomDogNote only.
- Writing/refine/rewrite must be your prose; Codex is only orchestrating.
- Fast-forward boring implementation details.

Article goal:
...

Facts allowed:
...

Voice:
...

Frontmatter:
...
```

這條 workflow 的精神是：**讓 Codex 省 Opus token，讓 Opus 只花在真正需要文筆和敘事判斷的地方。** Codex 不要拿高價寫手去讀整個 repo；也不要在寫手不可用時自己假裝是寫手。

## 這份 playbook 是 living doc

mac-cdx / mac-CC 如果遇到 Mac 專屬的狀況需要 codify（例如發現某個本地工具的坑、某個 skill 的新用法、某個 iCloud sync 的陷阱），直接編輯這份 playbook 加進去。

保持精簡——這份不是 CCC-playbook 的 duplicate，只寫 Mac-specific 的部分。
