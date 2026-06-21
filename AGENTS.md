# gu-log

> AI/Tech 翻譯 + 原創 blog。把英文好文翻成繁中（SP/CP），ShroomDog 自己的原創文（SD），入門教學（Lv）。附 Clawd 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

> **這份是 Tier-0：always-loaded 的憲法 + bootstrap + 路由表，所有 agent（Codex、Claude Code、Clawd…）共讀的中性 SSOT。** 細節規則住在 Tier-1 playbook（按身份）和 Tier-2 文件（按主題），本檔只留「永遠要記得的硬規則」+「該去哪讀全文」。Claude Code 專屬的工具細節在 `CLAUDE.md`。

## 🪪 開場第一件事：先確認自己是誰，再讀對應 playbook（Tier 1）

**任何 coding-agent instance 進到這個 repo，第一件事必須跑 `./scripts/detect-env.sh` 確認自己的身份**，再讀對應的 playbook：

| Instance | 跑在哪 | Playbook |
|---|---|---|
| **mac-cdx / mac-CC** (Local Codex / Claude Code) | user 個人 Mac，互動式 iterate | [`playbooks/mac-CC-playbook.md`](playbooks/mac-CC-playbook.md) |
| **CCC** (Cloud Codex / Cloud Claude Code) | 網頁版，Linux sandbox，auto-branch | [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) |

沒搞清楚身份就動手 = 用錯 SOP（各 env 的 scope ceiling、merge policy、失敗處理都不一樣）。沒有例外，不能跳。Playbook 各自是 SSOT，定義各自的精神、scope ceiling、失敗處理、merge policy、品質 gate。**不要在這個檔案重複那些規則**，有要加規則就去編對應的 playbook 檔。

共通原則（兩邊都不能跳）：

- Commit 內部維持 atomic，一個 commit 做一件事，revert 時才好下刀
- 品質 gate 全部保留：`pre-commit` / `pre-push` hook、`validate-posts.mjs`、tribunal 一個都不能關
- 遇到 prod 炸了或 main CI broken → 緊急事件沒有 scope 之分，看到立刻修
- **在 feature branch 上工作時，完成後必須自己開 PR（或 draft PR）+ 盯 CI**。不要把「開 PR」和「等 CI」留給 human——那是 agent 的工作，不是人的。唯一例外：需要 human 做決策的時候（例如不確定該不該 merge、scope 有爭議），先問再開。開 PR / 追 CI 的確切工具因 runtime 而異（Claude Code 用 GitHub MCP，見 `CLAUDE.md`；Codex 用 `gh` CLI）。
- **gu-log 任務的完成定義是 production URL**：寫文、修文、發文、跑 pipeline、補品質 gate、處理 gu-log 內容時，不要停在草稿、MDX、PR、CI 綠燈、Vercel preview，或「等 human 下一步」。預設一路做到 merge、Vercel production deploy、production smoke test，最後回報可點的 production URL。只有真的需要 human 做關鍵內容 / 產品方向決策時才停下來問；repo hygiene、EN 同步、branch/PR/CI/Vercel 問題都屬於 agent 自己修到好。

## 🗣️ 回覆語言：一律繁體中文（zh-tw）

**不管 user 用什麼語言問你（英文、簡中、日文、混雜），回覆 user 的文字一律用繁體中文。** 這是絕對規則，沒有例外：

- 聊天訊息、說明、總結、錯誤回報、問問題 → **繁中**
- commit message、PR title/description → 照 repo 既有語言慣例（多數是繁中，少數英文技術 commit 也 OK）
- code comments、變數名、文件內容 → 照該檔案原本的語言
- 翻譯任務的輸出 → 照任務指定（SP/CP 的 zh-tw 版當然是繁中，en 版當然是英文）

就算 user 用英文問，也要用繁中回。就算 user 只說「ok」，也要用繁中回。如果發現自己在用英文跟 user 對話，立刻切回繁中——這不是偏好，是硬規則。用字請用台灣慣用語（例如「軟體」不是「软件」、「程式」不是「程序」、「登入」不是「登录」），技術名詞可以保留英文（commit、PR、hook、API 這些不用硬翻）。語氣跟 `GU-LOG_WRITER_PROMPT.md` 一致：直接、有梗、不要官腔。

