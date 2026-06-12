# gu-log

> AI/Tech 翻譯 + 原創 blog。把英文好文翻成繁中（SP/CP），ShroomDog 自己的原創文（SD），入門教學（Lv）。附 Clawd 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

## ⚠️ 必讀

### 🗣️ 回覆語言：一律繁體中文（zh-tw）

**不管 user 用什麼語言問你（英文、簡中、日文、混雜），你回覆 user 的文字一律用繁體中文。** 這是絕對規則，沒有例外：

- 聊天訊息、說明、總結、錯誤回報、問問題 → **繁中**
- commit message、PR title/description → 照 repo 既有語言慣例（多數是繁中，少數英文技術 commit 也 OK）
- code comments、變數名、文件內容 → 照該檔案原本的語言
- 翻譯任務的輸出 → 照任務指定（SP/CP 的 zh-tw 版當然是繁中，en 版當然是英文）

就算 user 用英文問，也要用繁中回。就算 user 只說「ok」，也要用繁中回。如果你發現自己在用英文跟 user 對話，立刻切回繁中——這不是偏好，是硬規則。

用字請用台灣慣用語（例如「軟體」不是「软件」、「程式」不是「程序」、「登入」不是「登录」），技術名詞可以保留英文（commit、PR、hook、API 這些不用硬翻）。語氣跟 `GU-LOG_WRITER_PROMPT.md` 一致：直接、有梗、不要官腔。

### 📝 Markdown 文件語言：預設繁中

除非 user 明確要求英文，repo 內所有 `.md` prose 都預設寫成繁體中文，包含 OpenSpec artifacts、design docs、tasks、runbook、README 類文件。user 會等真的有英文讀者 / i18n 需求時再做英文版，現在不要搶先翻英文。

保留必要 English technical terms、檔名、路徑、指令、config key、model ID、permission label、exact UI label，以及 spec reserved words（例如 MUST、SHALL、SHOULD、MAY、NOT、Requirement、Scenario、GIVEN、WHEN、THEN、AND）。不要為了翻譯而把 `git`、`API`、`CLI`、`branch protection`、`auto-merge` 這類術語翻得很彆扭。

**術語決策規則**：如果中文譯法讀起來像硬翻論文腔（例：「擴展測試時運算」），不要直接送出。三選一：保留 canonical English term 並補 glossary、改成自然中文解釋、或標成 terminology decision 交給 ShroomDog / Librarian 判斷。這類問題不是小潤稿，是 gu-log 長期詞彙風格的一部分。

**晶晶體 accepted-English boundary**：`scripts/check-jingjing.mjs` / `src/data/glossary.json` 負責 deterministic enforcement，但可接受 English terms 的新增或移除 SHALL 每次都先與 ShroomDog 討論。這會直接影響閱讀流與語感，不能由 agent 自行擴張或收縮 allowlist。

**新增或編輯文章前，先讀 `CONTRIBUTING.md`。** 它是所有內容規則的 SSOT（Single Source of Truth）。

**ShroomDog / Sprin 丟 URL → 先讀 `.agents/skills/shroomdog-url-fetch/SKILL.md`。** 這是常見來源路由表：ChatGPT share、X/Twitter、一般文章、GitHub raw 等都先抓成完整 source，再寫文、改 glossary 或做評估。ChatGPT share URL 特別要再讀 `.agents/skills/chatgpt-share-fetch/SKILL.md`；不要用 `web_fetch` 摘要直接寫文，先跑 `scripts/fetch-chatgpt-share.mjs` 把完整 transcript 存到 `sources/chatgpt/...`，再把該 source file 當成寫作依據。

**ShroomDog editorial feedback 一律進 corpus。** 如果 ShroomDog / Sprin 對 gu-log 文章提出用字、敘事、事實查核、語氣、讀者困惑點等回饋，立刻 append 到 `docs/shroomdog-editorial-feedback.md`。不要只存在聊天紀錄、個人 memory、未追蹤 scratch file，或某個 agent 的私人筆記。這份檔案是之後蒸餾進 GU-LOG_WRITER_PROMPT.md 的原始訓練資料，讓 GPT-5.5 / Codex / Claude Code / Iris 共用同一份 gu-log writer prompt。

