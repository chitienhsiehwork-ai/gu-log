#!/usr/bin/env bash
# scripts/fetch-x-article.sh
#
# Fetch full tweet / X Article content via fxtwitter, then X's guest GraphQL
# API when public mirrors are incomplete or degraded.
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
# With --json: emits the fetched JSON payload. Guest GraphQL results are
# normalized to the same fxtwitter-like shape for downstream tooling.
#
# Fallbacks:
#   1. api.fxtwitter.com  (primary — returns article blocks when healthy)
#   2. X guest GraphQL TweetResultByRestId (X Article full body fallback)
#   3. api.vxtwitter.com  (plain tweets only; NOT used for X Article bodies)
#   4. Hard fail with `INCOMPLETE_SOURCE: <reason>` (exit 2) per CONTRIBUTING.md
#      pipeline contract. Callers should honour this and not guess.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TWEET_URL=""
MODE="text"
# Thread reconstruction is on by default: a dropped thread URL should capture
# the whole self-thread, not just tweet #1. Disable with --no-thread or
# GU_LOG_X_FETCH_THREAD=0 (e.g. when a caller only wants the focal tweet).
THREAD_ENABLED=1
if [ "${GU_LOG_X_FETCH_THREAD:-}" = "0" ]; then
  THREAD_ENABLED=0
fi
for arg in "$@"; do
  case "$arg" in
    --json) MODE="json" ;;
    --no-thread) THREAD_ENABLED=0 ;;
    --thread) THREAD_ENABLED=1 ;;
    -*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) [ -z "$TWEET_URL" ] && TWEET_URL="$arg" ;;
  esac
done

if [ -z "$TWEET_URL" ]; then
  echo "Usage: $0 <tweet_url> [--json] [--no-thread]" >&2
  exit 1
fi

extract_status_id() {
  local url="$1"
  printf '%s' "$url" | sed -nE 's#.*status(es)?/([0-9]+).*#\2#p' | head -n1
}

extract_handle() {
  local url="$1"
  printf '%s' "$url" | sed -nE 's#https?://(www\.)?(twitter|x)\.com/([^/?#]+)/status.*#\3#p' | head -n1
}

STATUS_ID="$(extract_status_id "$TWEET_URL")"
if [ -z "$STATUS_ID" ]; then
  echo "INCOMPLETE_SOURCE: failed to extract status id from URL: $TWEET_URL" >&2
  exit 2
fi

HANDLE="$(extract_handle "$TWEET_URL")"

TMP_JSON="$(mktemp)"
CURL_ERR="$(mktemp)"
trap 'rm -f "$TMP_JSON" "$CURL_ERR"' EXIT

# Validate the fxtwitter payload sitting in $TMP_JSON. fxtwitter sometimes
# returns code:200 with a placeholder tweet that has no text/article — reject
# those so we fall through to the next path instead of silently emitting an
# empty body.
fxtwitter_payload_ok() {
  python3 - "$TMP_JSON" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
if d.get("code") != 200:
    sys.exit(1)
t = d.get("tweet") or {}
if not t:
    sys.exit(1)
# Must have either a populated article or some kind of textual body.
art = t.get("article") or {}
has_article = bool(art.get("content") or art.get("preview_text"))
rt = t.get("raw_text") or {}
has_text = bool((rt.get("text") or "").strip()) or bool((t.get("text") or "").strip()) or bool((t.get("full_text") or "").strip())
sys.exit(0 if (has_article or has_text) else 1)
PY
}

# fxtwitter call shared flags. --retry-max-time caps total retry window so a
# persistently-flaky fxtwitter doesn't stall the pipeline; --max-time bounds
# each individual attempt. curl already retries 408/429/5xx by default.
fxtwitter_curl() {
  curl -fsSL --retry 5 --retry-delay 2 --retry-max-time 45 --max-time 20 \
    -H 'User-Agent: gu-log/fetch-x-article (+https://gu-log.vercel.app)' \
    "$1" > "$TMP_JSON" 2>>"$CURL_ERR"
}

