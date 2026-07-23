# CCC Playbook

> **CCC** = **Cloud Claude Code** — Claude Code 網頁版，在 Anthropic 的 GCP sandbox 跑，每次被叫醒都在 harness 自動建的 `claude/xxx` branch 上。
>
> 這份 playbook **只給 CCC 看**。如果你是 local machine actor（例如 `m1-cdx` / `m1-cc`），讀 `local-agent-playbook.md`。用 `./scripts/detect-env.sh --runtime <codex|claude-code> --identity` 確認自己是誰。

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
- Commit 的作者名稱必須可辨識實際執行的 model；不要使用會抹去來源的通用 agent 名稱。各執行環境都用當前 model 的身分設定。
- 不要把「改 import script + 升 astro + 改 CSS + 加新頁」塞同一個 commit——revert 一個會連累其他四個。
- **Resumed session 的簽章雷**：session resume 後 git 的 signing key / committer email 可能是空檔，commit 會變 Unverified、反覆絆 stop hook。照 hook 訊息修（`git config user.email noreply@anthropic.com` + `git commit --amend --no-edit --reset-author`）再 push；不要跟 hook 打架、也不要為了省事跳過。

## Scope ceiling（順手修的上限）

**一般情況**：只修「當前任務路徑相關」的問題。別的等下次任務，不要 yak-shaving。

**例外（永遠順手修，不管 scope）**：
- Production 炸了（Vercel 上線掛了，user 會看到）
- main CI broken（有 regression 溜過 pre-push）
- 這類緊急事件沒有 scope 之分，看到立刻修。

## Self-merge policy

**🔴 預設就是「綠了直接 merge」，不要為了確認而問 user。** 判斷三連：**CI 全綠** + **改動 logical/safe/appropriate（在 CCC scope 內）** + **不是 critical design decision** → CCC **自己 mark ready + merge + 讓 GitHub auto-delete branch**，不需要、也不該回頭問 user「要不要 merge / 要不要我合」。問這種問題 = 拖慢流程、浪費 user 注意力。

**唯一該停下來問的**：critical design decision——會改變產品方向、架構、對外承諾、或 user 個人品牌調性的東西（例：要不要砍掉一個系列、要不要改 site 結構、要不要公開某個敏感立場）。內容文章只要過了 vibe gate + CI 綠，就屬於「safe & appropriate」，直接 merge；revert 很便宜（auto-merge + atomic commit 就是為了讓 ship 快、回退也快）。

### ShroomDog 只在 merge 之後才參與（所以不准 merge 前停下來問要不要先讀 draft）

- **User 只看 production**（gu-log.vercel.app）。不要叫 user 開 dev server。
- **🔴 ShroomDog（作者本人）只在 merge 之後才參與**，而且是在 **prod URL（gu-log.vercel.app）或 branch/preview URL** 上讀成品——**不讀 draft、不看 diff、不在 merge 前審稿**。所以任何 agent **不准停下來問 user「要不要先讀這篇 draft 再 merge」**，那等於把 author 拖進 pre-merge 流程，違反這條。寫作 / 翻譯任務只要 (1) 品質 gate 全綠（pre-commit / pre-push / tribunal floor composite ≥3）、(2) 內容 logical / safe、(3) 不是 critical product / 架構決策 → **自己 merge**，author 之後在 prod 或 branch URL 上看，要回饋他會在 merge 後給（進 `docs/shroomdog-editorial-feedback.md`）。唯一要 merge 前停下來問的：產品方向、對外承諾、或不確定該不該公開的 critical design decision。「文章寫得好不好 / 語氣對不對」**不是** stop 的理由——那靠 tribunal gate 把關，author 在 prod 上事後挑。

