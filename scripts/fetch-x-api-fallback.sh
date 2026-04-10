#!/usr/bin/env bash
set -euo pipefail

TWEET_URL="${1:-}"
if [ -z "$TWEET_URL" ]; then
  echo "Usage: $0 <tweet_url>" >&2
  exit 1
fi

extract_status_id() {
  local url="$1"
  printf '%s' "$url" | sed -nE 's#.*status(es)?/([0-9]+).*#\2#p' | head -n1
}

STATUS_ID="$(extract_status_id "$TWEET_URL")"
if [ -z "$STATUS_ID" ]; then
  echo "ERROR: failed to extract tweet status id from URL: $TWEET_URL" >&2
  exit 1
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

curl -fsSL --retry 2 --retry-delay 1 --max-time 30 \
  "https://api.vxtwitter.com/Twitter/status/${STATUS_ID}" > "$TMP_JSON"

python3 - "$TMP_JSON" "$TWEET_URL" <<'PY'
import json
import re
import sys
from datetime import datetime
from pathlib import Path

json_path = Path(sys.argv[1])
default_url = sys.argv[2]

data = json.loads(json_path.read_text())
tweet = data.get("tweet") if isinstance(data, dict) and isinstance(data.get("tweet"), dict) else data
if not isinstance(tweet, dict):
    raise SystemExit("ERROR: invalid API payload")


def pick_text(obj):
    if not isinstance(obj, dict):
        return ""
    raw = obj.get("raw_text")
    if isinstance(raw, dict) and raw.get("text"):
        return str(raw["text"]).strip()
    for key in ("text", "full_text"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def pick_author_handle(obj):
    if not isinstance(obj, dict):
        return ""
    for key in ("user_screen_name", "screen_name", "username"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip().lstrip("@")
    author = obj.get("author")
    if not isinstance(author, dict):
        return ""
    for key in ("screen_name", "username"):
        val = author.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip().lstrip("@")
    return ""


def pick_url(obj, fallback=""):
    if not isinstance(obj, dict):
        return fallback
    for key in ("url", "tweetURL", "tweet_url"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return fallback


def pick_date(obj):
    if not isinstance(obj, dict):
        return ""
    raw = obj.get("created_at") or obj.get("date")
    if not raw:
        return ""
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw).strftime("%Y-%m-%d")
    raw = str(raw).strip()
    for fmt in (
        "%a %b %d %H:%M:%S %z %Y",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", raw)
    return m.group(1) if m else ""


def render_block(title, obj, fallback_url=""):
    handle = pick_author_handle(obj)
    text = pick_text(obj)
    if not handle or not text:
        return []
    date = pick_date(obj) or "unknown-date"
    url = pick_url(obj, fallback_url)
    lines = [title, f"@{handle} — {date}"]
    if url:
        lines.append(f"Source URL: {url}")
    lines.append(text)
    return lines

main_handle = pick_author_handle(tweet)
main_text = pick_text(tweet)
if not main_handle or not main_text:
    raise SystemExit("ERROR: API payload missing main tweet text/handle")

main_date = pick_date(tweet) or "unknown-date"
main_url = pick_url(tweet, default_url)
quote = tweet.get("quote") if isinstance(tweet.get("quote"), dict) else data.get("qrt")

if isinstance(quote, dict) and not quote.get("author") and data.get("qrt") is quote:
    quote_handle = quote.get("user_screen_name")
    if quote_handle:
        quote["author"] = {"screen_name": quote_handle}
    if quote.get("tweetURL") and not quote.get("url"):
        quote["url"] = quote["tweetURL"]

format_flags = []
if tweet.get("is_note_tweet"):
    format_flags.append("note tweet")
if isinstance(quote, dict):
    format_flags.append("quote tweet")

out = [f"@{main_handle} — {main_date}"]
if main_url:
    out.append(f"Source URL: {main_url}")
if format_flags:
    out.append(f"Format: {' / '.join(format_flags)}")

quote_lines = render_block("=== QUOTED TWEET ===", quote, "")
if quote_lines:
    out.append("")
    out.extend(quote_lines)
    out.append("")
    out.append("---")

out.append("")
out.append("=== MAIN TWEET ===")
out.append(main_text)

print("\n".join(out).strip())
PY
