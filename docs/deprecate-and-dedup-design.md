# Deprecate & Dedup Design (Issue #57 + CP-239/SP-157 conflict)

> Created: 2026-04-03 by ShroomClawd
> Status: DRAFT — awaiting Sprin review

## Problem

1. **CP-239 and SP-157 cover the same topic** (Anthropic emotion vectors research) but from different source URLs (tweet vs research page). URL-level dedup didn't catch it because the URLs are different.
2. **No mechanism to retire/deprecate** a published post when a better version exists.
3. **184 posts have no ralph scores** — no gate prevented them from being published.

## Part 1: Deprecate Mechanism

### Frontmatter field

```yaml
deprecated: true
deprecatedBy: "SP-157"  # ticketId of the replacement post
deprecatedReason: "Superseded by deeper analysis from same source"
```

### Behavior

- **Build**: deprecated posts are **still built** (URLs remain valid for SEO/bookmarks)
- **Listing pages**: deprecated posts are **hidden** from home, tag pages, and search index
- **Post page**: shows a banner at top: "⚠️ 這篇文章已被更完整的版本取代 → [SP-157 title](link)"
- **RSS**: excluded from feed
- **Scores**: preserved as-is (historical record)

### Implementation

1. Add `deprecated` / `deprecatedBy` to Astro content schema
2. Filter deprecated posts from collection queries in listing pages
3. Add deprecation banner component to post layout
4. Filter from search index build
5. Filter from RSS generation

## Part 2: Topic-Level Dedup (Prevention)

Current dedup only matches **exact URL**. Need **topic-level matching**.

### Layer 1: `existing-articles.txt` enrichment

Currently: `ticketId | title | sourceUrl | sourceHandle`

Proposed: `ticketId | title | sourceUrl | sourceHandle | tags | summary_hash`

- `tags`: from frontmatter, comma-separated
- `summary_hash`: first 100 chars of summary, lowercased

This gives Gemini more signal to match on topic overlap, not just URL.

### Layer 2: Deterministic pre-check in `sp-pipeline.sh`

Before starting any pipeline run, do a fast check:

```bash
# Extract key terms from source URL/title
# Compare against published posts using:
#   1. URL domain + path similarity (fuzzy)
#   2. Tag overlap (≥3 shared tags = warning)
#   3. Title cosine similarity (TF-IDF, deterministic)
```

New script: `scripts/topic-dedup-check.sh <source_url> <title>`

- Returns: `OK` / `WARN: possible overlap with SP-XXX (reason)`
- Pipeline shows warning but doesn't block (human/agent decides)
- CP Writer treats WARN as skip (automated = conservative)

### Layer 3: Shroom Feed prompt strengthening

Add to Gemini scan prompt:
```
## Topic Dedup（不只看 URL）
- 兩篇文章引用同一篇 research/blog = 同一個 topic
- Tweet 討論 X 的 research paper，而 research paper 本身已有文章 = 重複
- 判斷依據：EXISTING_ARTICLES 的 title + tags + sourceUrl domain
- 例：SP-157 (anthropic.com/research/emotion-concepts-function) 和 tweet about @AnthropicAI emotion research = 同主題
```

### Layer 4: CP Writer gate

In `cp-writer.md` onboard, add after Step 1 dedup:

```bash
# Topic dedup: check if selected candidate overlaps with existing posts
node scripts/topic-dedup-check.mjs "$CANDIDATE_URL" "$CANDIDATE_TITLE"
```

If overlap detected → skip to next candidate in queue.

## Part 3: Pre-commit Score Gate ✅ DONE

Added `Step 0.1` to pre-commit hook:
- Blocks commits of zh-tw posts without `scores.ralph` (p, c, v)
- `en-` translations are exempt
- Bypass: `git commit --no-verify`

## Priority & Sequence

| Step | What | Effort | Impact |
|------|-------|--------|--------|
| A ✅ | Pre-commit score gate | 30min | Prevents future scoreless posts |
| D.1 | Deprecate CP-239 (manual, immediate) | 10min | Fixes current conflict |
| D.2 | Deprecate frontmatter + UI | 2-3hr | Reusable mechanism |
| D.3 | topic-dedup-check.sh | 2hr | Deterministic prevention |
| D.4 | Enrich existing-articles.txt + prompts | 1hr | Better AI-level dedup |
| C | Backfill 184 scoreless posts | daemon job | Fills gaps |
| B | Tribunal iteration loop | 4-6hr | Full quality pipeline |

## Immediate Action: Deprecate CP-239

```bash
# Add deprecated frontmatter to CP-239 (zh + en)
# CP-239 covered same Anthropic emotion research as SP-157, but shallower (88 vs 190 lines)
```