1. `git push -u origin claude/xxx`
2. 用 GitHub MCP (`mcp__github__create_pull_request`) 開 PR 到 main
3. **PR 開完立刻 `mcp__github__subscribe_pr_activity` 訂閱自己這條 PR**——不要問 user「要不要幫你盯」。CCC 開 PR 預設就要盯 CI + review comment，這是工作的一部分，不是 opt-in 服務。問就是 dumb question。**這條沒有「除非」**：開了 `enable_pr_auto_merge`、CI 還在 pending、改動很 safe、你覺得「應該會自己合」——通通不解除盯的責任。**訂閱是無條件動作，跟 subscribe 同一個 round 一起做完，不留到下個 turn、更不丟回給 user 決定。** 你盯，不然誰盯？（webhook 不送 CI success / merge transition，所以光訂閱不夠，見步驟 7 的 send_later check-in。）
4. **開完 PR 同一個 round 就把 merge 交給 server-side**：harness 若強制開 draft，立刻 `mcp__github__update_pull_request` 轉 ready，接著 `mcp__github__enable_pr_auto_merge`（品質 gate 本來就在開 PR 前跑完，沒有理由停在 draft 等 CI）。CI 綠了 GitHub 自己合，**不依賴 session 醒著**。CCC session 閒置會被睡掉，任何 in-session 排程（CronCreate / Monitor / background polling，不管幾分鐘一次）都跟著凍結——「等 CI 綠我再回來 merge」= 賭 session 還活著（2026-07-02 GP-247 實測：draft 停等 → session 睡 2 小時 → main 前進變 behind → 又多卡兩小時等 user 手動叫醒）。醒著等到 CI 綠直接 `mcp__github__merge_pull_request` 當然更快，但 auto-merge 必須先掛上當保險，不是二選一
5. **Merge 完不用、也無法自己刪 remote branch**——repo 已開啟「Automatically delete head branches」，GitHub 在 merge 後自動刪掉 head branch，CCC 什麼都不用做。**⚠️ CCC 千萬不要嘗試 `git push origin --delete claude/xxx`**：sandbox 的 git proxy 會回 **HTTP 403**（只放行 push commit、不放行刪 ref），重試也是 403、純粹浪費 round。GitHub MCP 也沒有 delete-branch 工具。Local branch 是拋棄式 sandbox 的一部分，不用管。萬一哪天 auto-delete 被關掉導致 branch 沒被清，那是 user 去 GitHub 設定重開／手動刪的事，不是 CCC 能在 sandbox 內解決的。
6. Merge 完跟 user 回報 PR URL + 簡短 summary（branch 由 GitHub auto-delete 收尾），並附上**驗收用的 URL**——預設是 **prod URL**（`gu-log.vercel.app` 或文章深連結）。什麼時候給 prod URL、什麼時候才給 preview URL、什麼時候停下來問，照下面〈Preview URL vs 直接 merge〉那張表判斷。每個 turn 都要以可驗收的東西收尾（prod URL / preview URL+問題 / critical question），不留空回合。
   - **URL 不等 merge 才第一次給**：內容任務的 prod URL 是 deterministic——由檔名推導（`/posts/<slug>/`，en 版 `/en/posts/en-<slug>/`），不需要等 deploy 才知道。所以在「開 PR + auto-merge 掛好」的**同一個回合**就先給**預定 prod URL**，講明「CI 綠了會自動 merge + 上線」；這樣就算 session 之後被睡掉（見步驟 4），user 手上已經有可點的連結，成果自己上線、不會卡在沒人回報。之後醒著時再補一句 deploy 完成的 smoke test 結果（HTTP 200 + 標題）即可，那是驗證、不是 user 拿到連結的前提。
7. **盯到 merge / closed 才算收尾，中途不准把球丟回 user。** 訂閱不是「設定好就沒事」：webhook **不送** CI success、新 push、merge-conflict transition，所以光等事件會卡死。`send_later`（claude-code-remote MCP）可用時，排一個約 1 小時後的自我 check-in，醒來重查 PR 的 CI / mergeability / 狀態，有事就處理、沒事就**靜默 re-arm**（不要為了「沒事」去吵 user 或在 PR 灌留言），直到 PR merged/closed 或 user 喊停。`send_later` 不可用時，就在每次相關 event 醒來時順手重查一次。

**禁問句**（出現任一句 = 違規，預設答案永遠是 yes，user 不該被叫去確認 default behavior）：「要不要 subscribe PR activity？」「要不要盯 CI？」「要不要幫你看 review comment？」「要我盯著確認真的 merge 嗎？」「還是放著讓 auto-merge 處理就好？」「要不要我 watch 這條 PR？」——**特別注意最後這幾句**：開了 `enable_pr_auto_merge` 之後在結尾問「要我盯 vs 放著讓它自動合」是最常見的偷懶收尾，**auto-merge 開了 ≠ 你可以不盯**，照樣要 subscribe + follow-through 到真的 merge。CCC 的工作是「開 PR → 盯 CI → merge → 回報」整條收乾淨；branch cleanup 交給 repo 的 auto-delete 設定，CCC 不去 `git push --delete`（那會 403）。

### Preview URL vs 直接 merge（收尾要給哪個）

**預設收尾不是給 preview URL，是 merge。** Preview URL 不是正常的 end-state，是「還不能 merge」或「reader-facing 又拿不準算不算 critical」的 fallback。給了 preview 又問「要不要我合？」是**反模式**——能 merge 就 merge，不能就問 critical question，中間沒有「我合好了但先停著等你看一眼」這種選項。

