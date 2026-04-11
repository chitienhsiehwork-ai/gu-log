# Review: Article Dedup Strategy

**Reviewer**: reviewer-dedup
**Date**: 2026-04-08
**Spec**: `specs/article-dedup-strategy.md`
**Commits reviewed**: `50dc2414` (dedup-gate), `1e27914a` + `80e7d9ba` (dedup-cleanup)

---

## Verdict: PASS (Phase 1 + 2) / NOT BUILT (Phase 3)

Phase 1 (gate) and Phase 2 (cleanup) are solid. Phase 3 (validate-posts + CI) was not built by either builder.

---

## Gate Implementation (dedup-gate.mjs) — PASS

### [x] CLI params: --url, --title, --tags, --series — PASS
**Evidence**: `parseArgs()` at L366-418 handles all four flags + `--queue` and `--dry-run`.

### [x] Layer 1: URL normalization + tweet ID extraction — PASS
**Evidence**: `normalizeUrl()` L75-123 strips www/m, utm params, trailing slash. `extractTweetId()` L126-130 extracts status ID from x.com/twitter.com URLs.

### [x] Layer 1: Known alias map (anthropic.com <-> claude.com) — PASS
**Evidence**: `URL_ALIASES` L60-73 maps claude.com/blog/auto-mode <-> anthropic.com/engineering/claude-code-auto-mode, plus www normalization.

### [x] Layer 2: Compound token strategy — PASS
**Evidence**: `COMPOUND_TOKENS` L43-52 defines `claude-code`, `agent-teams`, `auto-mode`, `vibe-coding`. `applyCompounds()` L138-146 replaces these before tokenization. `DOMAIN_STOP_WORDS` only demote standalone occurrences (L183: compound tokens with hyphens are preserved).

### [x] Layer 2: Cross-series check — PASS
**Evidence**: `loadPublishedArticles()` L228-263 loads ALL zh-tw articles regardless of series. `layer2Match()` L290-318 compares against the full list.

### [x] Layer 2: MIN_EN_OVERLAP=2, REJECT=0.30, FLAG=0.18 — PASS
**Evidence**: L37-38: `REJECT_THRESHOLD = 0.3`, `FLAG_THRESHOLD = 0.18`, `MIN_EN_OVERLAP = 2`.

### [x] Layer 3: Intra-queue pairwise comparison — PASS
**Evidence**: `layer3QueueCheck()` L326-362 does N^2 pairwise URL + topic similarity check.

Test run:
```
$ node scripts/dedup-gate.mjs --queue '{"url":"https://example.com/a","title":"Claude Code Tips","tags":["claude-code"]}' '{"url":"https://example.com/a","title":"Something else","tags":[]}' --dry-run
BLOCK: Queue item[1] is duplicate of item[0] (URL match)
```

### [x] --dry-run flag — PASS
**Evidence**: L440-443, L460-461, L470-471: `--dry-run` overrides exit code to 0.

### [x] Exit code 1 for BLOCK, 0 for PASS/WARN — PASS
**Evidence**: L460 `process.exit(1)` for URL BLOCK, L470 for topic BLOCK, L481 `process.exit(0)` for PASS, L478 for WARN.

### Regression tests with known duplicates — PASS

```
$ node scripts/dedup-gate.mjs --url "https://x.com/AndrewYNg/status/2031051809499054099" --title "test" --tags "" --series CP --dry-run
BLOCK: Duplicate of SP-111 (tweet ID match): Andrew Ng 推出 Context Hub：幫 Coding Agent 補上最新 API 文件

$ node scripts/dedup-gate.mjs --url "https://twitter.com/karpathy/status/2037200624450936940" --title "test" --tags "" --series CP --dry-run
BLOCK: Duplicate of CP-235 (tweet ID match): Karpathy：寫 Code 是最簡單的部分，組裝 IKEA 傢俱才是地獄

$ node scripts/dedup-gate.mjs --url "https://example.com/new" --title "Claude Code Auto Mode" --tags "claude-code" --series CP --dry-run
BLOCK: Duplicate of SP-127 (topic similarity: 0.467): Claude Code Auto Mode：讓 AI 自己判斷哪些指令該擋、哪些放行

$ node scripts/dedup-gate.mjs --url "https://example.com/new" --title "totally unique article about quantum computing" --tags "quantum" --series SP --dry-run
PASS
```

