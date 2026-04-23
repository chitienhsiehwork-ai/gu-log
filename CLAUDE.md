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

用字請用台灣慣用語（例如「軟體」不是「软件」、「程式」不是「程序」、「登入」不是「登录」），技術名詞可以保留英文（commit、PR、hook、API 這些不用硬翻）。語氣跟 `WRITING_GUIDELINES.md` 一致：直接、有梗、不要官腔。

**新增或編輯文章前，先讀 `CONTRIBUTING.md`。** 它是所有內容規則的 SSOT（Single Source of Truth）。

### 🔍 事實查核紀律：AI tooling 的 claim 必須 verify

gu-log 寫的就是 AI / agent / tooling 圈，這個圈子有兩個特性：
1. **變動極快**：上週的事實這週可能就過時
2. **詞彙混亂**：open source、source-available、permissive license、bundled、SDK、CLI、API 容易混為一談

所以對 AI tooling 相關的事實聲明（哪個東西是不是開源、誰收購了誰、哪個 model 何時發布、某個產品支不支援某個 feature），**不要從記憶或直覺答**。要 verify。

**特別容易踩的雷**（已踩過、不要再踩）：

- **Claude Code 是 closed source**，不是 open source、也不是 source-available。GitHub 的 `anthropics/claude-code` repo 只有 plugins / examples / scripts，**核心 CLI 原始碼不在 repo 裡**，是 npm bundled 發布的閉源軟體。License: `© Anthropic PBC. All rights reserved.`
- **Claude Agent SDK** 是另一個專案（Python/TypeScript，MIT License），跟 Claude Code 不一樣，不要混為一談。
- 2026-03-31 那次 512k 行原始碼洩漏，是 npm 發布時缺 `.npmignore` 導致 source map 意外曝光，**不是**駭客入侵也**不是**官方開源。

**操作原則**：

- 寫 glossary、寫文章、跟 user 對話時，AI tooling 相關事實都要 verify
- 不確定時用 `WebFetch` 查官方 repo / docs，不要靠直覺或舊記憶
- **Subagent 的事實結論要自己驗證一次**：subagent 也會用聽起來合理但錯的詞（例如把 closed source 說成 source-available）。看到關鍵 claim 就 fetch 一次原始碼或 license 確認
- 完整時間線參考 `src/data/glossary.json` 的 Claude Code 條目

## 文件架構（誰讀什麼）