| 情況 | 收尾動作 |
|---|---|
| CI 綠 + safe + 非 critical（content 過 tribunal、bugfix、infra、doc typo） | **直接 merge → 部署完給 prod URL**。不要給 preview、不要問「要不要合」 |
| 改動 safe 但 CI 還在跑 | `enable_pr_auto_merge`（綠了自動合）→ 收尾講「已排 auto-merge，綠了會自動上」+ prod URL。仍不需要 preview |
| Reader-facing 視覺/UX 改動，而且你**真的拿不準**是不是動到品牌調性/產品方向（borderline critical） | 給 **preview URL + 一個具體問題**，讓 user 拍板。這是 preview URL 唯一的正常用途 |
| 明確的 critical design decision（產品方向、架構、對外承諾、品牌調性） | `AskUserQuestion` 停下來問，**不要**先 merge |

**白話**：「safe 但我想讓你看一眼再合」**不是**給 preview 的理由——safe 就直接合，ShroomDog 在 prod 上事後審（這正是 merge-後-審稿的設計，見上面〈ShroomDog 只在 merge 之後才參與〉）。只有「這個 taste call 我真的不確定該不該自己拍」才值得 preview + 問。判斷不出來時，預設往「merge」靠，不要往「問」靠。

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

**PR 動到 `src/content/posts/*.mdx`（新增 GP/MP/SD/Lv，或實質改寫既有文章）→ 四評審必跑，結果必記錄。沒跑完不開 PR；跑完 sub-8 不是 merge blocker，但 floor 沒過不能 merge。**

**首選**：`scripts/tribunal-batch-runner.sh` 或 `gp-pipeline ralph` 自動跑完四審 + rewrite + 寫 frontmatter scores。**這條在 CCC（root sandbox）現在可以原生跑**——`tribunal_claude_exec`（shell judges）和 Go `ClaudeProvider.Run`（pipeline）在 `id -u == 0` 時自動：(1) 用 `acceptEdits` 取代被 CLI 拒絕的 `bypassPermissions`，(2) 補 `--allowed-tools Read,Grep,Glob,Bash,Write,Edit,MultiEdit` 讓 judge Read 文章檔時不會卡 permission prompt，(3) prompt 走 stdin 避免 variadic 旗標吞掉內文。實測 `bash scripts/tribunal.sh --score-only --only-stage vibe <post>` 在 CCC 端到端 PASS（#123）。

**沙箱 fallback**（只有上面 shell/pipeline 路真的壞掉時才用——例如 quota 用盡、CLI 版本回歸）：CCC 依 `.claude/agents/` 的四個 role 平行跑；浮動 alias 的 judge 用 `Agent` tool，exact-version pinned 的 Vibe 用 `claude -p --model <frontmatter 的完整 id>`：

（每個 agent 用哪個 model = 它的 `model:` frontmatter，**這裡不複述版本號**，見〈模型路由〉的 SSOT 提醒）：

- `vibe-opus-scorer.md` → persona / moguNote / vibe / narrative（v9；clarity 已移到 Fresh Eyes，v8 以下才含 clarity；以 `claude -p` 保住 exact pin）
- `fact-checker.md` → accuracy / fidelity / consistency（要 WebFetch 驗 sourceUrl）
- `librarian.md` → glossary / crossRef / sourceAlign / attribution
- `fresh-eyes.md` → readability / firstImpression / payoffDensity / lengthFit / clarity（v9；clarity 是非補償硬門檻，v8 以下無）

每個 agent 寫 JSON 到 `/tmp/tribunal-<ticketId>-<judge>.json`，schema 照各 agent spec。

**⚠️ 實測 caveat（2026-06-13）**：不是每個 CCC 網頁 harness 都把 `.claude/agents/` 註冊成 `Agent` tool 的 `subagent_type`。有的 session `Agent` tool 只開 built-in 的 `general-purpose` / `Explore` / `Plan`，named agent 會回 `Agent type '...' not found`。浮動 judge 遇到這種情況，可 spawn `general-purpose`，在 prompt 裡叫它「讀 `.claude/agents/<judge>.md` 並完全照著做（zero parent context）」；它會繼承 parent model，所以 `scores.*.model` 要記**實際** model。exact-version pinned 的 Vibe 不走這個 fallback，仍用 `claude -p`。agent 檔的 `name:` frontmatter 只負責 role registration，不拿來保證 exact pin。`scripts/tribunal-helpers.sh` 在 CCC 偵測到沒有 CLI provider 時，也會把 fallback 指令印到 stderr。

**品質門檻（SSOT = `CONTRIBUTING.md`〈🎯 兩層品質門檻〉；消費端可見性行為的 formal spec = `openspec/specs/publish-bar-visibility/spec.md`；本段是 derived view）**：
- **Floor（merge/ship gate）**：`scores.vibe` 存在、該 tribunalVersion 要求的 vibe 維度齊、且 composite ≥ 3。沒過 floor → pre-commit 會擋，不能 merge。
- **PASS（首頁 / featured gate）**：Vibe composite ≥ 8 AND 至少一維 ≥ 9 AND 無任何維 < 8；Fact core avg ≥ 8 AND sourceBoundary ≥ 8 AND commentarySeparation ≥ 8；Librarian composite ≥ 8；FreshEyes composite ≥ 8 AND payoffDensity ≥ 8 AND lengthFit ≥ 8 AND（v9）clarity ≥ 8。沒過 PASS 仍可 merge/ship，但掛「精修中」badge，且不上首頁 / featured。

