---
name: sp-source-fetch
description: Fetch the full body of an X / Twitter post or X Article (long-form) for SP or CP translation. Use this whenever the user drops an X URL and wants a translation post, or whenever sp-pipeline.sh is about to run. In sandbox environments (Claude Code on the web, any box without outbound x.com access) this is the ONLY reliable path — WebFetch is blocked, playwright can't reach x.com, and naive curl to x.com returns a React shell. Handles both plain tweets and X Articles with `article.content.blocks[]` rendered as markdown. Fails loudly with `INCOMPLETE_SOURCE: <reason>` exit 2 when the body genuinely can't be retrieved, so the caller never writes a post based on a preview snippet.
---

# sp-source-fetch

Fetch an X URL's full translatable body, or fail loud. One script, one contract.

## When to use

- User drops an `https://x.com/...` or `https://twitter.com/...` URL and asks for an SP or CP
- `sp-pipeline.sh` is the natural next step and the source capture stage needs the body
- Any time "I need the tweet content but curl returns gibberish"

Do NOT use for:
- Non-X URLs (blog posts, arXiv, GitHub README) — those go through `scripts/fetch-article.py`
- Bluesky / Mastodon URLs — need a different fetcher

## The only command

```bash
bash scripts/fetch-x-article.sh <tweet_url>
```

Output shape (stdout):

```
@handle — YYYY-MM-DD
Source URL: https://x.com/handle/status/ID
Fetched via: fxtwitter   # or vxtwitter

=== MAIN TWEET ===
<full body — plain tweet text OR rendered X Article markdown>
```

On hard failure, prints `INCOMPLETE_SOURCE: <reason>` to stderr and exits 2.

For raw JSON (rare, mostly for debugging):

```bash
bash scripts/fetch-x-article.sh <tweet_url> --json
```

## How it works (decision tree)

1. Extract status ID from the URL (handles `/status/` and `/statuses/`)
2. Try `https://api.fxtwitter.com/i/status/<id>`
   - If `article.content` is populated → render Draft.js-style blocks to markdown (headers, lists, blockquotes, bold, links, mentions, code blocks via `MARKDOWN` entity). This is the path that recovers X Article long-form bodies.
   - If only `text` / `raw_text` / `note_tweet` populated → emit plain body
3. If fxtwitter is down, fall back to `https://api.vxtwitter.com/Twitter/status/<id>`
   - Plain tweets: fine
   - X Articles: vxtwitter returns only `article.preview_text` (~200 chars). The renderer surfaces the preview PLUS an `INCOMPLETE_SOURCE_WARNING` marker. Treat as incomplete — do not ship an SP based on a preview.
4. Both failed / empty body → stderr `INCOMPLETE_SOURCE: <reason>`, exit 2

## Anti-patterns (do not do these, they will bite you)

- **`WebFetch` on x.com** — blocked in most Claude Code sandboxes (402/403). Skip it.
- **`curl https://x.com/...`** — returns React SSR shell with no body text.
- **`curl https://x.com/i/article/<id>`** — same React shell.
- **`playwright-cli goto x.com/...`** — the gu-log sandbox blocks external HTTPS, `goto` hangs on `domcontentloaded`. Even with the route-abort workaround, x.com auth-walls anonymous browsers.
- **Reading only `tweet.text` from vxtwitter for a long-form article** — the body is NOT in `text`; it's in `article` (truncated to preview). Silent data loss. This used to be the default path via the old `fetch-x-api-fallback.sh` and caused SPs that quoted 200 chars of a 2000-char article.
- **Assuming an empty `text` field means an empty tweet** — when `text` is a `t.co` link and `article` is populated, the body lives in `article.content.blocks`.

## Quick sanity checks after fetching

Before piping the output into a translation prompt, verify:

```bash
OUT=$(bash scripts/fetch-x-article.sh "$URL")
echo "$OUT" | head -3   # should show @handle, date, Source URL
echo "$OUT" | wc -l     # body length sanity — single-digit line count = suspicious
echo "$OUT" | grep -c "INCOMPLETE_SOURCE_WARNING" # 0 expected; 1 = fall back to manual
```

If `wc -l` is tiny and you expected a long article, the tweet probably wraps an X Article that fxtwitter didn't return blocks for — rerun with `--json` and inspect `tweet.article` directly.

## Why fxtwitter and not the OpenClaw x-tweet-fetcher skill

The OpenClaw [x-tweet-fetcher](https://github.com/ythx-101/x-tweet-fetcher) skill is the right tool on a VPS with Playwright and outbound network. In the gu-log sandbox (Claude Code on the web, or any locked-down box):

- Playwright can't reach x.com (external HTTPS blocked)
- Public Nitter instances are mostly dead as of 2026
- fxtwitter's JSON endpoint is not blocked, needs no auth, and returns full X Article bodies

For the VPS-Clawd path, the OpenClaw skill is a better long-term answer. For this repo's Claude Code path, `fetch-x-article.sh` is the only thing that works — so use it.

## What to do on INCOMPLETE_SOURCE

Per `CONTRIBUTING.md`'s Source Completeness section: **stop writing**. Do not fill in gaps from memory or Clawd's guess at what the tweet probably said. Either:

1. Retry later (transient fxtwitter outage is possible)
2. Ask the user to paste the body directly
3. Skip this SP / drop from queue