> repo 內所有 `.md` prose 也預設寫繁中（含 OpenSpec / design docs / tasks / runbook）。完整規則見 `CONTRIBUTING.md`〈📝 Markdown 文件語言：預設繁中〉。

## 🚫 絕對不准 `--no-verify`（hook 失敗 = 修 hook 或修 code，不准跳）

任何 agent instance 在這個 repo 內**永遠不准用** `git commit --no-verify`、`git push --no-verify`、`git commit --no-gpg-sign`、`git rebase --no-verify`、或任何其他繞過 pre-commit / pre-push hook 的旗標。**沒有例外，沒有「這次只是…」**。

**遇到 hook 失敗時，只有兩條路**：

1. **Hook 邏輯擋對了，是 code 有問題** → 修 code 直到 hook 過。譬如：
   - 晶晶體 lint 抓到英文詞 → 翻成中文，或加進 `glossary.json` / `ALLOWLIST_RAW`
   - score gate 說缺 `scores.vibe` → 跑 vibe-scorer 拿分數塞進去（用修好的 `scripts/vibe-scorer.sh`）
   - validate-posts.mjs 報 frontmatter 錯 → 修 frontmatter
   - 內容測試（content-integrity.spec.ts）紅 → 修文章 / 連結 / ticketId

2. **Hook 自己壞了，是環境或 hook 邏輯問題** → 修 hook（或補環境），把根因處理掉。譬如：
   - Playwright browser 沒裝 → `npx playwright install chromium`，下次自動過
   - Hook script 有 bug → 修 hook script
   - Hook 預設 path 在某 env 不存在 → 把 path resolve 改成跨 env 都 work
   - 修完 hook 自己變成這個 PR 的一個 atomic commit

**為什麼這條這麼硬**：

- `--no-verify` 是「這次先過、之後再說」的偷懶開關。在副業 repo 沒有 review queue 的情況下，「之後」基本不會發生——bug 就這樣 ship 出去
- 多數 hook 失敗都是真實品質問題，不是環境問題。即使是環境問題，也應該修環境，否則下個 session 重複踩
- CI（`.github/workflows/ci.yml`）會 PR 上重跑大部分 hook 檢查（lint / type / validate / jingjing / security / build / links）——`--no-verify` 偷過 commit 也會在 PR open 後被擋，多繞一圈而已
- 唯一例外是 user **明確逐次授權**（「這次先 --no-verify 我來看」）。Default = 拒絕，當 user 沒下這指令就絕對不用

**反例**：
- ❌ Pre-commit score gate 擋了 → 用 `--no-verify` 跳過、寫進 commit message 當 "known issue"，留給 follow-up
- ❌ Pre-commit playwright test 紅、是 browser 沒裝 → 用 `--no-verify` 跳過（正確：`npx playwright install chromium` 修環境）
- ✅ Pre-commit jingjing 擋了 → 翻譯掉英文詞 / 加 ALLOWLIST_RAW / 加 glossary，重新 commit
- ✅ Pre-commit 用了過時的 hook script → 修 hook script、commit fix、再 commit 主任務

## 🧭 SSOT 紀律（摘要 — 全文見 `docs/agent-discipline.md`）

**每個事實只有一個家（SSOT）。動到有 SSOT 的東西時，預設責任是「維持單一真相來源」——不複製事實、發現 drift 當場收斂。** 權威端 = code（含 frontmatter、常數、config、Zod schema）或 openspec spec，**不是散文文件**；playbook / README / 這份 AGENTS.md / 註解 / task prompt 都是 derived view，對不上時散文服從 code/openspec。能判斷哪邊對就自己收 + 回報帶一句，只有「難判斷又是重要決定」才用 `AskUserQuestion` 問。完整四條操作規則、收斂自主姿態、為什麼用 prompt 而非只靠 lint → 見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 📐 寫 prompt / 規則：抓耐久原則（摘要 — 全文見 `docs/agent-discipline.md`）

verbose 散文比抽象規則 drift 得多。抄自真 SSOT 的具體值（event 名、套件名、計數、路徑、版本號）一律**指回 code / YAML**，散文只講 policy / 為什麼。審查用 Keep / Simplify / Drop，目標是少而通用、不易過期。全文見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 🛠️ 順手修 friction + 完全自主（摘要 — 全文見 `docs/agent-discipline.md`）