### ✂️ Sentence Signal Rule：每句都要有資訊量或鉤子

gu-log 不是把 source 重新包成報告。每一句正文都至少要有一個功能：

- **Informative**：提供新資訊、判斷、脈絡、因果、例子、定義、風險或取捨。
- **Intriguing**：製造好奇、張力、反直覺、笑點、畫面感、問題意識或下一段想讀下去的理由。

最佳句子兩者都有；最差也至少中一個。兩者都沒有的句子（例如「原作者這篇分析文講了一個很值得拆的現象」這種 source metadata 重複 / throat-clearing）必須刪掉或改寫。

**開頭尤其嚴格**：讀者已經在頁面上看到原文出處 / sourceUrl，第一句不要重複說「原作者這篇」。直接從事件、張力、反直覺觀點或有趣比喻開始。

**SP body source boundary**：SP 讀者已經看得到 `原文出處：`，所以正文不要用「原作者說 / 原文提到 / 這篇文章在講」這類 source-meta scaffolding。必要 evidence boundary 要寫成推動敘事的 context，不要寫成「不是公開 benchmark」「僅供參考」「不是保證所有人都能做到」這種防呆式免責句。低風險 case-study 數字優先自然交代情境，例如「這是 Cursor 自家網站的一次遷移帳單」；只有 benchmark、投資、醫療、安全、公司營收、法律或讀者可能依數字做現實決策的 claim，才需要硬 caveat。如果要評論 source 本身或加入 Clawd/gu-log opinion，放進 `<ClawdNote>`。

### 🔗 SP candidate / source evaluation：先判斷「寫什麼」和「不要寫什麼」

ShroomDog 丟外部連結時，先判斷它能不能做成 gu-log；Go 之前一定要先做 overlap evaluation，明確列出：

1. **這次的新東西是什麼**：source 有哪些 gu-log 還沒寫過的事實、結構、平台訊號、產品變化、案例、數字、方法或觀點。
2. **哪些已經被 gu-log 寫過**：搜尋既有 SP/CP/SD/Lv、glossary、ClawdNote/ShroomDogNote，標出已覆蓋內容與對應文章。
3. **這篇應該避開什麼**：不要重講既有解釋、比喻、背景知識或結論；必要時只用一句話 recap 並內鏈舊文。
4. **最後才決定 angle**：把文章建立在新增資訊與新增 framing 上，而不是把同一套內容換皮重寫。

Duplicate content is duplicate dead code：對 AI 是 token waste，對人類是 attention waste。gu-log 的文章不是資料庫去重失敗的備份檔；每篇都要有新的資訊增量、判斷增量或敘事增量。

- **「原文已是中文 / 簡體中文分析文」不是 No-go 理由**：gu-log 的價值包含繁體中文、故事性、ClawdNote、ShroomDog/Clawd 的讀者脈絡與重新編排，不是只有翻譯語言。
- **「二手整理」不是 No-go 理由**：可以重寫、改編、整理脈絡、引用原文；只要 attribution 清楚、來源可靠、讀者價值夠，就可以寫。
- **「需要驗證數字 / 來源」不是 No-go 理由**：驗證是 agent 的工作。只有驗證後發現 facts 不可靠、無法查證、來源不完整，或支撐不了 8/8/8 publish bar，才可以 No-go。
- 正確流程：讀完整 source → 必要時查 primary sources → 搜尋 gu-log 既有覆蓋 → 判斷 narrative potential / reader value / source reliability / novelty → Go 就用 gu-log 風格重寫並 cite；No-go 要講真正原因。

這條規則的 editorial feedback 原文也記在 `docs/shroomdog-editorial-feedback.md`。未來更新 source-evaluation 類回饋時，兩邊要保持一致：`AGENTS.md` 放 general rule，editorial feedback corpus 放具體案例和 reusable lesson。

### 🔍 事實查核紀律：AI tooling 的 claim 必須 verify

gu-log 寫的就是 AI / agent / tooling 圈，這個圈子有兩個特性：
1. **變動極快**：上週的事實這週可能就過時
2. **詞彙混亂**：open source、source-available、permissive license、bundled、SDK、CLI、API 容易混為一談

