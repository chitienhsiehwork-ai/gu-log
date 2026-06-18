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

**🔴 預設就是「綠了直接 merge」，不要為了確認而問 user。** 判斷三連：**CI 全綠** + **改動 logical/safe/appropriate（在 CCC scope 內）** + **不是 critical design decision** → CCC **自己 mark ready + merge + 讓 GitHub auto-delete branch**，不需要、也不該回頭問 user「要不要 merge / 要不要我合」。問這種問題 = 拖慢流程、浪費 user 注意力。

**唯一該停下來問的**：critical design decision——會改變產品方向、架構、對外承諾、或 user 個人品牌調性的東西（例：要不要砍掉一個系列、要不要改 site 結構、要不要公開某個敏感立場）。內容文章只要過了 vibe gate + CI 綠，就屬於「safe & appropriate」，直接 merge；revert 很便宜（auto-merge + atomic commit 就是為了讓 ship 快、回退也快）。

1. `git push -u origin claude/xxx`
2. 用 GitHub MCP (`mcp__github__create_pull_request`) 開 PR 到 main
3. **PR 開完立刻 `mcp__github__subscribe_pr_activity` 訂閱自己這條 PR**——不要問 user「要不要幫你盯」。CCC 開 PR 預設就要盯 CI + review comment，這是工作的一部分，不是 opt-in 服務。問就是 dumb question。
4. **等 CI 全綠**後自己 `mcp__github__merge_pull_request`
5. **Merge 完不用、也無法自己刪 remote branch**——repo 已開啟「Automatically delete head branches」，GitHub 在 merge 後自動刪掉 head branch，CCC 什麼都不用做。**⚠️ CCC 千萬不要嘗試 `git push origin --delete claude/xxx`**：sandbox 的 git proxy 會回 **HTTP 403**（只放行 push commit、不放行刪 ref），重試也是 403、純粹浪費 round。GitHub MCP 也沒有 delete-branch 工具。Local branch 是拋棄式 sandbox 的一部分，不用管。萬一哪天 auto-delete 被關掉導致 branch 沒被清，那是 user 去 GitHub 設定重開／手動刪的事，不是 CCC 能在 sandbox 內解決的。
6. Merge 完跟 user 回報 PR URL + 簡短 summary（branch 由 GitHub auto-delete 收尾），並附上**驗收用的 URL**——預設是 **prod URL**（`gu-log.vercel.app` 或文章深連結）。什麼時候給 prod URL、什麼時候才給 preview URL、什麼時候停下來問，照下面〈Preview URL vs 直接 merge〉那張表判斷。每個 turn 都要以可驗收的東西收尾（prod URL / preview URL+問題 / critical question），不留空回合。

**禁問句**：「要不要 subscribe PR activity？」「要不要盯 CI？」「要不要幫你看 review comment？」——通通是 dumb question，預設答案永遠是 yes，user 不該被叫去確認 default behavior。CCC 的工作是「開 PR → 盯 CI → merge → 回報」整條收乾淨；branch cleanup 交給 repo 的 auto-delete 設定，CCC 不去 `git push --delete`（那會 403）。

### Preview URL vs 直接 merge（收尾要給哪個）

**預設收尾不是給 preview URL，是 merge。** Preview URL 不是正常的 end-state，是「還不能 merge」或「reader-facing 又拿不準算不算 critical」的 fallback。給了 preview 又問「要不要我合？」是**反模式**——能 merge 就 merge，不能就問 critical question，中間沒有「我合好了但先停著等你看一眼」這種選項。

| 情況 | 收尾動作 |
|---|---|
| CI 綠 + safe + 非 critical（content 過 tribunal、bugfix、infra、doc typo） | **直接 merge → 部署完給 prod URL**。不要給 preview、不要問「要不要合」 |
| 改動 safe 但 CI 還在跑 | `enable_pr_auto_merge`（綠了自動合）→ 收尾講「已排 auto-merge，綠了會自動上」+ prod URL。仍不需要 preview |
| Reader-facing 視覺/UX 改動，而且你**真的拿不準**是不是動到品牌調性/產品方向（borderline critical） | 給 **preview URL + 一個具體問題**，讓 user 拍板。這是 preview URL 唯一的正常用途 |
| 明確的 critical design decision（產品方向、架構、對外承諾、品牌調性） | `AskUserQuestion` 停下來問，**不要**先 merge |