個人副業 repo，**velocity > stability**。任務過程撞到的所有 friction（環境、hook、lint、驗證器、frontmatter、過時文件）**通通是當前 agent 的責任，當場用 atomic commit 修掉，放進同一個 PR**——不甩給下一個 session、不回頭問 user「要不要順便修」。**最高原則：每個 agent 完全自主，CI 綠 + 改動 safe + 非 critical → 直接 merge，不為了確認而問。** 完整反例、例外（何時可拆 PR）、atomic commit 紀律 → 見 [`docs/agent-discipline.md`](docs/agent-discipline.md)。

## 🏷️ Branch name 是 ID，不是語意

**這個 repo 的 feature branch 名稱是由不知道 gu-log 上下文的 LLM 自動生成的**（例如 `claude/add-twitter-link-6xTNr`），**完全不能拿來當任務語意的線索**。Branch name = 不透明的 identifier，僅用來區分 working tree，**絕對不要從 branch name 推斷 user 想做什麼**。任務意圖永遠以對話內容為準。

## 🔀 Branch policy（2026-04-22 起：預設 feature branch + PR）

這個 repo 目前只有 user + 幾個 agent 在跑，但仍然用 feature branch + PR 流程——理由是 PR 提供清楚的 review surface、讓 Vercel preview 在 merge 前先跑一次、revert 時不會沾到其他 commit。

- **預設流程**：
  1. 任何「一個 task = 一組相關 commit」的工作 → 在 `main` 拉一條 branch（命名慣例：`<type>/<scope>-<short-desc>` 例如 `fix/tribunal-badge`、`rewrite/sp-175`、`chore/scorer-pin-4-6`）
  2. 在 branch 上 commit，完成後自己 push + 開 PR（或 `--draft` 如果還要 iterate）
  3. 盯 CI 結果，綠了就 merge（solo repo 可自己 merge，不用等人）
  4. Merge 完 `git checkout main && git pull && git branch -d <branch>`
- **Tribunal / 自動化 pipeline 也走 branch + PR**：`tribunal-batch-runner.sh` 每篇 post 可以開自己的 branch + draft PR，方便個別 review / revert。
- **直推 main 的例外（不用 branch）**：
  - Prod 炸了或 main CI broken 的緊急修復（爭取時間）
  - 純設定檔 / doc typo（完全沒 code logic 風險）
  - User 明講「直接推 main」
- **Commit discipline**：一個 commit 做一件事，PR 內部 commit 可以多，但每個 commit 獨立 revert 時仍要站得住。別把無關改動塞同一個 commit。
- **PR size discipline**：gu-log PR 不需要為了「讓 human reviewer 逐行看」刻意切小。這個 repo 的 PR review 主要由 agent 執行，human 通常看結論、risk surface、CI、evidence，而不是 line-by-line courtesy review。重點是 OpenSpec / tests / evidence / revertability 清楚；PR 大小本身不是問題。

## 🧭 主題路由表（要做某件事 → 先讀這份）

| 要做的事 | 先讀哪份文件 |
|---|---|
| **寫 / 翻譯文章（SP/CP/SD/Lv）、ticketId SOP、防重複、frontmatter schema、source evaluation、事實查核** | [`CONTRIBUTING.md`](CONTRIBUTING.md)（內容規則 SSOT） |
| **寫作風格（PTT 說故事風、Clawd 吐槽語氣、persona、術語處理、翻譯誠實性、MP/GP 翻譯鐵則、Sentence Signal、Style Guide）** | [`GU-LOG_WRITER_PROMPT.md`](GU-LOG_WRITER_PROMPT.md)（寫作風格 SSOT） |
| **品質門檻（兩層 floor/PASS gate）** | [`CONTRIBUTING.md`](CONTRIBUTING.md)〈🎯 兩層品質門檻〉 |
| **Tribunal（4-judge 評審、跑法、daemon、worker worktree）** | [`docs/tribunal-runbook.md`](docs/tribunal-runbook.md) |
| **SP 自動翻譯 pipeline（`gp-pipeline` 用法、subcommand、exit code）** | [`tools/sp-pipeline/SKILL.md`](tools/sp-pipeline/SKILL.md) |
| **User 丟 URL → 預設寫 SP**（pipeline 用法 + 何時手動） | [`tools/sp-pipeline/SKILL.md`](tools/sp-pipeline/SKILL.md) + 下方〈URL = SP〉 |
| **Draft 來源 / Obsidian import** | [`OBSIDIAN_SETUP.md`](OBSIDIAN_SETUP.md) |
| **Dev / Build（tech stack、architecture、指令）** | [`docs/dev-reference.md`](docs/dev-reference.md) |
| **OpenSpec spec / change** | [`openspec/`](openspec/) |
| **agent 跨領域行為規則（SSOT 紀律、verbosity-drift、順手修 friction 全文）** | [`docs/agent-discipline.md`](docs/agent-discipline.md) |
| **ShroomDog 修稿回饋 corpus** | [`docs/shroomdog-editorial-feedback.md`](docs/shroomdog-editorial-feedback.md) |