**沒過 PASS 怎麼辦**：有 quota 就讀 `tribunal-writer` role prompt，以 `claude -p --model <frontmatter 的完整 id>` rewrite → 再跑一輪 → 最多 3 輪。3 輪還不到 ≥8，不要 revert；只要 floor ≥3 就先誠實帶 sub-8 badge ship，排進背景 tribunal 繼續拉。

**禁語**（這些話出現在 PR body / commit message / 回報 = 偷工）：
- ❌「Tribunal 背景跑中，等拿到結果再補」— 不行。pending 等於沒跑。開 PR 前就要有結果。
- ❌「Tribunal 跳過」「先 merge 再補分數」「這次例外」— 全不行；至少要有 floor 可驗證的真分數。
- ❌「只跑 vibe 就好」「不跑 FreshEyes」— 四個都要跑，缺一不可。

**必附證據**：PR body 或一個隨 PR 的 commit 要包含四個 judge 的分數 + verdict，並把 `scores.vibe` / `scores.factCheck` / `scores.librarian` / `scores.freshEyes` 寫進文章 frontmatter（用 `scripts/frontmatter-scores.mjs write <file> <judge> <score_json>`，schema 見 `src/content.config.ts`）。pre-commit 的 score gate（`.githooks/pre-commit` 第 60 行起）會擋掉**新增**且 ticketId 非 PENDING 的 zh-tw 文章 commit，所以 swap PENDING → 真號那個 commit 之前，分數要先進 frontmatter。

## URL 貼過來 → 預設走 gp-pipeline

User 在 CCC 丟一個 URL 進來、**沒有附任何其他指示**（沒說「解釋這個」「總結這個」「fix bug in this PR」等）→ **預設當成是要你開 GP 任務**，走 `tools/gp-pipeline/gp-pipeline run <url>`。

### 為什麼 URL-only paste = GP 任務

這個 repo 的主產出就是 GP/MP 翻譯文章。User 拋 URL 沒多話 = 最常見的 workflow 就是「幫我把這條評估一下、該寫就寫」。**不要再回頭問「你想幹嘛？」**——直接跑 pipeline，它內建的 eval gate 會自己判斷該不該寫。

### pipeline 內建的 eval gate（不是你決定該不該寫）

`gp-pipeline run` 的 step 1.5 `eval` 是雙評估（Gemini + Codex）worthiness gate：

- **GO/GO** → 繼續跑寫作 → 12-point review → refine → tribunal → deploy
- **SKIP/SKIP** → exit 12 → 不寫，從 queue 丟掉（不夠 GP-worthy）
- **split（一 GO 一 SKIP）** → exit 2 → 需要 human review，用 `--force` 可以 override gate 硬寫

**這代表 CCC 不用事先判斷「這條推文值不值得翻」**——交給 pipeline 的 eval 決定。你的工作是 run，不是 gatekeep。

### URL 範圍

`gp-pipeline` 的 `source.Fetch` dispatcher（`tools/gp-pipeline/internal/source/fetch.go`）接受**任意 http(s) URL**：

- **X / Twitter URLs**（`x.com` / `twitter.com`，含 `www.`）→ 走 `FetchX`，用 `scripts/fetch-x-article.sh` 拉 fxtwitter JSON，品質最好
- **其他 http(s) URL**（`claude.com` / `anthropic.com` / blogs / docs / etc.）→ 走 `FetchGeneric`，用 `curl -sSL` + 最小 HTML cleanup（砍 `<script>` / `<style>` / 標籤、decode entities、壓縮空白），送進 `ValidateArticleCapture` 驗

非 http(s) scheme（`file://`、`javascript:`）、localhost、RFC1918 / loopback / link-local IP 會在 URL validator 被擋掉（SSRF 防線）。遇到 paywall / JS-challenge / SSR-heavy 的 host，`ValidateArticleCapture` 會拒絕並給你 `code: 11`——這時再走手動 fallback。

### 建議指令