所以對 AI tooling 相關的事實聲明（哪個東西是不是開源、誰收購了誰、哪個 model 何時發布、某個產品支不支援某個 feature），**不要從記憶或直覺答**。要 verify。

**特別容易踩的雷**（已踩過、不要再踩）：

- **Codex 是 closed source**，不是 open source、也不是 source-available。GitHub 的 `anthropics/Codex` repo 只有 plugins / examples / scripts，**核心 CLI 原始碼不在 repo 裡**，是 npm bundled 發布的閉源軟體。License: `© Anthropic PBC. All rights reserved.`
- **Codex Agent SDK** 是另一個專案（Python/TypeScript，MIT License），跟 Codex 不一樣，不要混為一談。
- 2026-03-31 那次 512k 行原始碼洩漏，是 npm 發布時缺 `.npmignore` 導致 source map 意外曝光，**不是**駭客入侵也**不是**官方開源。

**操作原則**：

- 寫 glossary、寫文章、跟 user 對話時，AI tooling 相關事實都要 verify
- **⚠️ `WebFetch` 會偷偷摘要，不是原文**：WebFetch 會把 HTML 丟給一個小 model 濃縮後才回傳，**常常漏掉具體 examples、數字、邊界條件**（實測 Anthropic blog 的 `create_issue_from_thread` 例子、`Cloudflare ~2,500 endpoints in ~1K tokens`、elicitation form/URL mode 區別都被摘掉）。**SP/CP 翻譯任務、引述原文、事實查核一律用 `curl -sL -A "Mozilla/5.0..." <url>` 抓原始 HTML 再解析**；WebFetch 只適合「這頁大概在講什麼」這種粗粒度判斷。翻譯基於 WebFetch 輸出 = 基於二手摘要，必踩雷。
- **Subagent 的事實結論要自己驗證一次**：subagent 也會用聽起來合理但錯的詞（例如把 closed source 說成 source-available）。看到關鍵 claim 就 fetch 一次原始碼或 license 確認
- 完整時間線參考 `src/data/glossary.json` 的 Codex 條目

## 文件架構（誰讀什麼）

```
AGENTS.md (你在讀的這個)
  ├→ CONTRIBUTING.md          ← SSOT: 內容規則、ticketId SOP、防重複、frontmatter schema
  ├→ GU-LOG_WRITER_PROMPT.md    ← SSOT: 寫作風格（PTT 說故事風、Clawd 吐槽語氣、SD/SP/CP 共用）
  ├→ docs/shroomdog-editorial-feedback.md ← ShroomDog 修稿回饋 corpus（之後蒸餾進 GU-LOG_WRITER_PROMPT.md）
  ├→ src/content/config.ts    ← SSOT: Frontmatter schema (Zod validation)
  ├→ scripts/
  │   ├ article-counter.json  ← Ticket ID counter（SD/SP/CP/Lv）
  │   ├ tribunal-batch-runner.sh ← Tribunal batch runner（動態掃描 posts/，newest-first）
  │   ├ vibe-scoring-standard.md ← Vibe 評分標準 SSOT
  │   ├ tribunal-helpers.sh    ← Tribunal 共用 helper functions（score-helpers.sh / vibe-scorer.sh source 這個）
  │   ├ sp-pipeline.sh        ← Backwards-compat shim → execs tools/sp-pipeline
  │   ├ clawd-picks-prompt.md ← Clawd Picks 任務流程（給 Clawd on VM 用）
  │   ├ clawd-picks-config.json ← 推文帳號清單
  │   ├ validate-posts.mjs    ← Frontmatter + 格式驗證
  │   └ detect-model.mjs      ← Model 名稱偵測（不要猜！）
  └→ tools/sp-pipeline/       ← SP 自動翻譯 pipeline (Go, canonical)
      ├ gp-pipeline           ← Self-compiling bash wrapper (entry point)
      ├ cmd/sp-pipeline       ← cobra subcommands: run / fetch / eval / write /
      │                         review / refine / credits / ralph / deploy /
      │                         dedup / counter / doctor
      ├ internal/             ← prompts, pipeline State, LLM dispatcher,
      │                         frontmatter, counter, dedup, source, ralph,
      │                         deploy, runner, logx, config
      ├ README.md             ← Developer docs + migration plan
      └ SKILL.md              ← Agent-facing usage guide
```