```
CLAUDE.md (你在讀的這個)
  ├→ CONTRIBUTING.md          ← SSOT: 內容規則、ticketId SOP、防重複、frontmatter schema
  ├→ WRITING_GUIDELINES.md    ← SSOT: 寫作風格（PTT 說故事風、Clawd 吐槽語氣、SD/SP/CP 共用）
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
      ├ sp-pipeline           ← Self-compiling bash wrapper (entry point)
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

- **Claude Code**（Mac，手動互動）→ 讀 `CLAUDE.md`（這個檔案）→ 開發、debug、SOP 調整
- **Clawd (OpenClaw)**（VPS，24/7 自動）→ 讀 `~/clawd/AGENTS.md` → 再讀 `scripts/clawd-picks-prompt.md` → 自動翻譯推文

兩條路最終都指向 `CONTRIBUTING.md` 和 `WRITING_GUIDELINES.md` 作為 SSOT。
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

### CC vs CCC: Who am I, and what can I do?

兩種 Claude Code instance 會碰這個 repo。**開場第一件事先跑 `./scripts/detect-env.sh`** 確認自己是哪個，然後讀對應的 playbook：

| Instance | 跑在哪 | Playbook |
|---|---|---|
| **mac-CC** (Local Claude Code) | user 個人 Mac，互動式 iterate | [`playbooks/mac-CC-playbook.md`](playbooks/mac-CC-playbook.md) |
| **CCC** (Cloud Claude Code) | Claude Code 網頁版，Linux sandbox，auto-branch | [`playbooks/CCC-playbook.md`](playbooks/CCC-playbook.md) |

Playbook 各自是 SSOT，定義各自的精神、scope ceiling、失敗處理、merge policy、品質 gate。**不要在這個檔案重複那些規則。** 有要加規則就去編對應的 playbook 檔。

共通原則（兩邊都不能跳）：
- Commit 內部維持 atomic，一個 commit 做一件事，revert 時才好下刀
- 品質 gate 全部保留：`pre-commit` / `pre-push` hook、`validate-posts.mjs`、tribunal 一個都不能關
- 遇到 prod 炸了或 main CI broken → 緊急事件沒有 scope 之分，看到立刻修
- **在 feature branch 上工作時，完成後必須自己開 PR（或 draft PR）+ 盯 CI**。不要把「開 PR」和「等 CI」留給 human——那是 AI agent 的工作，不是人的。唯一例外：需要 human 做決策的時候（例如不確定該不該 merge、scope 有爭議），先問再開。用 GitHub MCP tool（`mcp__github__create_pull_request`）開 PR，CI 結果用 `mcp__github__pull_request_read` 追蹤。

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
2. **VS Code / Cursor / CC 直接編 MDX**（手動 + AI 輔助）
   - 走原本流程：手動填 frontmatter → validate → commit
   - 適合改現有文章、寫需要複雜元件的文章
3. **Clawd / CP pipeline 自動產**（VPS 上的 agent）
   - `scripts/sp-pipeline.sh`、`scripts/clawd-picks-prompt.md`、`cp-candidates-queue.yaml`
   - Clawd 看 tweet → 翻譯 → 產 MDX → tribunal → push

**Mental model**：Obsidian 是「輸入端的 ergonomics 層」，不是新的 publishing platform。所有文章最終還是 Astro + Vercel render。這個設計讓 user 可以在 iPhone / Mac 之間隨時寫草稿，回到 Mac 再用 import script 一鍵轉成 repo 標準格式。

### 其他 workflow 規則

- **User 只看 production**（gu-log.vercel.app）。不要叫 user 開 dev server。
- **CC 自己跑 `pnpm run dev`** 來 iterate，用 `playwright-cli` 截圖驗證 UI（skill 在 `.claude/skills/playwright-cli/`）。
- **UI/UX 品質**：改完任何視覺的東西（CSS、component、color、spacing、typography、layout）就跑 `uiux-auditor` skill（`.claude/skills/uiux-auditor/`）。它會強制兩個主題都截圖、算 WCAG 對比、flag 寫死的 hex。不要等 user 來挑錯。
- **建立 / 修改 skill**：用 `skill-creator` skill（`.claude/skills/skill-creator/`）— 官方 anthropic/skills 的來源。
- **沙箱網路能力**（2026-04-23 實測修正）：command-line HTTPS（curl、`sp-pipeline` 的 FetchGeneric）**是通的**，不要假設沒外網。真正受限的是 `playwright-cli` 的 browser navigation——`goto` 在 `domcontentloaded` 卡死，fonts.googleapis.com 之類 CSS 外鏈拿不到。每次 navigate 前先用 `run-code` 裝一個 route handler：localhost/data: 放行，其他一律 abort。uiux-auditor skill 裡有完整範本。
- Push 到 main → Vercel auto-deploy → user 在 production 驗收。

## Quality: Vibe Scoring + Tribunal

品質管理用 4-judge tribunal（`tribunal-batch-runner.sh` 批次掃描，`tribunal-all-claude.sh` 單篇執行）：
- **Vibe Scorer** (Opus): 五維評分（Persona / ClawdNote / Vibe / Clarity / Narrative，0-10）
- **Fact Checker** (Opus): 技術準確度 / 來源忠實 / 邏輯一致
- **Librarian** (Sonnet): Glossary / cross-ref + identity linking / sourceAlign / attribution
- **Fresh Eyes** (Haiku): 陌生讀者第一印象（3-month engineer persona）
- **Pass bar**: Vibe composite ≥ 8 AND 至少一維 ≥ 9 AND 沒有任何維 < 8，Fact ≥ 8，Librarian composite ≥ 8，Fresh Eyes ≥ 8
- **Rewrite**: 沒過 → rewriter 改寫 → 再跑 → 最多 3 次
- Agents 在 `.claude/agents/`，評分標準 SSOT 在 `scripts/vibe-scoring-standard.md`

## Style Guide (Quick Ref)

完整規則見 `WRITING_GUIDELINES.md`。

- **繁中版**：口語化、PTT 說故事風、有梗
- **EN 版**：Simple English，非母語者也能讀
- **ClawdNote**：不能無聊，要有梗，可以吐槽原作者（~25 行一個）
- **ShroomDogNote**：SD 系列專用，ShroomDog 本人的聲音
- **Kaomoji**：OK，見 WRITING_GUIDELINES.md 的安全清單
- **色彩**：只用 Solarized CSS variables
- ❌ 不要用反問句問讀者顯而易見的答案
