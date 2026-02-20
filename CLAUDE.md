# gu-log

> 翻譯 blog — 把英文好文翻成繁中，附 Clawd 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

## ⚠️ 必讀

**新增或編輯文章前，先讀 `CONTRIBUTING.md`。** 它是所有內容規則的 SSOT（Single Source of Truth）。

## 文件架構（誰讀什麼）

```
CLAUDE.md (你在讀的這個)
  ├→ CONTRIBUTING.md          ← SSOT: 內容規則、ticketId SOP、防重複、frontmatter schema
  ├→ TRANSLATION_PROMPT.md    ← SSOT: 翻譯風格（PTT 說故事風、Clawd 吐槽語氣）
  ├→ src/content/config.ts    ← SSOT: Frontmatter schema (Zod validation)
  └→ scripts/
      ├ clawd-picks-prompt.md ← Clawd Picks 任務流程（給 Clawd on VM 用）
      ├ clawd-picks-config.json ← 推文帳號清單
      └ article-counter.json  ← Ticket ID counter（SP/CP/SD）
```

**兩個 AI 操作這個 repo：**

| AI | 在哪 | 自動讀什麼 | 用途 |
|----|------|-----------|------|
| **Claude Code** | Mac（手動互動） | `CLAUDE.md`（這個檔案） | 開發、debug、SOP 調整 |
| **Clawd (OpenClaw)** | VPS（24/7 自動） | `~/clawd/AGENTS.md` → 再讀 `scripts/clawd-picks-prompt.md` | 自動翻譯推文 |

兩條路最終都指向 `CONTRIBUTING.md` 和 `TRANSLATION_PROMPT.md` 作為 SSOT。
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
│       ├── article.mdx        # 中文版 (lang: "zh-tw")
│       └── en-article.mdx     # 英文版 (lang: "en")
├── components/
│   ├── ClawdNote.astro        # Clawd 吐槽框
│   ├── Toggle.astro           # 可收合內容
│   ├── TableOfContents.astro  # 目錄
│   └── ...                    # ReadingProgress, BackToTop, PrevNextNav, CodeCopyButton
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
pnpm run dev      # 本地開發 localhost:4321
pnpm run build    # 生產 build
pnpm exec astro check  # TypeScript 檢查
```

## Style Guide (Quick Ref)

完整規則見 `TRANSLATION_PROMPT.md`。

- **繁中版**：口語化、PTT 說故事風、有梗
- **EN 版**：Simple English，非母語者也能讀
- **Clawd 吐槽**：不能無聊，要有梗，可以吐槽原作者
- **Kaomoji**：OK，見 TRANSLATION_PROMPT.md 的安全清單
- **色彩**：只用 Solarized CSS variables