**兩個 AI 操作這個 repo：**

- **Codex**（Mac，手動互動）→ 讀 `AGENTS.md`（這個檔案）→ 開發、debug、SOP 調整
- **Clawd (OpenClaw)**（VPS，24/7 自動）→ 讀 `~/clawd/AGENTS.md` → 再讀 `scripts/clawd-picks-prompt.md` → 自動翻譯推文

兩條路最終都指向 `CONTRIBUTING.md` 和 `GU-LOG_WRITER_PROMPT.md` 作為 SSOT。
**改規則時只改 SSOT 來源檔，不要在 task prompt 裡重複定義。**

## Tech Stack

- **Framework**: Astro 5 (Content Collections + MDX)
- **Deployment**: Vercel (auto-deploy on push)
- **Analytics**: Vercel Web Analytics (`@vercel/analytics`, inject in BaseLayout)
- **Package manager**: pnpm
- **Fonts**: Inter + Noto Sans TC (Google Fonts)
- **Theme**: Solarized dark / light

## Architecture

```
src/
├── content/
│   ├── config.ts              # Content collection schema
│   └── posts/
│       ├── sp-123-date-slug.mdx   # 中文版 (lang: "zh-tw")
│       └── en-sp-123-date-slug.mdx # 英文版 (lang: "en")
├── components/
│   ├── ClawdNote.astro        # Clawd 吐槽框（所有系列通用）
│   ├── ShroomDogNote.astro    # ShroomDog 本人聲音（SD 系列）
│   ├── Toggle.astro           # 可收合內容
│   ├── TableOfContents.astro  # 目錄
│   └── ...                    # ReadingProgress, PrevNextNav, etc.
├── layouts/
│   └── BaseLayout.astro       # 主 layout
├── pages/
│   ├── index.astro            # 中文首頁
│   ├── en/index.astro         # 英文首頁
│   ├── posts/[...slug].astro  # 文章頁
│   └── rss.xml.ts             # RSS feed
└── styles/
    └── global.css
```

## Commands

```bash
pnpm run dev                   # 本地開發 localhost:4321
pnpm run build                 # 生產 build
pnpm exec astro check          # TypeScript 檢查
node scripts/validate-posts.mjs # 驗證所有文章
vercel logs --since 1h         # 查最近 1h request logs（需 vercel login）
```

## Dev Workflow

### mac-cdx / mac-CC vs CCC: Who am I, and what can I do?

幾種 Codex / local agent instance 會碰這個 repo。**開場第一件事先跑 `./scripts/detect-env.sh`** 確認自己是哪個，然後讀對應的 playbook：

| Instance | 跑在哪 | Playbook |
|---|---|---|
| **mac-cdx / mac-CC** (Local Codex / local harness) | user 個人 Mac，互動式 iterate | [`playbooks/mac-CC-playbook.md`](playbooks/mac-CC-playbook.md) |
| **CCC** (Cloud Codex) | Codex 網頁版，Linux sandbox，auto-branch | [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) |

Playbook 各自是 SSOT，定義各自的精神、scope ceiling、失敗處理、merge policy、品質 gate。**不要在這個檔案重複那些規則。** 有要加規則就去編對應的 playbook 檔。