**白話**：「safe 但我想讓你看一眼再合」**不是**給 preview 的理由——safe 就直接合，ShroomDog 在 prod 上事後審（這正是 merge-後-審稿的設計，見 `CLAUDE.md`）。只有「這個 taste call 我真的不確定該不該自己拍」才值得 preview + 問。判斷不出來時，預設往「merge」靠，不要往「問」靠。

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

Vercel build / tribunal / validate-posts / CI 沒過：

1. **先試 forward fix**（新 commit 修）
2. 一次不過就想想再試第二次
3. 還不過就 spawn opus subagent 救（最多 3 次 subagent attempt）
4. 全部失敗 → `git revert` 並跟 user report 發生什麼事

**不要**：
- 用 `--no-verify` 跳過 hook
- 用 `git reset --hard` 丟掉別人的 commit
- 硬 force push 蓋掉 user 的改動
- 關掉 tribunal 讓爛文章過

## 品質 gate（全部不能跳）

- `pre-commit` hook（eslint / prettier / validate-posts / contrast check / ticketId dedup）
- `pre-push` hook（dependency / budget / dist checks）
- `validate-posts.mjs`（frontmatter + kaomoji + filename）
- Tribunal（Vibe + Fact + Librarian + FreshEyes）

這些是 CCC 能放手做事的**前提**。關掉任何一個 = CCC 失去工作的資格。

### Tribunal 必跑規則（任何新增/改寫文章的 PR）

**PR 動到 `src/content/posts/*.mdx`（新增 SP/CP/SD/Lv，或實質改寫既有文章）→ 四評審必跑，結果必記錄。沒跑完不開 PR，跑完 FAIL 不 merge。**

**首選**：`scripts/tribunal-batch-runner.sh` 或 `gp-pipeline ralph` 自動跑完四審 + rewrite + 寫 frontmatter scores。**這條在 CCC（root sandbox）現在可以原生跑**——`tribunal_claude_exec`（shell judges）和 Go `ClaudeProvider.Run`（pipeline）在 `id -u == 0` 時自動：(1) 用 `acceptEdits` 取代被 CLI 拒絕的 `bypassPermissions`，(2) 補 `--allowed-tools Read,Grep,Glob,Bash,Write,Edit,MultiEdit` 讓 judge Read 文章檔時不會卡 permission prompt，(3) prompt 走 stdin 避免 variadic 旗標吞掉內文。實測 `bash scripts/tribunal.sh --score-only --only-stage vibe <post>` 在 CCC 端到端 PASS（#123）。

**沙箱 fallback**（只有上面 shell/pipeline 路真的壞掉時才用——例如 quota 用盡、CLI 版本回歸）：**CCC 自己用 `Agent` tool 一次 spawn 四個 subagent 平行跑**，對應 `.claude/agents/`：

- `vibe-opus-scorer.md`（Opus）→ persona / clawdNote / vibe / clarity / narrative
- `fact-checker.md`（Opus）→ accuracy / fidelity / consistency（要 WebFetch 驗 sourceUrl）
- `librarian.md`（Opus 4.7）→ glossary / crossRef / sourceAlign / attribution
- `fresh-eyes.md`（Opus 4.7）→ readability / firstImpression

每個 agent 寫 JSON 到 `/tmp/tribunal-<ticketId>-<judge>.json`，schema 照各 agent spec。

**⚠️ 實測 caveat（2026-06-13）**：不是每個 CCC 網頁 harness 都把 `.claude/agents/` 註冊成 `Agent` tool 的 `subagent_type`。有的 session `Agent` tool 只開 built-in 的 `general-purpose` / `Explore` / `Plan`，named agent（`vibe-opus-scorer` 等）會回 `Agent type '...' not found`。遇到這種：**spawn `general-purpose`，在 prompt 裡叫它「讀 `.claude/agents/<judge>.md` 並完全照著做（zero parent context）」**，效果等同——judge 一樣 zero-context、一樣寫同一份 JSON。差別只在 model pin 顧不到（named agent 走 frontmatter 的 `claude-opus-4-6[1m]`，general-purpose 繼承 parent model），所以 `scores.*.model` 要記**實際**用到的 model，不要照抄 pin。agent 檔已補 `name:` frontmatter，環境若支援 project agent 就會吃到 named 路徑。`scripts/tribunal-helpers.sh` 在 CCC 偵測到沒有 CLI provider 時，也會把這條 fallback 指令印到 stderr。

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

