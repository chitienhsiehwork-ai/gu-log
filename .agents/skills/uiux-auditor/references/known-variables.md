# gu-log CSS Variable Palette

Always prefer an existing variable over a new hex. New variables are OK when the existing palette genuinely doesn't cover the use case (e.g. "source-citation link" needed its own var because it sits on `--color-surface`, not on `--color-bg`, and the page accent had insufficient contrast on that surface).

Source of truth: `src/styles/global.css` `:root` block + `[data-theme='light']` block.

## Dark (Dracula — default)

| Variable | Hex | Notes |
|---|---|---|
| `--color-bg` | `#282a36` | Page background |
| `--color-surface` | `#44475a` | Card / citation / code bg |
| `--color-surface-hover` | `#525672` | Hover state on cards |
| `--color-text` | `#cecdda` | Primary body text |
| `--color-text-muted` | `#8a96c0` | Secondary text, meta |
| `--color-accent` | `#ff79c6` | Link + brand accent (hot pink) |
| `--color-border` | `#44475a` | Dividers |
| `--color-badge-sd` | `#69d2a0` | ShroomDog Original green |
| `--color-badge-sp` | `#8be9fd` | ShroomDog Picks cyan |
| `--color-badge-cp` | `#ffb86c` | Clawd Picks orange |
| `--color-badge-lv` | `#bd93f9` | Level-up purple |
| `--color-clawd-orange` | `#ffb86c` | Clawd's note border |
| `--color-heading-sd` | `#5ab88a` | SD section headings (dimmed green) |
| `--color-heading-sp` | `#6bb8d6` | SP section headings (dimmed cyan) |
| `--color-source-link` | `#ffb3e0` | Source-citation link — 5.54:1 on `#44475a` |

## Light (Solarized)

| Variable | Hex | Notes |
|---|---|---|
| `--color-bg` | `#fdf6e3` | Cream page background |
| `--color-surface` | `#eee8d5` | Card / citation / code bg |
| `--color-surface-hover` | `#e5dfc9` | Hover state on cards |
| `--color-text` | `#556b73` | Primary body text |
| `--color-text-muted` | `#4a5a5e` | Secondary text, meta |
| `--color-accent` | `#1c679b` | Solarized navy link accent |
| `--color-border` | `#d3cbb7` | Dividers |
| `--color-badge-sd` | `#1d6a5c` | Deep teal |
| `--color-badge-sp` | `#195d8c` | Solarized navy |
| `--color-badge-cp` | `#854d35` | Sienna brown |
| `--color-badge-lv` | `#6b4ca0` | Muted purple |
| `--color-clawd-orange` | `#955330` | Rust on cream |
| `--color-heading-sd` | `#1d6a5c` | |
| `--color-heading-sp` | `#195d8c` | |
| `--color-source-link` | `#195d8c` | 5.73:1 on `#eee8d5` |

## Design intent

- Dark uses **Dracula**, not Solarized dark. The `--color-accent` is hot pink by tradition.
- Light uses **Solarized light**, and `--color-accent` is navy.
- When a UI element lives on `--color-surface` instead of `--color-bg`, the accent may not clear WCAG AA contrast against that surface — that's the exact failure mode that produced this skill. For elements on surface, prefer a variable whose hex has been verified on the surface specifically (like `--color-source-link`).

## Adding a new variable

1. Pick a semantic name (`--color-<thing>-<role>`), not a palette name (`--color-pink-light`).
2. Define it in **both** `:root` and `[data-theme='light']`.
3. Annotate both declarations with `/* ... on #xxxxxx */` so `scripts/check-contrast.mjs` verifies the pair.
4. Commit CSS only — never inline the hex in a component `<style>` block.
