# gu-log

> 翻譯 blog — 把英文好文翻成繁中 + 簡單易懂的英文版，附 Clawd 吐槽註解。兩個語言版本同等重要，每篇文章必須同時產出 zh-tw 和 en 版。by ShroomDog and Clawd.
> Live: https://gu-log.vercel.app/

## Tech Stack

- **Framework**: Astro 5 (static site generation)
- **Deployment**: Vercel (auto-detect, no vercel.json)
- **Package manager**: npm (prefer bun if migrating)
- **Fonts**: Inter + Noto Sans TC (Google Fonts)
- **Theme**: Solarized dark (default) / Solarized light, toggled via `data-theme` attribute

## Architecture

```
src/
├── components/
│   ├── BaseLayout.astro      # zh-tw layout
│   ├── EnLayout.astro        # en layout (95% duplicate of BaseLayout)
│   ├── ThemeToggle.astro     # dark/light toggle
│   ├── LanguageToggle.astro  # zh-tw/en switcher
│   └── Toggle.astro          # collapsible content
├── layouts/
│   ├── BaseLayout.astro
│   └── EnLayout.astro
├── pages/
│   ├── index.astro           # zh-tw homepage (manually lists all posts)
│   ├── about.astro
│   ├── posts/*.astro         # zh-tw articles (each post = raw .astro file)
│   └── en/
│       ├── index.astro       # en homepage
│       └── posts/*.astro     # en articles (only 1 exists)
└── styles/
    └── global.css            # CSS variables, Solarized theming
```

## Content Workflow

### Translation Prompt
See `TRANSLATION_PROMPT.md` — defines the 李宏毅 professor persona, Clawd annotations, bilingual rules.

### Adding a New Post (current manual process)
1. Create `src/pages/posts/slug-name.astro`
2. Write full HTML content using `BaseLayout` (or `EnLayout` for en)
3. Manually add entry to `src/pages/index.astro`
4. If bilingual: repeat for `src/pages/en/posts/slug-name.astro` + update `src/pages/en/index.astro`

### Clawd Annotations
```html
<blockquote class="claude-note">
  <strong>Clawd：</strong>...witty commentary...
</blockquote>
```

## Known Issues / Tech Debt

- **No Content Collections** — posts are raw .astro files, index is manually maintained
- **Layout duplication** — BaseLayout.astro and EnLayout.astro are 95% identical
- **Empty astro.config.mjs** — no `site` URL, no integrations
- **No SEO** — missing og:tags, RSS, sitemap, robots.txt
- **No syntax highlighting** — code blocks are plain `<pre><code>`
- **Broken link** — EN nav links to `/en/about` which doesn't exist
- **No CI/CD** — no build verification, broken pages can ship

## Task Tracking

**Check `TODO.json` for the prioritized task list.** You are expected to:
1. Read TODO.json at session start
2. Pick a task (respect priority order and dependencies)
3. Update the task's `status` field as you work: `"pending"` → `"in_progress"` → `"done"`
4. Commit both code changes AND the TODO.json status update together

### TODO.json Status Values
- `"pending"` — not started
- `"in_progress"` — currently being worked on
- `"done"` — completed and committed
- `"blocked"` — waiting on another task (check `depends_on`)

## Commands

```bash
npm run dev      # local dev server
npm run build    # production build (catches rendering errors)
npx astro check  # TypeScript + template type checking
```

## Style Guide

- 繁中版：口語化、PTT 說故事風、李宏毅 persona
- EN 版：Simple English（non-native speakers 也能輕鬆讀），用跟繁中版一樣的李宏毅教授語氣——casual、比喻多、會吐槽技術、對人友善
- Kaomoji OK (see TRANSLATION_PROMPT.md for safe list)
- Keep Solarized color scheme — don't introduce new colors outside CSS variables
- Mobile-first, max-width 680px