## URL 貼過來 → 預設走 gp-pipeline

User 在 CCC 丟一個 URL 進來、**沒有附任何其他指示**（沒說「解釋這個」「總結這個」「fix bug in this PR」等）→ **預設當成是要你開 SP 任務**，走 `tools/sp-pipeline/gp-pipeline run <url>`。

### 為什麼 URL-only paste = SP 任務

這個 repo 的主產出就是 SP/CP 翻譯文章。User 拋 URL 沒多話 = 最常見的 workflow 就是「幫我把這條評估一下、該寫就寫」。**不要再回頭問「你想幹嘛？」**——直接跑 pipeline，它內建的 eval gate 會自己判斷該不該寫。

### pipeline 內建的 eval gate（不是你決定該不該寫）

`gp-pipeline run` 的 step 1.5 `eval` 是雙評估（Gemini + Codex）worthiness gate：

- **GO/GO** → 繼續跑寫作 → 12-point review → refine → tribunal → deploy
- **SKIP/SKIP** → exit 12 → 不寫，從 queue 丟掉（不夠 SP-worthy）
- **split（一 GO 一 SKIP）** → exit 2 → 需要 human review，用 `--force` 可以 override gate 硬寫

**這代表 CCC 不用事先判斷「這條推文值不值得翻」**——交給 pipeline 的 eval 決定。你的工作是 run，不是 gatekeep。

### URL 範圍

`gp-pipeline` 的 `source.Fetch` dispatcher（`tools/sp-pipeline/internal/source/fetch.go`）接受**任意 http(s) URL**：

- **X / Twitter URLs**（`x.com` / `twitter.com`，含 `www.`）→ 走 `FetchX`，用 `scripts/fetch-x-article.sh` 拉 fxtwitter JSON，品質最好
- **其他 http(s) URL**（`claude.com` / `anthropic.com` / blogs / docs / etc.）→ 走 `FetchGeneric`，用 `curl -sSL` + 最小 HTML cleanup（砍 `<script>` / `<style>` / 標籤、decode entities、壓縮空白），送進 `ValidateArticleCapture` 驗

非 http(s) scheme（`file://`、`javascript:`）、localhost、RFC1918 / loopback / link-local IP 會在 URL validator 被擋掉（SSRF 防線）。遇到 paywall / JS-challenge / SSR-heavy 的 host，`ValidateArticleCapture` 會拒絕並給你 `code: 11`——這時再走手動 fallback。

### 建議指令

```bash
# 預設：跑完整 pipeline（fetch → eval → dedup → write → review → refine → tribunal → deploy）
tools/sp-pipeline/gp-pipeline run <url>

# 只想看 eval gate 怎麼判（不寫）：先 fetch 再單跑 eval
tools/sp-pipeline/gp-pipeline fetch <url> --work-dir /tmp/sp-probe
tools/sp-pipeline/gp-pipeline eval --source /tmp/sp-probe/source-tweet.md

# Eval gate split/SKIP 但 user 堅持要寫 → 加 --force
tools/sp-pipeline/gp-pipeline run <url> --force
```

### Sandbox 網路能力（2026-04-23 實測）

**CCC 沙箱的 command-line HTTPS 是通的。** `curl https://claude.com/...` 正常回 200，`gp-pipeline` 內建的 `FetchGeneric`（走 curl）實測可以直接在 CCC 裡抓外部文章。**不要再用「沙箱沒外網所以只能 mac 跑」當藉口**——那是過時的心智模型。

什麼還是受限：
- **`playwright-cli` 的 browser navigation**：`goto` 在 `domcontentloaded` 卡死、Google Fonts 之類 CSS 外鏈拿不到（要 route-abort workaround，見 `uiux-auditor` skill）
- **`x.com` / `twitter.com` 直接 curl**：會拿到 React shell（沒 prerender content）——所以 X 專用的 fetch 路徑走 `fetch-x-article.sh`（fxtwitter）而不是 raw curl。這跟「外網通不通」無關，是 X 自己 anti-bot
- **`WebFetch` tool**：對某些 host 會被 upstream proxy 檔掉，curl 反而可以

