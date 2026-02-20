# gu-log

> ShroomDog's translation blog — bilingual tech articles (zh-tw + en) with Clawd annotations.
> Live: https://gu-log.vercel.app/

## Commands

```bash
pnpm install          # install deps
pnpm run dev          # dev server at localhost:4321
pnpm run build        # production build (catches rendering errors)
pnpm exec astro check # TypeScript + template type checking
pnpm run format:check # Prettier check (code/config scope only)
pnpm run content:check # content quality gate = validate:posts + build
pnpm run lockfile:check # frozen lockfile + no pnpm-lock drift
```

## Package manager & lockfile policy

- This repo uses **pnpm only**.
- `pnpm-lock.yaml` is the single source of truth and must be committed with dependency changes.
- `package-lock.json` is not used and must not be tracked.
- CI blocks PRs if lockfile consistency checks fail (`pnpm install --frozen-lockfile` + clean lockfile diff).

## Format vs Content Quality (Level 3 split)

To avoid MDX parser false positives while keeping quality signals trustworthy:

- `pnpm run format:check` / `pnpm run format` now targets **code + config** only:
  - `src/components/**/*.{astro,js,ts}`
  - `src/layouts/**/*.{astro,js,ts}`
  - `src/pages/**/*.{astro,js,ts}`
  - `src/config/**/*.{js,ts}`
  - `src/styles/**/*.css`
  - `scripts/**/*.{js,mjs,cjs,ts}`
  - root config files: `*.{mjs,cjs,ts}`
- `src/content/posts/*.mdx` is checked by content-specific gates instead of Prettier.
- Content command to run in CI/local:
  - `pnpm run validate:posts` (frontmatter/content policy)
  - `pnpm run build` (real render/build safety)
  - or one-shot: `pnpm run content:check`

Follow-up parser compatibility TODOs are tracked in `docs/mdx-format-todo.md`.

## Bundle Budget Flow

```bash
node scripts/bundle-budget-check.mjs            # check-only (default, no file writes)
node scripts/bundle-budget-check.mjs --record   # record mode (append quality/bundle-size-history.json)
```

### Level 5 (Plan C) budget policy

- **Blocking budgets (fail CI / pre-push):**
  - Global JS size
  - Global CSS size
  - Single JS/CSS file max size
- **Trend monitors (warn only, non-blocking):**
  - Global HTML size
  - Global total bundle size
  - Route-level HTML size for key pages (`/`, `/en/`, `/clawd-picks/`, `/en/clawd-picks/`, `/shroomdog-picks/`, `/level-up/`)

Trend monitors also include **growth-rate alerts** (warning/critical tiers) against recorded history to catch unusual jumps without blocking normal content growth.

- `pre-push` hook runs **check-only** mode, so pushing does not modify tracked files.
- `pre-push` only blocks on **blocking budget violations**.
- Daily bundle history recording is handled by GitHub Actions workflow:
  `.github/workflows/bundle-history-daily.yml`
- The workflow runs `--record` and uploads `quality/bundle-size-history.json` as an artifact.

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