# X Article fallback: fetch through X's public guest-token GraphQL surface.
# This is deliberately cookie-free. The logged-in cookie route can be temporary
# locked even when the public guest route can still read the article body.
guest_graphql_fetch() {
  python3 - "$STATUS_ID" "$TWEET_URL" > "$TMP_JSON" 2>>"$CURL_ERR" <<'PY'
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

status_id = sys.argv[1]
default_url = sys.argv[2]

BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def fetch(url, *, method="GET", headers=None, body=None, timeout=20):
    req = Request(url, data=body, method=method, headers=headers or {})
    with urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


base_headers = {
    "authorization": f"Bearer {BEARER}",
    "user-agent": UA,
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": "https://x.com",
    "referer": "https://x.com/",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
}


def activate_guest():
    status, text = fetch(
        "https://api.twitter.com/1.1/guest/activate.json",
        method="POST",
        headers=base_headers,
        body=b"",
        timeout=15,
    )
    if status != 200:
        raise RuntimeError(f"guest activate HTTP {status}")
    token = (json.loads(text).get("guest_token") or "").strip()
    if not token:
        raise RuntimeError("guest activate returned no guest_token")
    return token


def discover_query_id():
    """Find the current TweetResultByRestId query id from X's JS bundles."""
    candidates = [
        "https://x.com/?lang=en",
        "https://x.com/explore",
    ]
    bundle_urls = []
    seen = set()
    for page in candidates:
        try:
            _, html = fetch(page, headers={"user-agent": UA, "accept": "text/html"}, timeout=15)
        except Exception:
            continue
        for path in re.findall(r'https://abs\.twimg\.com/responsive-web/client-web/[^"\']+?\.js', html):
            if path not in seen:
                seen.add(path)
                # main.*.js almost always contains operation metadata; try it first.
                if "/main." in path:
                    bundle_urls.insert(0, path)
                else:
                    bundle_urls.append(path)
    for bundle in bundle_urls[:12]:
        try:
            _, js = fetch(bundle, headers={"user-agent": UA, "accept": "application/javascript,*/*"}, timeout=20)
        except Exception:
            continue
        m = re.search(r'queryId:"([^"]+)",operationName:"TweetResultByRestId"', js)
        if m:
            return m.group(1)
    return None


features = {
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "premium_content_api_read_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": False,
    "responsive_web_grok_analyze_post_followups_enabled": False,
    "responsive_web_jetfuel_frame": True,
    "responsive_web_grok_share_attachment_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_grok_image_annotation_enabled": True,
    "responsive_web_grok_imagine_annotation_enabled": True,
    "responsive_web_grok_community_note_auto_translation_is_enabled": False,
    "responsive_web_enhance_cards_enabled": False,
    "responsive_web_twitter_article_plain_text_enabled": True,
}
field_toggles = {
    "withArticleRichContentState": True,
    "withArticlePlainText": True,
    "withArticleSummaryText": True,
    "withArticleVoiceOver": True,
    "withGrokAnalyze": False,
    "withDisallowedReplyControls": False,
}
variables = {
    "tweetId": status_id,
    "withCommunity": True,
    "includePromotedContent": True,
    "withVoice": True,
}


def query_tweet(query_id, guest_token):
    headers = dict(base_headers)
    headers["x-guest-token"] = guest_token
    params = urlencode({
        "variables": json.dumps(variables, separators=(",", ":")),
        "features": json.dumps(features, separators=(",", ":")),
        "fieldToggles": json.dumps(field_toggles, separators=(",", ":")),
    })
    url = f"https://x.com/i/api/graphql/{query_id}/TweetResultByRestId?{params}"
    status, text = fetch(url, headers=headers, timeout=25)
    if status != 200:
        raise RuntimeError(f"TweetResultByRestId HTTP {status}")
    return json.loads(text)


def get_path(obj, *keys):
    cur = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def transform(data):
    result = get_path(data, "data", "tweetResult", "result") or {}
    if result.get("__typename") != "Tweet":
        raise RuntimeError(f"unexpected tweet typename: {result.get('__typename')}")
    legacy = result.get("legacy") or {}
    user = get_path(result, "core", "user_results", "result") or {}
    user_core = user.get("core") or {}
    article_result = get_path(result, "article", "article_results", "result")
    article = None
    if isinstance(article_result, dict):
        content = article_result.get("content_state") or {}
        article = {
            "title": article_result.get("title") or "",
            "content": content,
            "plain_text": article_result.get("plain_text") or "",
            "preview_text": article_result.get("preview_text") or "",
            "summary_text": article_result.get("summary_text") or "",
        }
    return {
        "code": 200,
        "message": "OK",
        "tweet": {
            "url": default_url,
            "id": result.get("rest_id") or legacy.get("id_str") or status_id,
            "text": legacy.get("full_text") or "",
            "raw_text": {"text": legacy.get("full_text") or ""},
            "author": {
                "screen_name": user_core.get("screen_name") or "",
                "name": user_core.get("name") or "",
            },
            "created_at": legacy.get("created_at") or "",
            "article": article,
        },
        "_x_guest_graphql": True,
    }


try:
    guest = activate_guest()
    query_ids = ["2Acdg-VztGlHX7MjX67Ysw"]
    discovered = discover_query_id()
    if discovered and discovered not in query_ids:
        query_ids.insert(0, discovered)
    last_error = None
    for qid in query_ids:
        try:
            payload = transform(query_tweet(qid, guest))
            print(json.dumps(payload, ensure_ascii=False))
            sys.exit(0)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"guest GraphQL failed: {last_error}")
except (HTTPError, URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
    print(f"guest GraphQL failed: {exc}", file=sys.stderr)
    sys.exit(2)
PY
}

# Primary: fxtwitter via handle path (different upstream cache key than
# `/i/status/<id>`; in practice the two endpoints flap independently, so
# trying both raises success rate when fxtwitter is partially degraded).
FETCHED_FROM=""
if [ "${GU_LOG_X_FETCH_SKIP_MIRRORS:-}" != "1" ] && [ -n "$HANDLE" ]; then
  if fxtwitter_curl "https://api.fxtwitter.com/${HANDLE}/status/${STATUS_ID}" \
    && fxtwitter_payload_ok; then
    FETCHED_FROM="fxtwitter"
  fi
