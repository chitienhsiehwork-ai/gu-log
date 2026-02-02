# gu-log

> ShroomDog's translation blog — bilingual tech articles (zh-tw + en) with Clawd annotations.
> Live: https://gu-log.vercel.app/

## Commands

```bash
npm install          # install deps
npm run dev          # dev server at localhost:4321
npm run build        # production build (catches rendering errors)
npx astro check      # TypeScript + template type checking
```

## Ralph Loop (Autonomous AI Development)

`ralph-loop.sh` runs Claude Code in a headless loop. Each iteration picks one task from `TODO.json`, does the work, commits, pushes, then exits — starting the next iteration with a fresh context window.

```bash
./ralph-loop.sh      # default 10 iterations
./ralph-loop.sh 5    # run 5 iterations
```

Runtime logs: `.ralph/loop.log` (gitignored)

The loop stops when:
- All tasks are done (creates `.ralph/DONE`)
- Max iterations reached
- You `Ctrl+C`

## Task Tracking

See `TODO.json` for the prioritized task list. Tasks are ordered P0 (critical) → P3 (nice-to-have).

## Project Structure

```
src/
├── layouts/          # page shells (BaseLayout, EnLayout)
├── components/       # ThemeToggle, LanguageToggle, Toggle
├── pages/
│   ├── posts/*.astro # zh-tw articles
│   └── en/posts/     # en articles
└── styles/global.css # Solarized theming via CSS variables
```