結論：CCC 沙箱可以直接 `gp-pipeline run <url>`，fetch + eval + dedup + write + review + refine + tribunal + deploy 整條都能在 CCC 跑完。

### 什麼時候才真的要 fallback 到手動 `claude -p`

不是因為沒網路、也不是因為 auth 不到——2026-04-23 實測：
- **Auth OK**：CCC 有 `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`，`claude -p` subprocess 可以認證完成並回應
- **`--permission-mode bypassPermissions` / `--dangerously-skip-permissions` 在 root 會被 CLI 直接拒**。`gp-pipeline` 的 `ClaudeProvider.Run` 和 shell judges（`tribunal-helpers.sh` 的 `tribunal_claude_exec`，`vibe-scorer.sh` / `tribunal-all-claude.sh` 現在只是 → `tribunal.sh` 的 deprecated wrapper）都在 `id -u == 0` 時自動把這 flag 換成 `acceptEdits`，所以這層不再是 blocker
- **`acceptEdits` 只自動核准 edit，judge / stage 要 Read 文章檔時還是會卡 permission prompt**（`</dev/null`/stdin 無 TTY → 靜默 hang，原本 #123 的 30s timeout 就是這個）。修法：root 下同時補 `--allowed-tools Read,Grep,Glob,Bash,Write,Edit,MultiEdit`，把 judge 會用到的工具顯式 allowlist 掉（等於用比 bypassPermissions 更窄的清單複製「不 prompt」行為）；prompt 一律走 stdin，避免 variadic 的 `--allowed-tools` 把 prompt 內文當成 tool 規則吞掉。修完實測單篇 vibe stage 在 CCC PASS（composite=8）
- **Long creative generation 本身還會踩 stream idle timeout**（見本檔下方「Stream idle timeout 應對」那一節）

真正要 fallback 的時候怎麼走：

1. `gp-pipeline fetch <url>` 先把 source 抓下來（這步幾乎不會炸）
2. 單獨跑 prompt：`claude -p --model opus "<prompt>"` 模擬 write / refine 階段（**在 CCC root 下不要加 `--permission-mode` 也不要加 `--dangerously-skip-permissions`，會被擋**）。review / eval / tribunal judges 仍走 Codex GPT-5.5；只有沒有 `codex` 的 CCC fallback 才用 Claude。
3. tribunal 改用本 playbook「Tribunal 必跑規則」那段的 4 個 subagent 平行跑

**SP writer 在 Mac pipeline 鎖 `claude-opus-4-5`**（`claude.go` 的 `ClaudeOpusPinned`），不再走浮動 `opus` alias——寫作 voice 對 Opus 版本敏感，Anthropic 一升 alias 就可能改掉 LHY persona，所以釘死版本。pipeline 仍會從 Claude Code JSON metadata 讀回實際 model 寫進 frontmatter。Fact Checker fallback judge 跟 doctor probe 才繼續用浮動 `opus` alias（追最新）。

### 模型路由（Mac writer + Codex judges）

2026-06-13 更新：Claude 在 VM/CCC 上不作為主要 runtime；VM 是 Codex GPT-5.5 的地盤。Mac pipeline 的分工如下：

- **SP writer / refine**（`tools/sp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned`）→ 鎖 `claude-opus-4-5`（不走浮動 alias，避免寫作 voice 漂移），runtime metadata 記錄實際版本
- **Eval / review / tribunal judges** → `codex exec --model gpt-5.5`，完整版 GPT，不走 mini
- **Vibe Scorer**（`.claude/agents/vibe-opus-scorer.md`）→ 鎖 `claude-opus-4-5`
- **Tribunal Writer legacy agent**（`.claude/agents/tribunal-writer.md`）→ 鎖 `claude-opus-4-5`，只當 legacy / fallback calibration，不是 Codex runtime selector
- **Fact Checker**（`.claude/agents/fact-checker.md`）→ 用 `opus` alias（追最新，fact-check 要 reasoning 強的，沒有 voice 問題；**不動**）
- **Librarian**（`.claude/agents/librarian.md`）→ `claude-opus-4-7`
- **Fresh Eyes**（`.claude/agents/fresh-eyes.md`）→ `claude-opus-4-7`

