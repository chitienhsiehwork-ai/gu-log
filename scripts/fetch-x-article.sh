#!/usr/bin/env bash
# scripts/fetch-x-article.sh
#
# Fetch full tweet / X Article content via the fxtwitter JSON API.
#
# Why not vxtwitter? vxtwitter returns only `article.preview_text` (~200 chars)
# when the tweet wraps an X Article — the body never comes through, so callers
# silently write a post based on a preview snippet. fxtwitter returns the full
# Draft.js-style `article.content.blocks[]`, which we render into markdown.
#
# Why not WebFetch / playwright / bird? WebFetch and raw curl to x.com are
# blocked or return React shell in this sandbox; playwright can't reach x.com;
# bird CLI isn't installed. fxtwitter's JSON endpoint is the only thing that
# works here and it needs no auth.
#
# Usage:
#   bash scripts/fetch-x-article.sh <tweet_url> [--json]
#
# Without --json: emits a human/LLM-readable text block compatible with
# sp-pipeline.sh's validate_tweet_source_capture (handle, date, Source URL,
# === MAIN TWEET === marker).
#
# With --json: emits the raw fxtwitter JSON for downstream tooling.
#
# Fallbacks:
#   1. api.fxtwitter.com  (primary — returns article blocks)
#   2. api.vxtwitter.com  (secondary — plain tweets only; NOT used for articles)
#   3. Hard fail with `INCOMPLETE_SOURCE: <reason>` (exit 2) per CONTRIBUTING.md
#      pipeline contract. Callers should honour this and not guess.

set -euo pipefail

TWEET_URL="${1:-}"
MODE="text"
if [ "${2:-}" = "--json" ]; then
  MODE="json"
fi

if [ -z "$TWEET_URL" ]; then
  echo "Usage: $0 <tweet_url> [--json]" >&2
  exit 1
fi

extract_status_id() {
  local url="$1"
  printf '%s' "$url" | sed -nE 's#.*status(es)?/([0-9]+).*#\2#p' | head -n1
}

STATUS_ID="$(extract_status_id "$TWEET_URL")"
if [ -z "$STATUS_ID" ]; then
  echo "INCOMPLETE_SOURCE: failed to extract status id from URL: $TWEET_URL" >&2
  exit 2
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

# Primary: fxtwitter. `i/status/<id>` is handle-agnostic.
FETCHED_FROM=""
if curl -fsSL --retry 2 --retry-delay 1 --max-time 30 \
  -H 'User-Agent: gu-log/fetch-x-article (+https://gu-log.vercel.app)' \
  "https://api.fxtwitter.com/i/status/${STATUS_ID}" > "$TMP_JSON" 2>/dev/null; then
  if python3 -c "import json,sys; d=json.load(open('$TMP_JSON')); sys.exit(0 if d.get('code')==200 and d.get('tweet') else 1)" 2>/dev/null; then
    FETCHED_FROM="fxtwitter"
  fi
fi

# Secondary: vxtwitter (plain tweets only). Note: vxtwitter has a different
# shape, so we wrap it so the renderer can treat it uniformly as a fxtwitter-
# like payload with only `tweet.text`.
if [ -z "$FETCHED_FROM" ]; then
  if curl -fsSL --retry 2 --retry-delay 1 --max-time 30 \
    "https://api.vxtwitter.com/Twitter/status/${STATUS_ID}" > "$TMP_JSON" 2>/dev/null; then
    python3 - "$TMP_JSON" <<'PY'
import json, sys
p = sys.argv[1]
raw = json.load(open(p))
# vxtwitter returns a flat object; wrap it in fxtwitter-ish shape so the
# renderer downstream can handle both the same way.
wrapped = {
    "code": 200,
    "message": "OK",
    "tweet": {
        "url": raw.get("tweetURL") or raw.get("tweet_url") or "",
        "id": raw.get("tweetID", ""),
        "text": raw.get("text", ""),
        "author": {
            "screen_name": raw.get("user_screen_name", ""),
            "name": raw.get("user_name", ""),
        },
        "created_at": raw.get("date", ""),
        # vxtwitter has no structured article; preview_text only.
        "article": None,
    },
    "_vxtwitter_preview_text": (raw.get("article") or {}).get("preview_text", ""),
    "_vxtwitter_article_title": (raw.get("article") or {}).get("title", ""),
}
json.dump(wrapped, open(p, "w"))
PY
    FETCHED_FROM="vxtwitter"
  fi