All known duplicate groups correctly blocked. Unique topic correctly passes.

---

## Pipeline Integration — PASS

### [x] clawd-picks-prompt.md Step 3.5 — PASS
**Evidence**: Lines 37-51 in `scripts/clawd-picks-prompt.md` contain "Step 3.5: Dedup Gate" with the correct `node scripts/dedup-gate.mjs` command template and BLOCK/WARN/PASS handling instructions.

### [x] sp-pipeline.sh dedup gate before translation — PASS
**Evidence**: Lines 838-857 in `scripts/sp-pipeline.sh` — "Step 1.7: dedup gate" runs before Step 2 (Write Draft). BLOCK causes `exit 1`. WARN logs but continues.

### [x] Both pipelines BLOCK verdict stops the flow — PASS
- CP: Step 3.5 instructs "BLOCK -> 換一篇推文" (mandatory stop)
- SP: L846 `exit 1` on BLOCK

### Minor finding: sp-pipeline.sh missing --tags
SP pipeline does not pass `--tags` to dedup-gate (L840-843), while the spec example includes `--tags "$TAGS"`. Impact is low — title alone catches the known duplicates — but tags would improve matching accuracy for borderline cases.

---

## Existing Duplicates (7 Groups) — PASS

All 8 articles deprecated across 7 groups with correct frontmatter:

| Group | Deprecated | deprecatedBy | deprecatedReason | Correct? |
|-------|-----------|-------------|------------------|----------|
| 1 | CP-250 | SP-127 | Same topic, SP deeper | PASS |
| 1 | CP-261 | SP-127 | Same topic, SP deeper | PASS |
| 2 | CP-218 | CP-235 | CP-235 covers full blog post | PASS |
| 3 | CP-238 | SP-138 | Same tweet, SP curated | PASS |
| 4 | CP-66 | SP-50 | Same tweet, SP curated | PASS |
| 5 | CP-156 | CP-151 | CP-151 higher quality + cross-links | PASS |
| 6 | CP-160 | SP-111 | Same tweet, SP curated | PASS |
| 7 | SP-35 | SP-105 | SP-105 more comprehensive | PASS |

All deprecated articles have `status: "deprecated"`, `deprecatedReason`, and `deprecatedBy` fields.

---

## Deprecated Article UI — PASS

### [x] PostStatusBanner component — PASS
**Evidence**: `src/components/PostStatusBanner.astro` renders deprecation notice with zh-tw/en labels and link to replacement article.

### [x] Deprecated articles filtered from listings — PASS
**Evidence**: `getPublishedPosts()` in `src/utils/post-status.ts:93-97` filters to `status === 'published'` only. `getListablePosts()` L99-104 excludes deprecated. Used across ALL listing pages (index, series pages, tags, RSS, search index — 15+ usages confirmed).

### [x] EN posts inherit deprecation from zh-tw pair — PASS
**Evidence**: `resolvePostStatus()` L55-82 checks the zh-tw translation pair for EN posts, inheriting non-published status.

---

## Build — PASS

```
$ pnpm run build
[build] 2667 page(s) built in 36.14s
[build] Complete!
```

No errors.

---

## NOT BUILT (Phase 3)

### [ ] `validate-posts.mjs --check-duplicates` — NOT IMPLEMENTED
`validate-posts.mjs` has no `--check-duplicates` flag. This was spec Phase 3.

### [ ] CI integration (PR check) — NOT IMPLEMENTED
No dedup-related checks in `.github/workflows/`. This was spec Phase 3.

These were not assigned to either builder per the CTO's task breakdown (only Phases 1+2 were assigned).

---

## Summary

| Area | Verdict |
|------|---------|
| dedup-gate.mjs (Layer 1/2/3) | PASS |
| Pipeline integration (CP + SP) | PASS |
| 7 duplicate groups cleaned up | PASS |
| PostStatusBanner + listing filter | PASS |
| Build | PASS |
| validate-posts --check-duplicates | NOT BUILT |
| CI integration | NOT BUILT |

**Minor finding**: sp-pipeline.sh doesn't pass `--tags` to dedup-gate (low impact).
**Phase 3 gap**: validate-posts integration and CI check were not in scope for these two builders.
