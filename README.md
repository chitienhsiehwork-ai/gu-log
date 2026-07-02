<div align="center">

<img src=".github/assets/gu-log-icon.png" alt="gu-log" width="140" />

# gu-log

**A bilingual AI/tech blog — great English writing, retold in Traditional Chinese (and back).**

[![Live](https://img.shields.io/badge/live-gu--log.vercel.app-cb4b16?style=flat-square)](https://gu-log.vercel.app/)
&nbsp;[![Built with Astro](https://img.shields.io/badge/built%20with-Astro%205-ff5d01?style=flat-square&logo=astro&logoColor=white)](https://astro.build/)
&nbsp;[![Deployed on Vercel](https://img.shields.io/badge/deploy-Vercel-000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)

**English** · [繁體中文](./README.zh-TW.md)

</div>

---

## What is gu-log?

gu-log takes the best AI / agent / tooling writing on the internet — X threads, blog posts, HN discussions, docs — and retells it in clear Traditional Chinese, with the original always linked. It also publishes original pieces and beginner tutorials. **Every article ships in both `zh-tw` and `en`.**

The name: **`gu` = 菇 (mushroom)** from ShroomDog. So `gu-log` = 菇 log = a mushroom's notebook. 🍄

> Good content shouldn't be gated by language — and translating it is how we learn it too.

---

## The cast

<table>
  <tr>
    <td align="center" width="220">
      <img src=".github/assets/gu-log-icon.png" alt="gu-log icon" width="120" /><br/>
      <strong>gu-log</strong>
    </td>
    <td align="center" width="220">
      <img src=".github/assets/shroomdog.png" alt="ShroomDog" width="120" /><br/>
      <strong>ShroomDog</strong> (香菇大狗狗)
    </td>
    <td align="center" width="220">
      <img src=".github/assets/mogu.png" alt="Mogu the Hedgie" width="120" /><br/>
      <strong>Mogu the Hedgie</strong>
    </td>
  </tr>
  <tr>
    <td align="center" valign="top">
      The <strong>brand</strong>. A mushroom with a terminal prompt — half cozy, half command line. It's the blog itself.
    </td>
    <td align="center" valign="top">
      The <strong>human author</strong>. Curates what's worth translating, sets the editorial bar, and gives the feedback that calibrates everything.
    </td>
    <td align="center" valign="top">
      The <strong>AI partner</strong>. A mushroom-capped hedgehog who does the writing, translating, and site upkeep — and drops the running commentary in <code>&lt;MoguNote&gt;</code>.
    </td>
  </tr>
</table>

---

## Article series

Every article carries a ticket ID so you can tell at a glance who picked it and why.

| Prefix | Series | Who picks | Who writes |
|---|---|---|---|
| **GP** | Gu-log Picks | ShroomDog | Mogu translates |
| **CP** | Mogu Picks | Mogu (self-selected) | Mogu translates |
| **SD** | ShroomDog Original | ShroomDog | ShroomDog writes |
| **Lv** | Level-Up | — | beginner tutorials |

---

## Quality: a two-tier bar

gu-log is a blog *about* AI quality, so it puts its own AI self-scores in the open — even the bad ones. Quality is gated in two layers, not one hard wall:

| Tier | Bar | Enforced by | If it doesn't pass |
|---|---|---|---|
| **Floor** (auto-gate) | real `scores.vibe` + required Vibe dimensions for that tribunal version + composite **≥ 3** | pre-commit hook | **commit blocked** — garbage never reaches `main` |
| **PASS** (editorial) | full tribunal pass bar: Vibe composite **≥ 8** with one dim ≥ 9 and no dim < 8; Fact Check, Librarian, and Fresh Eyes hard gates also pass | homepage / UI filter | still ships, but with a "refining" badge and **kept off the homepage** until a background pass lifts it to PASS |

Scoring runs through a **4-judge tribunal** (each article, newest-first). This list is a derived view; the model SSOT is each judge's `model:` frontmatter in `.claude/agents/*.md`, so docs do not duplicate model names:

- **Vibe Scorer** — v9 dimensions: Persona / MoguNote / Vibe / Narrative; v8 and below also include Clarity
- **Fact Checker** — technical accuracy, source fidelity, logical consistency
- **Librarian** — glossary, cross-refs, attribution, source alignment
- **Fresh Eyes** — a stranger's first impression; v9 owns Clarity as a non-compensating gate

Anything sub-8 gets queued for a background rewrite (up to 3 rounds) instead of blocking the ship.

---

## Tech stack

- **Framework** — [Astro 5](https://astro.build/) (Content Collections + MDX)
- **Hosting** — Vercel (auto-deploy on push to `main`)
- **Package manager** — pnpm (the only supported one; `pnpm-lock.yaml` is the source of truth)
- **Fonts** — Inter + Noto Sans TC
- **Theme** — Solarized (light) / Dracula-ish (dark), via CSS variables

---

## Local development

```bash
pnpm install            # install deps (frozen lockfile in CI)
pnpm run dev            # dev server at localhost:4321
pnpm run build          # production build (catches render errors)
pnpm exec astro check   # TypeScript + template type checking
pnpm run validate:posts # frontmatter & content policy
pnpm run content:check  # validate:posts + build, in one shot
```

---

## Project structure

```
src/
├── content/
│   ├── config.ts            # frontmatter schema (Zod validation)
│   └── posts/
│       ├── sp-123-…-slug.mdx     # zh-tw version (lang: "zh-tw")
│       └── en-sp-123-…-slug.mdx  # en version    (lang: "en")
├── components/
│   ├── MoguNote.astro       # Mogu's commentary box
│   ├── ShroomDogNote.astro  # ShroomDog's own voice (SD series)
│   └── …                    # ThemeToggle, LanguageToggle, TableOfContents…
├── layouts/                 # BaseLayout (zh-tw) + en shell
├── pages/
│   ├── posts/[...slug].astro     # zh-tw articles
│   ├── en/posts/[...slug].astro  # en articles
│   └── rss.xml.ts
└── styles/global.css        # Solarized theming via CSS variables
```

---

## Quality gates & CI

CI is layered to keep PRs fast while still catching everything overnight.

**Layer 1 — PR fast gate** (`.github/workflows/ci.yml`, blocking, ~3–5 min):
`lockfile-consistency` · `lint` (ESLint + Prettier) · `validate-content` · `security-gate` → then `build` (type check + production build).

**Layer 2 — nightly deep check** (`.github/workflows/nightly-deep.yml`, advisory):
Playwright visual review · Lighthouse · full `pnpm audit` · dependency freshness · bundle-size history. Failures ping Telegram.

**Layer 3 — post-deploy smoke test** (`.github/workflows/deploy-smoke-test.yml`):
After each Vercel production deploy, checks the site is live, articles render, and counts match.

Two extra blocking policies worth knowing:

- **Security gate** (`pnpm run security:gate`) — any new high/critical vulnerability fails the PR unless it has a valid, expiring entry in `quality/security-allowlist.json` (runtime: ≤ 14 days, dev: ≤ 45 days).
- **Bundle budget** (`scripts/bundle-budget-check.mjs`) — global JS/CSS and single-file sizes are blocking; HTML/total/route sizes are warn-only trend monitors with growth-rate alerts.

> No `--no-verify`. If a hook fails, the fix is to fix the code or fix the hook — never to skip it.

---

## Contributing & docs

These are the sources of truth — read them before editing content:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — content rules, ticket-ID SOP, dedup, frontmatter schema
- [`GU-LOG_WRITER_PROMPT.md`](./GU-LOG_WRITER_PROMPT.md) — writing style (PTT storytelling, MoguNote voice)
- [`src/content.config.ts`](./src/content.config.ts) — frontmatter schema (Zod)
- [`CLAUDE.md`](./CLAUDE.md) — how the AI agents operate this repo

---

<div align="center">
<sub>Made by ShroomDog &amp; Mogu · <a href="https://gu-log.vercel.app/">gu-log.vercel.app</a></sub>
</div>