共通原則（兩邊都不能跳）：
- Commit 內部維持 atomic，一個 commit 做一件事，revert 時才好下刀
- 品質 gate 全部保留：`pre-commit` / `pre-push` hook、`validate-posts.mjs`、tribunal 一個都不能關
- 遇到 prod 炸了或 main CI broken → 緊急事件沒有 scope 之分，看到立刻修
- **在 feature branch 上工作時，完成後必須自己開 PR（或 draft PR）+ 盯 CI**。不要把「開 PR」和「等 CI」留給 human——那是 AI agent 的工作，不是人的。唯一例外：需要 human 做決策的時候（例如不確定該不該 merge、scope 有爭議），先問再開。用 GitHub MCP tool（`mcp__github__create_pull_request`）開 PR，CI 結果用 `mcp__github__pull_request_read` 追蹤。
- **gu-log 任務的完成定義是 production URL**：當 user 要你寫文、修文、發文、跑 pipeline、補品質 gate、或處理 gu-log 內容時，不要停在草稿、MDX、PR、CI 綠燈、Vercel preview，或「等 human 下一步」。預設一路做到 merge、Vercel production deploy、production smoke test，最後回報可點的 production URL。只有真的需要 human 做關鍵內容 / 產品方向決策時才停下來問；repo hygiene、EN 同步、branch/PR/CI/Vercel 問題都屬於 agent 自己修到好。

### Branch policy（2026-04-22 起：預設 feature branch + PR）

這個 repo 目前只有 user + 幾個 AI agent 在跑，但仍然用 feature branch + PR 流程——理由是 PR 提供清楚的 review surface、讓 Vercel preview 在 merge 前先跑一次、revert 時不會沾到其他 commit。

- **預設流程**：
  1. 任何「一個 task = 一組相關 commit」的工作 → 在 `main` 拉一條 branch（命名慣例：`<type>/<scope>-<short-desc>` 例如 `fix/tribunal-badge`、`rewrite/sp-175`、`chore/scorer-pin-4-6`）
  2. 在 branch 上 commit，完成後自己 push + `gh pr create`（或 `--draft` 如果還要 iterate）
  3. 盯 CI 結果（`gh pr checks` / `mcp__github__pull_request_read`），綠了就 merge（solo repo 可自己 merge，不用等人）
  4. Merge 完 `git checkout main && git pull && git branch -d <branch>`
- **Tribunal / 自動化 pipeline 也走 branch + PR**：`tribunal-batch-runner.sh` 每篇 post 可以開自己的 branch + draft PR，方便個別 review / revert。
- **直推 main 的例外（不用 branch）**：
  - Prod 炸了或 main CI broken 的緊急修復（爭取時間）
  - 純設定檔 / doc typo（完全沒 code logic 風險）
  - User 明講「直接推 main」
- **Commit discipline**：一個 commit 做一件事，PR 內部 commit 可以多，但每個 commit 獨立 revert 時仍要站得住。別把無關改動塞同一個 commit。
- **PR size discipline**：gu-log PR 不需要為了「讓 human reviewer 逐行看」刻意切小。這個 repo 的 PR review 主要由 agent 執行，human 通常看結論、risk surface、CI、evidence，而不是 line-by-line courtesy review。重點是 OpenSpec / tests / evidence / revertability 清楚；PR 大小本身不是問題。

### Draft 來源與 Obsidian pipeline

gu-log 的文章草稿有三種來源，全部最終都變成 `src/content/posts/*.mdx`：

1. **iPhone / Mac Obsidian vault**（user 手動寫）
   - Vault 住在 iCloud Drive（`~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/gu-log-drafts/`）
   - iPhone 和 Mac 透過 iCloud 自動同步，不用 git、不用處理 conflict
   - 草稿用純 `.md` + Obsidian callout 語法（`> [!clawd]` / `> [!shroomdog]`）+ wikilink（`[[slug]]`）
   - Mac 上跑 `pnpm run obsidian:import <draft.md>` 匯入成 MDX：
     - Callout → `<ClawdNote>` / `<ShroomDogNote>` 元件
     - Wikilink → `/posts/...` 連結
     - 自動補 frontmatter、自動 bump `scripts/article-counter.json`
     - 自動跑 `validate-posts.mjs`
   - 完整設定和 workflow 在 `OBSIDIAN_SETUP.md`
2. **VS Code / Cursor / mac-cdx / CC 直接編 MDX**（手動 + AI 輔助）
   - 走原本流程：手動填 frontmatter → validate → commit
   - 適合改現有文章、寫需要複雜元件的文章
3. **Clawd / CP pipeline 自動產**（VPS 上的 agent）
   - `scripts/sp-pipeline.sh`、`scripts/clawd-picks-prompt.md`、`cp-candidates-queue.yaml`
   - Clawd 看 tweet → 翻譯 → 產 MDX → tribunal → push