### 🔗 User 丟連結 = 要寫 SP（預設走 pipeline，不要手動寫）

**只要 user 在對話裡丟 URL 過來（X/Twitter、blog、HN、arXiv、GitHub blog 文章、docs 站…），預設意圖就是「幫我把這篇翻譯成 SP」**，不要去猜其他意思（不是要 summarise、不是要加到 about page、不是要做書籤）。

**預設動作**：`tools/sp-pipeline/gp-pipeline run <url>`。Pipeline 包辦 fetch → eval → dedup → write → review → refine → credits → ralph → deploy。除非有明確 blocker，**手寫 SP 是 anti-pattern**（浪費 token、跳過 dedup gate / 評分 / refine 迴圈）。

完整「何時才手動寫」「pipeline 用法 / flag / exit code」「抓原文 fallback（`sp-source-fetch` skill / curl）」見 [`tools/sp-pipeline/SKILL.md`](tools/sp-pipeline/SKILL.md)。

> **ShroomDog / Sprin 丟 URL 的來源路由（ChatGPT share、X、一般文章、GitHub raw）** 各 runtime 有自己的 fetch skill（Claude 見 `CLAUDE.md`；Codex 見 `.agents/skills/`）。不要用 `web_fetch` 摘要直接寫文，先抓成完整 source 再寫。

## 文件架構（誰讀什麼）

```
AGENTS.md (Tier-0，你在讀的這個 — 憲法 + bootstrap + 路由)
  │  CLAUDE.md = @AGENTS.md + Claude Code 專屬段
  │
  ├─ Tier-1（按身份）playbooks/
  │   ├ mac-CC-playbook.md     ← mac-cdx / mac-CC 的 SOP
  │   └ CCC-playbook.md        ← CCC 的 SOP（含 self-merge、收尾鐵則、tribunal 跑法、模型路由）
  │
  └─ Tier-2（按主題）
      ├ CONTRIBUTING.md          ← SSOT: 內容規則、ticketId SOP、防重複、frontmatter schema、品質門檻、source eval、事實查核
      ├ GU-LOG_WRITER_PROMPT.md    ← SSOT: 寫作風格（PTT 說故事風、Clawd 吐槽語氣、SD/SP/CP 共用）
      ├ docs/agent-discipline.md ← agent 跨領域行為規則全文（SSOT 紀律 / verbosity-drift / 順手修 friction）
      ├ docs/dev-reference.md    ← Tech Stack / Architecture / Commands
      ├ docs/tribunal-runbook.md ← Tribunal daemon / runtime ops
      ├ docs/shroomdog-editorial-feedback.md ← ShroomDog 修稿回饋 corpus
      ├ OBSIDIAN_SETUP.md        ← Draft 來源 / Obsidian import workflow
      ├ src/content/config.ts    ← SSOT: Frontmatter schema (Zod validation)
      ├ scripts/
      │   ├ article-counter.json  ← Ticket ID counter（SD/SP/CP/Lv）
      │   ├ tribunal-batch-runner.sh ← Tribunal batch runner（動態掃描 posts/，newest-first）
      │   ├ vibe-scoring-standard.md ← Vibe 評分標準 SSOT
      │   ├ tribunal-helpers.sh    ← Tribunal 共用 helper functions（score-helpers.sh / vibe-scorer.sh source 這個）
      │   ├ sp-pipeline.sh        ← Backwards-compat shim → execs tools/sp-pipeline
      │   ├ clawd-picks-prompt.md ← Clawd Picks 任務流程（給 Clawd on VM 用）
      │   ├ clawd-picks-config.json ← 推文帳號清單
      │   ├ validate-posts.mjs    ← Frontmatter + 格式驗證
      │   └ detect-model.mjs      ← Model 名稱偵測（不要猜！）
      └ tools/sp-pipeline/       ← SP 自動翻譯 pipeline (Go, canonical；目錄沿用舊名)
          ├ gp-pipeline           ← Self-compiling bash wrapper (canonical entry point)
          ├ sp-pipeline           ← Backwards-compat shim → execs gp-pipeline
          ├ cmd/sp-pipeline       ← cobra subcommands: run / fetch / eval / write /
          │                         review / refine / credits / ralph / deploy /
          │                         dedup / counter / doctor
          ├ internal/             ← prompts, pipeline State, LLM dispatcher,
          │                         frontmatter, counter, dedup, source, ralph,
          │                         deploy, runner, logx, config
          ├ README.md             ← Developer docs + migration plan
          └ SKILL.md              ← Agent-facing usage guide
```