fi

# Secondary fxtwitter path: handle-agnostic.
if [ "${GU_LOG_X_FETCH_SKIP_MIRRORS:-}" != "1" ] && [ -z "$FETCHED_FROM" ]; then
  if fxtwitter_curl "https://api.fxtwitter.com/i/status/${STATUS_ID}" \
    && fxtwitter_payload_ok; then
    FETCHED_FROM="fxtwitter"
  fi
fi

# X Article fallback: if public mirrors are empty/partial, use the public guest
# GraphQL route and request article rich/plain text directly from X.
if [ -z "$FETCHED_FROM" ]; then
  if guest_graphql_fetch && fxtwitter_payload_ok; then
    FETCHED_FROM="x-guest-graphql"
  fi
fi

# Last resort: vxtwitter (plain tweets only). vxtwitter has a different shape, so
# we wrap it so the renderer can treat it uniformly as a fxtwitter-like
# payload with only `tweet.text`.
if [ -z "$FETCHED_FROM" ]; then
  if curl -fsSL --retry 3 --retry-delay 2 --max-time 20 \
    "https://api.vxtwitter.com/Twitter/status/${STATUS_ID}" > "$TMP_JSON" 2>>"$CURL_ERR"; then
    if python3 - "$TMP_JSON" <<'PY'
import json, sys
p = sys.argv[1]
try:
    raw = json.load(open(p))
except Exception as e:
    # vxtwitter sometimes returns its HTML homepage instead of JSON when the
    # tweet doesn't exist or the upstream is degraded. Bail cleanly so the
    # caller sees INCOMPLETE_SOURCE rather than a Python traceback.
    print(f"vxtwitter returned non-JSON: {e}", file=sys.stderr)
    sys.exit(2)
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
    then
      FETCHED_FROM="vxtwitter"
    fi
  fi
fi

if [ -z "$FETCHED_FROM" ]; then
  echo "INCOMPLETE_SOURCE: both fxtwitter and vxtwitter failed for status ${STATUS_ID}" >&2
  if [ -s "$CURL_ERR" ]; then
    echo "--- curl stderr ---" >&2
    cat "$CURL_ERR" >&2
  fi
  exit 2
fi

# X-Article wrapper detection on the vxtwitter path: vxtwitter NEVER returns
# article body blocks, only `preview_text` (~200 chars). If we got here on
# vxtwitter and the tweet is just a t.co wrapper around an article, refuse to
# emit a partial body — per CONTRIBUTING.md "stop writing" on incomplete
# source. Hard-fail with INCOMPLETE_SOURCE so the pipeline doesn't ship a
# preview-based SP.
if [ "$FETCHED_FROM" = "vxtwitter" ]; then
  if python3 - "$TMP_JSON" <<'PY' 2>/dev/null
import json, re, sys
d = json.load(open(sys.argv[1]))
preview = (d.get("_vxtwitter_preview_text") or "").strip()
title = (d.get("_vxtwitter_article_title") or "").strip()
text = ((d.get("tweet") or {}).get("text") or "").strip()
is_wrapper = bool(re.fullmatch(r"https?://\S+", text)) if text else True
sys.exit(0 if (is_wrapper and (preview or title)) else 1)
PY
  then
    echo "INCOMPLETE_SOURCE: tweet wraps an X Article but fxtwitter is unavailable; vxtwitter only returns preview_text. Retry later or paste the article body manually." >&2
    if [ -s "$CURL_ERR" ]; then
      echo "--- curl stderr ---" >&2
      cat "$CURL_ERR" >&2
    fi
    exit 2
  fi
fi

if [ "$MODE" = "json" ]; then
  cat "$TMP_JSON"
  exit 0
fi

# Thread reconstruction (text mode only). If the focal tweet is the head/middle
# of a self-thread, the single-tweet render above only captures one tweet and
# silently drops the rest. fetch-x-thread.py walks the author's timeline and
# rebuilds the whole chain via the guest GraphQL UserTweets route (the only
# thread-capable route that works cookie-free in this sandbox). It is
# best-effort: exit 3 = "not a thread / article / aged out", any other failure
# also falls through to the single-tweet render below, so this can never regress
# a capture that previously worked.
#
# Skip the probe entirely for X Articles — those are single long-form tweets and
# the article renderer below handles them; probing would just add latency.
focal_is_article() {
  python3 - "$TMP_JSON" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
art = (d.get("tweet") or {}).get("article") or {}
sys.exit(0 if (art.get("content") or art.get("preview_text")) else 1)
PY
}

if [ "$THREAD_ENABLED" = "1" ] && ! focal_is_article; then
  if THREAD_OUT="$(python3 "$SCRIPT_DIR/fetch-x-thread.py" "$TWEET_URL" 2>/dev/null)" \
    && [ -n "$THREAD_OUT" ]; then
    printf '%s\n' "$THREAD_OUT"
    exit 0
  fi
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
