---
name: x-source-fetch
description: Fetch the full focal body of an X / Twitter post or X Article for GP/MP translation before gp-pipeline runs, with best-effort self-thread reconstruction. Fail loudly when the focal source is incomplete instead of writing from a preview snippet.
---

# x-source-fetch

Fetch an X URL's full translatable body, or fail loud. One script, one contract.

## When to use

- User drops an `https://x.com/...` or `https://twitter.com/...` URL and asks for a GP or MP
- `gp-pipeline run <url>` (the Go binary in `tools/gp-pipeline/`) or `gp-pipeline fetch <url>` is the natural next step and the source capture stage needs the body
- Any time "I need the tweet content but curl returns gibberish"

> **Note**: the canonical entry point is `tools/gp-pipeline/gp-pipeline run <url>`. Its `fetch <url>` subcommand internally calls `scripts/fetch-x-article.sh` — the same helper this skill documents. If you only need the raw capture for manual inspection, `bash scripts/fetch-x-article.sh <url>` is the most direct path.

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

Output for a self-thread (author's chain of consecutive self-replies):

```
@handle — YYYY-MM-DD
Source URL: https://x.com/handle/status/ID
Fetched via: x-guest-thread
Thread: 3 tweets

=== MAIN TWEET ===
<tweet 1>

=== THREAD 2/3 ===
<tweet 2>

=== THREAD 3/3 ===
<tweet 3>
```

When thread reconstruction succeeds, the output contains the **whole
self-thread** in chronological order, even if the URL points at a tweet in the
middle of the chain (the script resolves the conversation root and pulls every
tweet the author posted in it). `t.co` shortlinks are expanded to their real
targets. Thread reconstruction is on by default; pass `--no-thread` (or
`GU_LOG_X_FETCH_THREAD=0`) to capture only the focal tweet.

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
   - X Articles: vxtwitter returns only `article.preview_text` (~200 chars). The renderer surfaces the preview PLUS an `INCOMPLETE_SOURCE_WARNING` marker. Treat as incomplete — do not ship a GP based on a preview.
4. Both failed / empty body → stderr `INCOMPLETE_SOURCE: <reason>`, exit 2

**Thread step (text mode, unless `--no-thread`)**: after the focal tweet is in
hand and it is *not* an X Article, `scripts/fetch-x-thread.py` rebuilds the full
self-thread. It tries two routes, in order:

1. **Guest GraphQL `UserTweets`** — pull the author's recent tweets, keep every
   one sharing the focal `conversation_id_str`, sort by tweet id (Snowflake ids
   are time-ordered). fxtwitter has no thread field, and `TweetDetail` /
   `UserTweetsAndReplies` / `SearchTimeline` all 404 for guest tokens, so this is
   the only *X-native* cookie-free thread route. **Caveat (verified 2026-06): the
   guest `UserTweets` timeline is ~1 year stale and has no pagination cursor**, so
   any thread newer than ~12 months is absent from it and this route comes back
   empty. That makes route 2 the workhorse for freshly-dropped thread URLs.
2. **Thread Reader App fallback** (`Fetched via: threadreader`) — when route 1
   yields <2 tweets (or guest GraphQL is down entirely), fetch
   `https://threadreaderapp.com/thread/<root_id>.html` and parse the unroll.
   Self-contained: handle, date and every tweet body come from that one page, no
   guest token needed. TR only has a page if someone previously unrolled the
   thread, so it's still best-effort.

If both routes find ≥2 author tweets the whole thread is rendered; otherwise
(single tweet / X Article / no TR unroll) it exits 3 and the single-tweet render
is used. Best-effort throughout: any failure silently degrades to the
single-tweet capture, so it can never regress a fetch that previously worked.

## Anti-patterns (do not do these, they will bite you)

- **`WebFetch` on x.com** — blocked in most Claude Code sandboxes (402/403). Skip it.
- **`curl https://x.com/...`** — returns React SSR shell with no body text.
- **`curl https://x.com/i/article/<id>`** — same React shell.
- **`playwright-cli goto x.com/...`** — the gu-log sandbox blocks external HTTPS, `goto` hangs on `domcontentloaded`. Even with the route-abort workaround, x.com auth-walls anonymous browsers.
- **Reading only `tweet.text` from vxtwitter for a long-form article** — the body is NOT in `text`; it's in `article` (truncated to preview). Silent data loss. This used to be the default path via the old `fetch-x-api-fallback.sh` and caused GPs that quoted 200 chars of a 2000-char article.
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

For the VPS-Mogu path, the OpenClaw skill is a better long-term answer. For this repo's Claude Code path, `fetch-x-article.sh` is the only thing that works — so use it.

## What to do on INCOMPLETE_SOURCE

Per `CONTRIBUTING.md`'s Source Completeness section: **stop writing**. Do not fill in gaps from memory or Mogu's guess at what the tweet probably said. Either:

1. Retry later (transient fxtwitter outage is possible)
2. Ask the user to paste the body directly
3. Skip this GP / drop from queue