```bash
# 預設：跑完整 pipeline（fetch → eval → dedup → write → review → refine → tribunal → deploy）
tools/gp-pipeline/gp-pipeline run <url>

# 只想看 eval gate 怎麼判（不寫）：先 fetch 再單跑 eval
tools/gp-pipeline/gp-pipeline fetch <url> --work-dir /tmp/gp-probe
tools/gp-pipeline/gp-pipeline eval --source /tmp/gp-probe/source-tweet.md

# Eval gate split/SKIP 但 user 堅持要寫 → 加 --force
tools/gp-pipeline/gp-pipeline run <url> --force
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
2. 單獨跑 prompt：`claude -p --model <writer pin 的完整 id>` 模擬 write / refine 階段（id = `tribunal-writer` agent frontmatter，**SSOT**；寫這段時是 `claude-opus-4-5`，要打之前先讀 frontmatter）（**在 CCC root 下不要加 `--permission-mode` 也不要加 `--dangerously-skip-permissions`，會被擋**）。**用完整 model id，不要用 `--model opus` alias**——alias 會解析成當前最新 Opus（現在是 4.8），吃不到 writer pin（理由見下面〈CCC 怎麼 pin 到指定 Opus 版本〉）。review / eval / tribunal judges 仍走 Codex GPT-5.5；只有沒有 `codex` 的 CCC fallback 才用 Claude。
3. tribunal 改用本 playbook「Tribunal 必跑規則」那段的 4 個 judge role 平行跑（Vibe 用 exact-pin `claude -p`，其餘浮動 judge 用 `Agent`）

**GP writer 在 Mac pipeline 鎖某一代 Opus**（id 的 SSOT = `claude.go` 的 `ClaudeOpusPinned`，與 `tribunal-writer` agent frontmatter 同代），不再走浮動 `opus` alias——寫作 voice 對 Opus 版本敏感，Anthropic 一升 alias 就可能改掉 LHY persona，所以釘死版本。要打 `--model` 前先去那個 SSOT 讀當下的 id，不要照抄這段散文。pipeline 仍會從 Claude Code JSON metadata 讀回實際 model 寫進 frontmatter。Fact Checker fallback judge 跟 doctor probe 才繼續用浮動 `opus` alias（追最新）。

### 模型路由（Mac writer + Codex judges）

2026-06-13 更新：Claude 在 VM/CCC 上不作為主要 runtime；VM 是 Codex GPT-5.5 的地盤。

> **🧭 SSOT 提醒（見 `docs/agent-discipline.md`〈SSOT 紀律〉）**：每個 agent 用哪個 model，**值的 SSOT 是各 agent 的 `model:` frontmatter**（`.claude/agents/*.md`）；Mac GP writer 是 `tools/gp-pipeline/internal/llm/claude.go` 的 `ClaudeOpusPinned`。**下面這張表只描述 policy（哪一類 pin、哪一類浮動、為什麼），刻意不複述版本號**——版本號一旦抄進這裡就會 drift（2026-06-18 fresh-eyes / librarian 連踩兩次就是因為表裡寫死了 4-7）。要知道某 agent 現在實際跑哪版 → 去讀它的 frontmatter，不要相信任何散文裡的版本數字。

分工 policy（**按類別，不按版本號**）：

- **Voice / taste-sensitive（GP writer / refine / rewriter、Vibe Scorer）→ pin 到固定 Opus 世代**。理由：寫作 voice 跟評分 taste 對 Opus 版本敏感，Anthropic 一升浮動 alias 就可能改掉 LHY persona / 評分基準，所以釘死世代、讓 writer 跟 vibe scorer 共用同一代以對齊 taste。實際版本 = 各自 frontmatter / `ClaudeOpusPinned`（**SSOT**）。
- **非-voice judge（Fact Checker / Librarian / Fresh Eyes）→ 浮動 `opus` alias（追最新），刻意不 pin**。理由：fact-check / glossary / 陌生讀者視角要的是**最新 reasoning + diversity**，不是跟 writer taste 對齊；fresh-eyes 用跟 writer 不同代的 model 反而能抓同代看不到的盲點。CCC 用 `Agent(subagent_type:"…")` 直接跑即可（`opus` alias 本來就解析成最新，不需要 `claude -p` pin）。
- **Codex judges（eval / review / tribunal on VM）→ `codex exec --model gpt-5.5`**，完整版不走 mini。
- **Tribunal Writer legacy agent**（`.claude/agents/tribunal-writer.md`）→ 跟 writer 同類（pin），只當 legacy / fallback calibration，不是 active runtime selector。

改某 agent 的 model = 改它的 frontmatter（SSOT）；改完**順手確認沒有別的 doc 又把版本號抄了一份**（這張表已經不抄了，但別處若有就一併收斂）。修 `.claude/agents` 這些 calibration 檔之前先讀 frontmatter 上方的 PIN 註解；它們不是 active Codex runtime model selection。

### CCC 怎麼 pin 到指定 Opus 版本（`claude -p` vs `Agent` tool）

**核心限制（2026-06-18 兩次 session 實測）**：CCC 的 `Agent` tool `model` 參數**只吃 alias**——`sonnet` / `opus` / `haiku` / `fable`——**沒有版本粒度**。`opus` alias 一律解析成「當前最新 Opus」（現在是 4.8）。所以**透過 `Agent` tool 永遠 spawn 不到 `claude-opus-4-5` 或任何指定舊版**，不管 named agent 的 frontmatter pin 寫的是什麼（named agent 在很多 CCC harness 還會 fall back 成 `general-purpose` + 繼承 parent model，pin 直接被無視，見上方 caveat）。

**⚠️ 這條完全不限 tribunal / judge——任何任務都算。** 只要 user 在對話裡明講要某個 model 版本（「用 opus 4.5 重想這段 storyline」「拿 4.5 幫我腦力激盪」），不管那是寫作、翻譯、腦力激盪、debug 還是隨手委派，**一律 `claude -p --model <user 指定的完整 id>`，不准用 `Agent` tool**。原因：`Agent(model:"opus")` 會把版本**默默降級**成當前最新 Opus、**而且不會報錯**，user 拿到的根本不是他要的版本——這是最難事後察覺的失誤。本 repo 2026-06-20 session 就實際踩過：user 明講要 opus 4.5 重寫一段 storyline，CCC 卻用 `Agent(model:"opus")` 跑成 4.8，產出看起來沒問題、但版本是錯的。

**要 pin 到指定版本，唯一可靠路徑 = `claude -p --model <完整-id>` subprocess**：

```bash
# ✅ 能 pin：完整 id，真的跑在 4.5
claude -p --model claude-opus-4-5 --allowed-tools "Read,Grep,Glob,Bash,Write,Edit" < /tmp/prompt.txt

# ❌ pin 不到：alias 解析成最新（4.8），吃不到 4.5 pin
#   Agent(model:"opus")  或  claude -p --model opus
```

注意：CLI 只認**短 alias**（`opus`/`sonnet`/`haiku`）或**完整 id**（`claude-opus-4-5`）；`opus-4-5` / `opus-4.5` 這種半截寫法一律被拒。

**什麼時候必須走 `claude -p`（版本敏感的角色）vs `Agent` tool 就夠（版本不敏感）**：

> 下表的 `<id>` = 該 agent `model:` frontmatter 裡寫的那個 id（**SSOT**，見上面 SSOT 提醒）。要打 `--model` 之前**先去 frontmatter 讀當下的 id**，不要憑記憶打——pin 的世代日後可能變，但「讀 frontmatter」這條不變。snapshot：寫這段時 pinned 世代是 `claude-opus-4-5`。

| 角色 | model 來源（SSOT） | CCC 怎麼跑 |
|---|---|---|
| **GP writer / rewriter** | pin（`ClaudeOpusPinned` / writer agent frontmatter） | **必須 `claude -p --model <id>`**。寫作/改寫 voice 一漂就毀 LHY persona，pin 不能漏 |
| **Vibe Scorer** | pin（`vibe-opus-scorer.md` frontmatter，與 writer 同代） | **必須 `claude -p --model <id>`** 才對得上 writer 的 taste 校準 |
| **Fact Checker** | 浮動 `opus` alias（追最新） | `Agent(subagent_type:"fact-checker")` 直接用就好，本來就要最新 |
| **Fresh Eyes** | 浮動 `opus` alias（**刻意不 pin**，要 diversity 不要 taste 對齊） | `Agent(subagent_type:"fresh-eyes")` 直接用就好，跟 Fact Checker 同路 |
| **Librarian** | 浮動 `opus` alias（**不 pin**） | `Agent(subagent_type:"librarian")` 直接用就好，跟 Fact Checker / Fresh Eyes 同路 |
| **User 指定版本的任意任務**（ad-hoc，**不限 tribunal**） | user 對話當次明講的 id | **必須 `claude -p --model <user 講的完整 id>`**。Agent tool 會默默降級成最新 Opus、不報錯 |

**規則一句話**：**版本要 pin（writer / rewriter / vibe，或 user 當次明講任何任務要用某版——不限 judge/tribunal）→ `claude -p --model <完整 id>`；版本不在乎 → `Agent` tool 省事**。不要無腦把所有東西都改成 `claude -p`（fact-check / 一般 tribunal 用 `Agent` tool 更省 token、也不會踩 stream idle timeout）。

**`claude -p` 跑長生成的雷**：write / rewrite 這種 long creative generation 會踩 stream idle timeout（見〈Stream idle timeout 應對〉）。對策：prompt 走 stdin、輸出用 `<<<MDX_START>>>…<<<MDX_END>>>` sentinel 包住再 `awk` 抽出、judge 一律 `--allowed-tools` 顯式 allowlist（root 下 `bypassPermissions` 會被拒）。

**provenance 鐵則**：走 `claude -p` 手動 pin 的路徑**繞過了 pipeline 自動回填 model metadata 那層**，所以 `translatedBy.model` / `pipeline[].role.model` / `scores.*.model` 要**手動填實際用到的版本**（rewrite 就加一個 `Rewriter: Opus 4.5` role），同一筆 edit 補上、不能漏——frontmatter 標錯 model = 砸 gu-log「provenance 攤在陽光下」的招牌（見 `docs/shroomdog-editorial-feedback.md` 2026-06-18 GP-235 那條）。

## 文章寫作 SOP（省 token 版）

### 🔴 鐵則：文章 prose 不准在 CCC session model 自己生 / 自己評，必須委派 pinned agent

CCC session 跑在它當下的 default model 上（**會浮動**，現在是 Opus 4.8）。但 gu-log 的 writer / rewriter / vibe-scorer 是 **owner-pin 在某一代 Opus**（ShroomDog 2026-06-18 sign-off：writer、rewriter、vibe-scorer 全鎖同一代 Opus，讓「生成」和「評分」共用一致 taste）。所以只要 CCC 要產出或評分 **gu-log 文章 prose（SD / GP / MP / Lv 這種 reader-facing 內容，含手寫對照文）**：

- **寫 / 改寫 → 使用 `tribunal-writer` 的 role prompt 與規則**（GP / rewrite voice），以 `claude -p --model <frontmatter 的完整 id>` 啟動。
- **Vibe 評分 → 使用 `vibe-opus-scorer` 的 role prompt 與規則**（grader），同樣以 `claude -p --model <frontmatter 的完整 id>` 啟動。
- model pin = 這兩個 agent 的 `model:` frontmatter（**SSOT，不在這裡複述版本號**；owner sign-off 寫在 frontmatter 上方的 `# PINNED:` 註解）。CCC 的 `Agent` tool 只保證 alias 粒度，不能拿來實作 exact-version pin；版本敏感角色一律先讀 frontmatter，再走上節唯一規定的 `claude -p` 路徑。

**為什麼不准自己寫**：CCC 在 4.8 session 手寫一篇 GP 再自己蓋分數 = 「4.8 寫、4.5 評」，把 owner 要的單一 taste loop 打破（4.8 的寫作 voice 跟 vibe 校準都不是 owner 認可的那一代——見 `docs/shroomdog-editorial-feedback.md` 2026-06-18 GP-235：4.8 寫的被 ShroomDog 點名「有股怪味」、改用 pinned 代重寫才過）。**手寫+手評是 anti-pattern，2026-06 已踩過一次。**

**provenance**：`scores.*.model` 和 `translatedBy.model` 要記**實際做那一步的 model**（被委派 agent 的 pin），**不是 CCC session model**。CCC session 只做機械編排 → 在 `pipeline[]` 記一個 `Orchestrated` role 即可。

**不適用（這些機械工作 CCC session model 自己做就好）**：frontmatter 編輯、validate-posts、晶晶體修正、檔案搬移 / cat 合併、commit / push、開 PR、盯 CI。**只有「生 reader-facing prose」和「打 vibe 分數」這兩件事必須委派**。

**核心原則：先寫好 zh-tw，通過 tribunal 後才翻 en。不要兩個版本同時寫、同時改。**

原因很簡單：tribunal 回來的修改意見要 iterate，如果兩版都寫了，每輪 rewrite 要改兩份，token 花費直接翻倍。zh-tw 是主版本，en 是衍生翻譯，先把主版本品質打到及格再翻。

**晶晶體防線**：zh-tw 文章禁止裝飾性中英夾雜。API、CLI、MCP、model 名、產品名等技術專有名詞保留英文 OK，但「這個 approach 很 solid」「deliver 一個 production-ready 的 output」這種寫法一律改成自然中文。Tribunal 的 vibe scorer 會對晶晶體扣 vibe（-4）；clarity 軸（含晶晶體影響）v9 起由 Fresh Eyes 評（非補償硬門檻），v8 以下才在 vibe 底下。

**🔧 查晶晶體（跟所有 deterministic 檢查）一律跑 script / grep，不要 Read 整篇文章用人眼挑英文**。`node scripts/check-jingjing.mjs` 本身就是 ripgrep-based 掃描器，會把每個違規詞、行號、上下文一次列出來；pronoun 檢查、frontmatter 驗證同理（`check-pronoun-clarity.mjs`、`validate-posts.mjs`）。為了「確認有沒有英文詞」去 `Read` 一整個 .mdx 是純浪費 token——deterministic 規則交給 deterministic 工具，Read 只留給需要理解語意/語氣的時候（例如自己重讀文章判斷 vibe）。同理，要找某個詞出現在哪，用 `Grep` 不要 `Read` 全檔。

### 流程

```
Step 1: 寫 zh-tw 版
  - 建立 MDX，填 frontmatter，寫正文
  - MoguNote / ShroomDogNote 都在這步完成
  - validate-posts.mjs 確認格式

Step 2: Tribunal review（spawn subagent；model 見各 agent frontmatter，不在這列版本號）
  - Vibe Scorer：四維評分（v9；clarity 移到 Fresh Eyes）
  - Fact Checker：技術準確度
  - Librarian：glossary / cross-ref
  - Fresh Eyes：陌生讀者第一印象
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

這個失敗模式**只在 CCC 沙箱觀察到**（2026-04-21 session 首度記錄）。Local machine actor 從沒遇過，可以跳過這段。

**Trigger**：user 回報 `Error happened, resume` / `still error` / `retry` / `continue`，或 API 自己報 `Stream idle timeout - partial response received`。

**Workaround A — `/tmp` chunks + `cat`**（2026-04-21 實測最穩，預設走這條）：

**這是目前最可靠的一招。第一次 retry / resume / continue 且前一個失敗動作是 Write/Edit，立刻切這條**——不要再 retry 任何 long Write/Edit，改走這條。

```bash
# 1. Write 每個 section 到 /tmp/<slug>/NN-xxx.mdx，每個檔案只含一個段落或一個 MoguNote
Write /tmp/sd20/01-frontmatter.mdx   # frontmatter
Write /tmp/sd20/02-intro.mdx         # intro + 第一個 MoguNote
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

- **預防性 trigger**（根本不用等 error）：看到自己要寫的 MDX **≥150 行** 或**含 3 個以上 MoguNote** 或**含 frontmatter + 多段 prose + code blocks 混排**——**開寫前就直接切 `/tmp` chunks**，不要先賭一次 big Write 看運氣。
- 反向防呆：如果已經在 `/tmp` chunks 模式還報 error，**chunks 再切小**（每檔 ≤50 行），不是切回 big Write。
- 舊 trigger 仍然保留（保險起見）：user 回報 `error` / `retry` / `resume` / `proceed` / `continue` / `still error`，且**上一個想做但失敗的動作是 Write/Edit/NotebookEdit**——立刻切 Workaround A。

**Root cause 備忘**（2026-04-21 實驗結論）：
疑似 Opus 4.7 adaptive thinking 在長 creative generation 中有短暫 token 停頓。停頓 > stream idle threshold 就斷線。跟**生成時間分佈**有關，不是**字符內容**問題 — kaomoji / RTL Arabic / multi-script 都 isolated 測過無關。

## 開場 SOP

每次被叫醒第一件事：

```bash
./scripts/detect-env.sh --runtime claude-code  # 確認自己是 CCC
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

- **同步補**（快、且開工前就需要）：deps（`pnpm install`）、git hooks（`setup-hooks`）、gp-pipeline 自編譯。放 `--fix` 區塊直接跑完，smoke test 順便驗。
- **非同步背景補**（慢、下載大、不是開工就馬上要）：Playwright chromium binary（~100MB，uiux-auditor / playwright-cli / verify 才要）。`--fix` 用 `nohup … & disown` 丟背景，**不擋 session 開場**，等真的要截圖時通常已下載好。Smoke test 另開一個 optional readiness check（warn 不擋 exit）回報「裝好了 / 還在下載 / 沒裝」，讓 agent 知道現在能不能截圖。

  Playwright 就是這個模式的範本（2026-06-12 加）：`ccc-smoke-test.sh --fix` 在 `CLAUDE_CODE_REMOTE=true` 時，偵測 `${PLAYWRIGHT_BROWSERS_PATH:-~/.cache/ms-playwright}` 沒有 chromium 快取就背景下載，idempotent（已裝或已在下載就跳過），只在 CCC 跑（local machine actor 自己管 local Playwright）。所以「Playwright 沒裝」這個 friction 對之後的 CCC 不該再發生——醒來時背景已經在補了。

**鐵則：撞到新的 recurring env friction → 在同一個 PR 把它收進 hook，當場消滅，別只修這次。** 這跟 `docs/agent-discipline.md`「主任務踩到的 bug 順手修在同一個 PR」是同一條精神，只是套用在環境層：hook 是 CCC fresh-env friction 的 SSOT，能進 hook 的就別留在 per-session 手動步驟。

## 不確定時找誰

- **技術決策不確定**：用 `AskUserQuestion` 問 user，但要先把問題想清楚、給選項
- **內容風格不確定**：讀 `GU-LOG_WRITER_PROMPT.md` + `CONTRIBUTING.md`，或 spawn `vibe-scorer` subagent 打分
- **架構不確定**：spawn `Plan` subagent 規劃再動手