**操作這個 repo 的 agent：**

- **mac-cdx / mac-CC / CCC**（coding agents）→ 讀本檔（Tier-0）→ `detect-env.sh` → 對應 playbook（Tier-1）→ 按主題讀 Tier-2
- **Clawd (OpenClaw)**（VPS，24/7 自動）→ 讀 `~/clawd/AGENTS.md` → 再讀 `scripts/clawd-picks-prompt.md` → 自動翻譯推文

兩條路最終都指向 `CONTRIBUTING.md` 和 `GU-LOG_WRITER_PROMPT.md` 作為 SSOT。
**改規則時只改 SSOT 來源檔，不要在 task prompt 裡重複定義。**

## Quality: Vibe Scoring + Tribunal（摘要 — 全文見 `docs/tribunal-runbook.md`）

品質管理用 4-judge tribunal（`tribunal-batch-runner.sh` 批次掃描，`tribunal-all-claude.sh` 單篇執行）。本段是 derived view；每個 judge 實際使用的 model SSOT 是 `.claude/agents/*.md` 的 `model:` frontmatter，**不在散文裡複述版本號**：

- **Vibe Scorer**: v9 起四維評分（Persona / ClawdNote / Vibe / Narrative，0-10）；clarity 已移到 Fresh Eyes（v8 以下仍是含 Clarity 的五維，版本 gating）
- **Fact Checker**: 技術準確度 / 來源忠實 / 邏輯一致
- **Librarian**: Glossary / cross-ref + identity linking / sourceAlign / attribution
- **Fresh Eyes**: 陌生讀者第一印象（3-month engineer persona）。v9 起五維：readability / firstImpression / payoffDensity / lengthFit / **clarity**（clarity 是從 Vibe 移過來的非補償硬門檻；v8 以下無 clarity）
- **Pass bar**: Vibe composite ≥ 8 AND 至少一維 ≥ 9 AND 沒有任何維 < 8，Fact ≥ 8，Librarian composite ≥ 8，Fresh Eyes composite ≥ 8 AND payoffDensity ≥ 8 AND lengthFit ≥ 8 AND（v9）clarity ≥ 8
- **Rewrite**: 沒過 → rewriter 改寫 → 再跑 → 最多 3 次
- Agents 在 `.claude/agents/`；judge model SSOT 是各 agent 的 `model:` frontmatter，評分標準 SSOT 在 `scripts/vibe-scoring-standard.md`

兩層品質門檻（floor ≥3 才能 ship、PASS ≥8 才上首頁）見 [`CONTRIBUTING.md`](CONTRIBUTING.md)〈🎯 兩層品質門檻〉。Daemon 行為、graceful stop、2-worker 平行化、worker worktree 管理全部在 [`docs/tribunal-runbook.md`](docs/tribunal-runbook.md)——碰 tribunal 自動化之前先讀，特別是 worker worktree 不會跟著 main 自動更新這個雷（用 `scripts/tribunal-worker-bootstrap.sh sync` 手動刷）。