fi

if [ -z "$FETCHED_FROM" ]; then
  echo "INCOMPLETE_SOURCE: both fxtwitter and vxtwitter failed for status ${STATUS_ID}" >&2
  exit 2
fi

if [ "$MODE" = "json" ]; then
  cat "$TMP_JSON"
  exit 0
fi

# Render to text. Output contract is aligned with sp-pipeline.sh's
# validate_tweet_source_capture so that function still passes:
#   - Has @handle
#   - Has YYYY-MM-DD date
#   - Has "Source URL:" line
#   - Has "=== MAIN TWEET ===" marker
python3 - "$TMP_JSON" "$TWEET_URL" "$FETCHED_FROM" <<'PY'
import json, re, sys
from datetime import datetime
from pathlib import Path

json_path = Path(sys.argv[1])
default_url = sys.argv[2]
source = sys.argv[3]

data = json.loads(json_path.read_text())
tweet = data.get("tweet") or {}
if not tweet:
    print(f"INCOMPLETE_SOURCE: empty tweet payload (source={source})", file=sys.stderr)
    sys.exit(2)


def pick_handle(t):
    author = t.get("author") or {}
    for key in ("screen_name", "username", "user_screen_name"):
        v = author.get(key) or t.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip().lstrip("@")
    return ""