修 `.claude/agents` 這些 legacy calibration 檔之前先讀 frontmatter 上方的 PIN 註解；它們不是 active Codex runtime model selection。

## 文章寫作 SOP（省 token 版）

**核心原則：先寫好 zh-tw，通過 tribunal 後才翻 en。不要兩個版本同時寫、同時改。**

原因很簡單：tribunal 回來的修改意見要 iterate，如果兩版都寫了，每輪 rewrite 要改兩份，token 花費直接翻倍。zh-tw 是主版本，en 是衍生翻譯，先把主版本品質打到及格再翻。

**晶晶體防線**：zh-tw 文章禁止裝飾性中英夾雜。API、CLI、MCP、model 名、產品名等技術專有名詞保留英文 OK，但「這個 approach 很 solid」「deliver 一個 production-ready 的 output」這種寫法一律改成自然中文。Tribunal 的 vibe scorer 會對晶晶體扣分（clarity -3, vibe -4）。

**🔧 查晶晶體（跟所有 deterministic 檢查）一律跑 script / grep，不要 Read 整篇文章用人眼挑英文**。`node scripts/check-jingjing.mjs` 本身就是 ripgrep-based 掃描器，會把每個違規詞、行號、上下文一次列出來；pronoun 檢查、frontmatter 驗證同理（`check-pronoun-clarity.mjs`、`validate-posts.mjs`）。為了「確認有沒有英文詞」去 `Read` 一整個 .mdx 是純浪費 token——deterministic 規則交給 deterministic 工具，Read 只留給需要理解語意/語氣的時候（例如自己重讀文章判斷 vibe）。同理，要找某個詞出現在哪，用 `Grep` 不要 `Read` 全檔。

### 流程

```
Step 1: 寫 zh-tw 版
  - 建立 MDX，填 frontmatter，寫正文
  - ClawdNote / ShroomDogNote 都在這步完成
  - validate-posts.mjs 確認格式

Step 2: Tribunal review（spawn subagent）
  - Vibe Scorer（Opus 4.6[1m]）：五維評分
  - Fact Checker（Opus 4.7）：技術準確度
  - Librarian（Opus 4.7）：glossary / cross-ref
  - Fresh Eyes（Opus 4.7）：陌生讀者第一印象
  - Pass bar：Vibe composite ≥ 8 且沒有任何維 < 8

Step 3: Iterate（如未通過）
  - Spawn opus writer subagent，帶入 tribunal feedback
  - Writer 改寫 zh-tw 版
  - 再跑 tribunal
  - 最多 3 輪。3 輪還沒過 → 回報 user，不要硬出

Step 4: zh-tw 通過 → 翻譯 en 版
  - 以通過 tribunal 的 zh-tw 為 source
  - 翻成 en，按 GU-LOG_WRITER_PROMPT.md 的英文版指南
  - en 版不用再跑完整 tribunal（zh-tw 已驗證內容品質）
  - 但仍需通過 validate-posts.mjs

Step 5: 更新 counter → commit → push
  - 兩版一起 commit（atomic：一篇文章 = 一個 commit）
  - 更新 scripts/article-counter.json
```

### 為什麼不 en 也跑 tribunal？

- zh-tw 和 en 的**內容一致**（en 是翻譯，不是另一篇文章）
- Tribunal 驗的是內容品質（persona / fact / vibe），不是語言品質
- en 版的語言品質靠 GU-LOG_WRITER_PROMPT 的 en 指南 + 翻譯者的功力
- 真的對 en 版不放心 → 可選跑一次 Fresh Eyes，但不是必須

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

**什麼時候切 split mode — 一次就要切，不要等 user 講第二次**：

**硬規則（First-Error-Means-Switch）**：任何形狀像「Error」、「Error again」、「retry」、「resume」、「continue」、「still error」、「/tmp strategy」的 user 訊息出現一次，且前一個失敗動作是 Write/Edit/NotebookEdit —— **立刻、無條件切 Workaround A（`/tmp` chunks）**。不要先 retry 同一個 Write 觀察、不要問 user「要不要換方式」、不要 partial write 看看能不能塞下去。**User 講第一次就是最後一次**。如果 user 得講第二次，那是播音 bug，不是策略問題。

