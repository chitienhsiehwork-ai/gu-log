# gu-log

> 翻譯 blog — 把英文好文翻成繁中，附 Clawd 吐槽註解。每篇文章同時產出 zh-tw 和 en 版。
> Live: https://gu-log.vercel.app/

## Tech Stack

- **Framework**: Astro 5 (Content Collections + MDX)
- **Deployment**: Vercel (auto-deploy on push)
- **Package manager**: npm
- **Fonts**: Inter + Noto Sans TC (Google Fonts)
- **Theme**: Solarized dark (default) / Solarized light

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
│   ├── ReadingProgress.astro  # 閱讀進度條
│   ├── BackToTop.astro        # 返回頂部
│   ├── PrevNextNav.astro      # 上下篇導航
│   └── CodeCopyButton.astro   # 程式碼複製
├── layouts/
│   └── BaseLayout.astro       # 主 layout
├── pages/
│   ├── index.astro            # 中文首頁 (動態抓 posts)
│   ├── posts/[...slug].astro  # 中文文章頁
│   ├── en/
│   │   ├── index.astro        # 英文首頁
│   │   └── posts/[...slug].astro
│   └── rss.xml.ts             # RSS feed
└── styles/
    └── global.css
```

## Content Workflow

### 新增文章

1. 建立 `src/content/posts/slug-name.mdx` (中文版)
2. 建立 `src/content/posts/en-slug-name.mdx` (英文版)
3. 填寫 frontmatter (見 CONTRIBUTING.md)
4. 用 `<ClawdNote>` component 加入 Clawd 吐槽
5. `npm run build` 確認沒錯誤
6. Push，Vercel 自動部署

### Frontmatter

```yaml
---
title: "文章標題"
date: "2026-02-02"
source: "@username on X"
sourceUrl: "https://..."
summary: "摘要"
lang: "zh-tw"
tags: ["tag1", "tag2"]
---
```

### Components

```mdx
import ClawdNote from '../../components/ClawdNote.astro';
import Toggle from '../../components/Toggle.astro';

<ClawdNote>
Clawd 的吐槽 (◕‿◕)
</ClawdNote>

<Toggle title="展開">
隱藏內容
</Toggle>
```

## Commands

```bash
npm run dev      # 本地開發 localhost:4321
npm run build    # 生產 build
npx astro check  # TypeScript 檢查
```

## Related Files

- `CONTRIBUTING.md` — 完整寫作規範
- `TRANSLATION_PROMPT.md` — 翻譯風格指南（PTT 說故事風、kaomoji、Clawd 註解語氣）
- `TODO.json` — 任務追蹤

## Style Guide

- **繁中版**：口語化、PTT 說故事風、有梗
- **EN 版**：Simple English，非母語者也能讀
- **Clawd 吐槽**：不能無聊，要有梗，可以吐槽原作者
- **Kaomoji**：OK，見 TRANSLATION_PROMPT.md 的安全清單
- **色彩**：只用 Solarized CSS variables