def pick_date(t):
    raw = t.get("created_at") or t.get("date") or ""
    if not raw:
        return ""
    for fmt in (
        "%a %b %d %H:%M:%S %z %Y",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", raw)
    return m.group(1) if m else ""


def pick_text(t):
    rt = t.get("raw_text")
    if isinstance(rt, dict) and rt.get("text"):
        return str(rt["text"]).strip()
    for k in ("text", "full_text"):
        v = t.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def apply_ranges(text, style_ranges, entity_ranges, entity_map):
    """Apply inline style ranges and entity ranges TOGETHER.

    Both range types use offsets into the ORIGINAL text, so we must not
    mutate the string between passes — otherwise the second pass reads
    shifted offsets and wraps the wrong characters. We merge both into a
    single list of (offset, length, wrap_fn) mutations and apply them in
    descending order of offset.
    """
    if not style_ranges and not entity_ranges:
        return text

    mutations = []

    for r in style_ranges or []:
        off = r.get("offset", 0)
        ln = r.get("length", 0)
        if ln <= 0:
            continue
        style = r.get("style", "")
        if style == "Bold":
            mutations.append((off, ln, lambda s: f"**{s}**"))
        elif style == "Italic":
            mutations.append((off, ln, lambda s: f"*{s}*"))

    for r in entity_ranges or []:
        off = r.get("offset", 0)
        ln = r.get("length", 0)
        if ln <= 0:
            continue
        key = str(r.get("key", ""))
        ent = entity_map.get(key)
        if not ent:
            continue
        etype = ent.get("type", "")
        edata = ent.get("data", {}) or {}
        if etype == "LINK":
            url = edata.get("url") or ""
            if url:
                mutations.append((off, ln, lambda s, u=url: f"[{s}]({u})"))
        elif etype == "MENTION":
            # Mentions are handle substitution; keep original casing.
            mutations.append((off, ln, lambda s: f"@{s.lstrip('@')}"))
        # MEDIA / MARKDOWN / TWEMOJI only appear in atomic blocks (handled there)

    # Sort by offset descending so earlier indices stay valid as we mutate.
    mutations.sort(key=lambda m: -m[0])

    out = text
    for off, ln, fn in mutations:
        seg = out[off:off + ln]
        out = out[:off] + fn(seg) + out[off + ln:]
    return out


def build_entity_map(entity_map_list):
    """fxtwitter's entityMap is a list of {key, value:{type, data}} objects;
    index it by string key for random access."""
    out = {}
    if not isinstance(entity_map_list, list):
        return out
    for item in entity_map_list:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", ""))
        value = item.get("value", {}) or {}
        out[key] = {
            "type": value.get("type", ""),
            "data": value.get("data", {}) or {},
        }
    return out


def render_block(block, entity_map):
    btype = block.get("type", "unstyled")
    raw_text = block.get("text", "") or ""

    # Atomic blocks reference a single entity by entityRanges[0].key.
    if btype == "atomic":
        ranges = block.get("entityRanges") or []
        if not ranges:
            return ""
        key = str(ranges[0].get("key", ""))
        ent = entity_map.get(key, {})
        etype = ent.get("type", "")
        edata = ent.get("data", {}) or {}
        if etype == "MEDIA":
            return "[media]"
        if etype == "MARKDOWN":
            md = edata.get("markdown") or ""
            return md
        if etype == "LINK":
            url = edata.get("url") or ""
            return url
        if etype == "TWEMOJI":
            return ""
        return ""

    rendered = apply_ranges(
        raw_text,
        block.get("inlineStyleRanges") or [],
        block.get("entityRanges") or [],
        entity_map,
    )

    if btype == "header-one":
        return f"# {rendered}"
    if btype == "header-two":
        return f"## {rendered}"
    if btype == "header-three":
        return f"### {rendered}"
    if btype == "unordered-list-item":
        return f"- {rendered}"
    if btype == "ordered-list-item":
        return f"1. {rendered}"
    if btype == "blockquote":
        return f"> {rendered}"
    # unstyled / paragraph / fallback
    return rendered


def render_article(article):
    title = article.get("title", "") or ""
    content = article.get("content") or {}
    blocks = content.get("blocks") or []
    entity_map = build_entity_map(content.get("entityMap"))

    lines = []
    if title:
        lines.append(f"# {title}")
        lines.append("")

    for block in blocks:
        rendered = render_block(block, entity_map)
        # Preserve paragraph spacing but collapse runs of empty atomic/media lines.
        if rendered.strip() or (lines and lines[-1].strip()):
            lines.append(rendered)

    # Strip trailing blank lines
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()


handle = pick_handle(tweet)
date = pick_date(tweet) or "unknown-date"
url = tweet.get("url") or default_url
article = tweet.get("article")

body = ""
if isinstance(article, dict) and article.get("content"):
    body = render_article(article)
else:
    body = pick_text(tweet)
    # vxtwitter fallback: if body is just a wrapped article URL and we have
    # preview_text / title, surface those + an explicit warning marker so the
    # caller can decide whether to treat it as INCOMPLETE_SOURCE.
    if not body or re.fullmatch(r"https?://\S+", body):
        preview = data.get("_vxtwitter_preview_text") or ""
        vtitle = data.get("_vxtwitter_article_title") or ""
        if preview or vtitle:
            body_lines = []
            if vtitle:
                body_lines.append(f"# {vtitle}")
            if preview:
                body_lines.append("")
                body_lines.append(preview)
                body_lines.append("")
                body_lines.append(
                    "INCOMPLETE_SOURCE_WARNING: vxtwitter returned only "
                    "article preview_text; full article body unavailable. "
                    "Rerun with fxtwitter or mark source as incomplete."
                )
            body = "\n".join(body_lines)

if not handle or not body:
    print(
        f"INCOMPLETE_SOURCE: missing handle or body (handle={handle!r}, "
        f"body_len={len(body)}, source={source})",
        file=sys.stderr,
    )
    sys.exit(2)

out = [
    f"@{handle} — {date}",
    f"Source URL: {url}",
    f"Fetched via: {source}",
    "",
    "=== MAIN TWEET ===",
    body,
]
print("\n".join(out).strip())
PY