- **預防性 trigger**（根本不用等 error）：看到自己要寫的 MDX **≥150 行** 或**含 3 個以上 ClawdNote** 或**含 frontmatter + 多段 prose + code blocks 混排**——**開寫前就直接切 `/tmp` chunks**，不要先賭一次 big Write 看運氣。
- 反向防呆：如果已經在 `/tmp` chunks 模式還報 error，**chunks 再切小**（每檔 ≤50 行），不是切回 big Write。
- 舊 trigger 仍然保留（保險起見）：user 回報 `error` / `retry` / `resume` / `proceed` / `continue` / `still error`，且**上一個想做但失敗的動作是 Write/Edit/NotebookEdit**——立刻切 Workaround A。

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

接著跑 **CCC 環境 smoke test** 確認這個全新 sandbox 真的能開工（deps、git hooks、外網、gp-pipeline、validate-posts 一次驗完）：

```bash
./scripts/ccc-smoke-test.sh --fix     # --fix 會先補 deps + 掛 hooks，再跑所有 check
# 加 --full 會多跑 lint + astro check（較慢）
```

全綠才開工。任何 ✗ 多半 `--fix` 能自動補；補不掉的（例如外網被擋、hook source drift）照訊息修。這支 script 也守住 hook source-of-truth drift（`scripts/hooks/` vs `.githooks/`），避免 setup-hooks 裝到過時的 pre-commit。

然後看 task description 決定要做什麼。

### Fresh-env friction：系統性收斂，不要每個 session 重踩

**CCC 每次都是全新 sandbox（fresh clone，啥都沒裝）。任何「每個 session 都會重複踩」的環境 friction，正確解法是把它收進 SessionStart hook（`.claude/hooks/session-start.sh` → `scripts/ccc-smoke-test.sh --fix`），不是這個 session 手動補一次了事。** 手動補 = 下個 CCC 在新 sandbox 又從零踩一次，等於把 friction 留給下一個 agent——違反「絕不甩鍋給下個 session」最高原則。

判斷準則：**friction 是不是「換個 sandbox 還會再發生」？** 是 → 進 hook。只發生在這個 task 的一次性問題（某篇文章 frontmatter 寫錯）→ 當場修就好，不用進 hook。

收進 hook 的兩種模式：

- **同步補**（快、且開工前就需要）：deps（`pnpm install`）、git hooks（`setup-hooks`）、sp-pipeline 自編譯。放 `--fix` 區塊直接跑完，smoke test 順便驗。
- **非同步背景補**（慢、下載大、不是開工就馬上要）：Playwright chromium binary（~100MB，uiux-auditor / playwright-cli / verify 才要）。`--fix` 用 `nohup … & disown` 丟背景，**不擋 session 開場**，等真的要截圖時通常已下載好。Smoke test 另開一個 optional readiness check（warn 不擋 exit）回報「裝好了 / 還在下載 / 沒裝」，讓 agent 知道現在能不能截圖。

  Playwright 就是這個模式的範本（2026-06-12 加）：`ccc-smoke-test.sh --fix` 在 `CLAUDE_CODE_REMOTE=true` 時，偵測 `${PLAYWRIGHT_BROWSERS_PATH:-~/.cache/ms-playwright}` 沒有 chromium 快取就背景下載，idempotent（已裝或已在下載就跳過），只在 CCC 跑（mac-CC 自己管 local Playwright）。所以「Playwright 沒裝」這個 friction 對之後的 CCC 不該再發生——醒來時背景已經在補了。

**鐵則：撞到新的 recurring env friction → 在同一個 PR 把它收進 hook，當場消滅，別只修這次。** 這跟 CLAUDE.md「主任務踩到的 bug 順手修在同一個 PR」是同一條精神，只是套用在環境層：hook 是 CCC fresh-env friction 的 SSOT，能進 hook 的就別留在 per-session 手動步驟。

## 不確定時找誰

- **技術決策不確定**：用 `AskUserQuestion` 問 user，但要先把問題想清楚、給選項
- **內容風格不確定**：讀 `GU-LOG_WRITER_PROMPT.md` + `CONTRIBUTING.md`，或 spawn `vibe-scorer` subagent 打分
- **架構不確定**：spawn `Plan` subagent 規劃再動手