**Mental model**：Obsidian 是「輸入端的 ergonomics 層」，不是新的 publishing platform。所有文章最終還是 Astro + Vercel render。這個設計讓 user 可以在 iPhone / Mac 之間隨時寫草稿，回到 Mac 再用 import script 一鍵轉成 repo 標準格式。

### 其他 workflow 規則

- **User 只看 production**（gu-log.vercel.app）。不要叫 user 開 dev server。
- **mac-cdx / CC 自己跑 `pnpm run dev`** 來 iterate，用 `playwright-cli` 截圖驗證 UI（skill 在 `.Codex/skills/playwright-cli/`）。
- **UI/UX 品質**：改完任何視覺的東西（CSS、component、color、spacing、typography、layout）就跑 `uiux-auditor` skill（`.Codex/skills/uiux-auditor/`）。它會強制兩個主題都截圖、算 WCAG 對比、flag 寫死的 hex。不要等 user 來挑錯。
- **建立 / 修改 skill**：用 `skill-creator` skill（`.Codex/skills/skill-creator/`）— 官方 anthropic/skills 的來源。
- **沙箱網路能力**（2026-04-23 實測修正）：command-line HTTPS（curl、`gp-pipeline` 的 FetchGeneric）**是通的**，不要假設沒外網。真正受限的是 `playwright-cli` 的 browser navigation——`goto` 在 `domcontentloaded` 卡死，fonts.googleapis.com 之類 CSS 外鏈拿不到。每次 navigate 前先用 `run-code` 裝一個 route handler：localhost/data: 放行，其他一律 abort。uiux-auditor skill 裡有完整範本。
- Push 到 main → Vercel auto-deploy → user 在 production 驗收。

## Quality: Vibe Scoring + Tribunal

品質管理用 4-judge tribunal（`tribunal-batch-runner.sh` 批次掃描，`tribunal-all-Codex.sh` 單篇執行）：
- **Vibe Scorer** (Opus): 五維評分（Persona / ClawdNote / Vibe / Clarity / Narrative，0-10）
- **Fact Checker** (Opus): 技術準確度 / 來源忠實 / 邏輯一致
- **Librarian** (Sonnet): Glossary / cross-ref + identity linking / sourceAlign / attribution
- **Fresh Eyes** (Haiku): 陌生讀者第一印象（3-month engineer persona）
- **Pass bar**: Vibe composite ≥ 8 AND 至少一維 ≥ 9 AND 沒有任何維 < 8，Fact ≥ 8，Librarian composite ≥ 8，Fresh Eyes ≥ 8
- **Rewrite**: 沒過 → rewriter 改寫 → 再跑 → 最多 3 次
- Agents 在 `.Codex/agents/`，評分標準 SSOT 在 `scripts/vibe-scoring-standard.md`

### Tribunal runtime ops

Daemon 行為、graceful stop、2-worker 平行化、worker worktree 管理，全部寫在 **`docs/tribunal-runbook.md`**。**碰 tribunal 自動化之前先讀這個檔**，特別是 worker worktree 不會跟著 main 自動更新這個雷，要用 `scripts/tribunal-worker-bootstrap.sh sync` 手動刷。mac-cdx / mac-CC 可以 SSH 到 VM 查即時狀態——用 `/tribunal-monitor` skill 或見 [`mac-CC-playbook`](playbooks/mac-CC-playbook.md)。

## Style Guide (Quick Ref)

完整規則見 `GU-LOG_WRITER_PROMPT.md`。

- **繁中版**：口語化、PTT 說故事風、有梗
- **EN 版**：Simple English，非母語者也能讀
- **ClawdNote**：不能無聊，要有梗，可以吐槽原作者（~25 行一個）
- **ShroomDogNote**：SD 系列專用，ShroomDog 本人的聲音
- **Kaomoji**：OK，見 GU-LOG_WRITER_PROMPT.md 的安全清單
- **色彩**：只用 Solarized CSS variables
- ❌ 不要用反問句問讀者顯而易見的答案
