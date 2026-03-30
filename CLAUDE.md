# gu-log

> AI/Tech 翻譯 + 原創 blog。把英文好文翻成繁中（SP/CP），ShroomDog 自己的原創文（SD），入門教學（Lv）。附 Clawd 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

## ⚠️ 必讀

**新增或編輯文章前，先讀 `CONTRIBUTING.md`。** 它是所有內容規則的 SSOT（Single Source of Truth）。

## 文件架構（誰讀什麼）

```
CLAUDE.md (你在讀的這個)
  ├→ CONTRIBUTING.md          ← SSOT: 內容規則、ticketId SOP、防重複、frontmatter schema
  ├→ WRITING_GUIDELINES.md    ← SSOT: 寫作風格（PTT 說故事風、Clawd 吐槽語氣、SD/SP/CP 共用）
  ├→ src/content/config.ts    ← SSOT: Frontmatter schema (Zod validation)
  └→ scripts/
      ├ article-counter.json  ← Ticket ID counter（SD/SP/CP/Lv）
      ├ ralph-loop.sh         ← Ralph Loop 品質管理（batch scoring + rewrite）
      ├ ralph-scorer.sh       ← 單篇文章 Ralph 評分
      ├ ralph-vibe-scoring-standard.md ← 評分標準 SSOT
      ├ ralph-progress.json   ← Ralph 進度追蹤
      ├ sp-pipeline.sh        ← SP 自動翻譯 pipeline
      ├ clawd-picks-prompt.md ← Clawd Picks 任務流程（給 Clawd on VM 用）
      ├ clawd-picks-config.json ← 推文帳號清單
      ├ validate-posts.mjs    ← Frontmatter + 格式驗證
      └ detect-model.mjs      ← Model 名稱偵測（不要猜！）
```

**兩個 AI 操作這個 repo：**

- **Claude Code**（Mac，手動互動）→ 讀 `CLAUDE.md`（這個檔案）→ 開發、debug、SOP 調整
- **Clawd (OpenClaw)**（VPS，24/7 自動）→ 讀 `~/clawd/AGENTS.md` → 再讀 `scripts/clawd-picks-prompt.md` → 自動翻譯推文

兩條路最終都指向 `CONTRIBUTING.md` 和 `WRITING_GUIDELINES.md` 作為 SSOT。
**改規則時只改 SSOT 來源檔，不要在 task prompt 裡重複定義。**

## Tech Stack

- **Framework**: Astro 5 (Content Collections + MDX)
- **Deployment**: Vercel (auto-deploy on push)
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
```

## Quality: Ralph Loop

品質管理用 Ralph Loop — multi-agent scoring + rewrite：
- **Scorer**: 三維評分（Persona / ClawdNote / Vibe，0-10）
- **Pass bar**: SP/CP ≥ 8/8/8, SD ≥ 9/9/9
- **Rewrite**: 沒過 → rewriter 改寫 → 再跑 scorer → 最多 3 次
- **Fact-check**: GPT 5.4 四層驗證（翻譯扭曲/數字捏造/原文 claim/錯誤→ClawdNote）
- 詳見 `CONTRIBUTING.md`

## Style Guide (Quick Ref)

完整規則見 `WRITING_GUIDELINES.md`。

- **繁中版**：口語化、PTT 說故事風、有梗
- **EN 版**：Simple English，非母語者也能讀
- **ClawdNote**：不能無聊，要有梗，可以吐槽原作者（~25 行一個）
- **ShroomDogNote**：SD 系列專用，ShroomDog 本人的聲音
- **Kaomoji**：OK，見 WRITING_GUIDELINES.md 的安全清單
- **色彩**：只用 Solarized CSS variables
- ❌ 不要用反問句問讀者顯而易見的答案
