# Dev Reference：Tech Stack / Architecture / Commands

> gu-log 的技術參考（純技術內容，英文術語密集）。`AGENTS.md` 路由表指向這裡。

## Tech Stack

- **Framework**: Astro 5 (Content Collections + MDX)
- **Deployment**: Vercel (auto-deploy on push)
- **Analytics**: Vercel Web Analytics (`@vercel/analytics`, inject in BaseLayout)
- **Package manager**: pnpm
- **Fonts**: Inter + Noto Sans TC (Google Fonts)
- **Theme**: Dracula dark（default）+ Solarized light（CSS SSOT：`src/styles/global.css`；雙主題對照見 `uiux-auditor` skill）

## UI QA

任何讀者看得到的 `CSS`、元件、色彩、間距、字體排印或版面變更，合併前都要用當前執行環境可用的 `uiux-auditor` 做雙主題、相關畫面尺寸與 WCAG 對比審查。實際工具與執行方式依執行環境操作手冊或 skill；本檔不複製指令。

## Architecture

```
src/
├── content/
│   ├── config.ts              # Content collection schema
│   └── posts/
│       ├── gp-123-date-slug.mdx   # 中文版 (lang: "zh-tw")
│       └── en-gp-123-date-slug.mdx # 英文版 (lang: "en")
├── components/
│   ├── MoguNote.astro        # Mogu 吐槽框（所有系列通用）
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
                               # 雷：改 src/styles/global.css 後 HMR 可能吃到舊的
                               # 內嵌 CSS（實測兩次）——清 node_modules/.vite 與
                               # .astro/ 再重啟，並 curl page 確認新值有 serve 出來
pnpm run build                 # 生產 build
pnpm exec astro check          # TypeScript 檢查
node scripts/validate-posts.mjs # 驗證所有文章
vercel logs --since 1h         # 查最近 1h request logs（需 vercel login）
```
