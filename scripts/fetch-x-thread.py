#!/usr/bin/env python3
"""scripts/fetch-x-thread.py

Reconstruct an X *self-thread* (an author's chain of consecutive replies to
their own tweet) and render the whole thing as one translatable body.

Why this exists
---------------
`scripts/fetch-x-article.sh` only ever returns the single focal tweet. When a
user drops a thread URL (e.g. https://x.com/openrouter/status/2065856853989270011),
the pipeline silently captured just tweet #1 ("How it works 👇") and dropped the
rest of the thread — so the GP translated half a sentence.

The public mirrors (fxtwitter / vxtwitter / syndication) and X's guest
`TweetResultByRestId` all return a single tweet; none enumerate the thread.
X's `TweetDetail` (which the web UI uses to render conversations) returns 404
for guest tokens. `UserTweets` works cookie-free — the author's profile timeline
bundles consecutive self-replies, so we pull the author's recent tweets and keep
every one sharing the focal tweet's `conversation_id_str`. Snowflake ids are
time-ordered, so sorting ascending gives correct thread order regardless of
which tweet in the chain the URL pointed at.

The catch (verified 2026-06): the guest `UserTweets` timeline is ~1 year stale
and returns no pagination cursor, so any self-thread newer than ~12 months is
simply absent from it — the walker degrades to a single tweet. To cover that
(the common case for a freshly-dropped thread URL), we fall back to the Thread
Reader App unroll, which keeps a per-thread HTML page keyed on the first tweet
id and needs no auth. `UserTweetsAndReplies`, `TweetDetail` and `SearchTimeline`
all 404 for guest tokens, so they are not options.

Contract
--------
    python3 scripts/fetch-x-thread.py <tweet_url>

* Exit 0 + render to stdout  -> a real multi-tweet self-thread (>= 2 tweets).
  Output uses the same header contract as fetch-x-article.sh
  (@handle / ISO date / Source URL / === MAIN TWEET ===) so downstream
  validators keep passing, with each continuation under "=== THREAD n/m ===".
* Exit 3 (NOT_A_THREAD) -> single tweet, X Article, or the thread couldn't be
  enumerated (old thread no longer in the timeline, etc). The caller should
  fall back to the single-tweet path; this is NOT an error.
* Exit 2 -> hard failure (no network / guest token). Caller falls back too.

This is best-effort and deliberately degrades to the existing single-tweet
behaviour, so wiring it in can never regress a capture that worked before.
"""

import html as htmllib
import json
import re
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

NOT_A_THREAD = 3
HARD_FAIL = 2

# Thread Reader App keeps a per-thread unroll keyed on the FIRST tweet id
# (== conversation_id), reachable with a plain cookie-free GET. It is the
# fallback when X's guest timeline can't enumerate a thread (see
# threadreader_fallback for why that happens).
THREADREADER_TEMPLATE = "https://threadreaderapp.com/thread/{root_id}.html"

# Public web bearer token (same one fetch-x-article.sh uses). Not a secret —
# it's the token x.com ships in its own JS bundle for unauthenticated reads.
BEARER = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
    "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Fallback query ids if JS-bundle discovery fails. These drift over time, so
# discovery is preferred; these just keep the tool limping when x.com changes
# its bundle layout.
FALLBACK_QIDS = {
    "TweetResultByRestId": "2Acdg-VztGlHX7MjX67Ysw",
    "UserTweets": "RyDU3I9VJtPF-Pnl6vrRlw",
}

BASE_HEADERS = {
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


def fetch(url, *, method="GET", headers=None, body=None, timeout=25):
    req = Request(url, data=body, method=method, headers=headers or {})
    with urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", errors="replace")


def extract_status_id(url):
    m = re.search(r"status(?:es)?/(\d+)", url)
    return m.group(1) if m else None


def activate_guest():
    status, text = fetch(
        "https://api.twitter.com/1.1/guest/activate.json",
        method="POST",
        headers=BASE_HEADERS,
        body=b"",
        timeout=15,
    )
    if status != 200:
        raise RuntimeError(f"guest activate HTTP {status}")
    token = (json.loads(text).get("guest_token") or "").strip()
    if not token:
        raise RuntimeError("guest activate returned no guest_token")
    return token


def discover_query_ids(names):
    """Scrape current GraphQL queryIds from x.com's JS bundles."""
    found = {}
    seen = set()
    bundle_urls = []
    for page in ("https://x.com/?lang=en", "https://x.com/explore"):
        try:
            _, html = fetch(page, headers={"user-agent": UA, "accept": "text/html"}, timeout=15)
        except Exception:
            continue
        for path in re.findall(
            r"https://abs\.twimg\.com/responsive-web/client-web/[^\"']+?\.js", html
        ):
            if path in seen:
                continue
            seen.add(path)
            # main.*.js carries most operation metadata; try it first.
            (bundle_urls.insert(0, path) if "/main." in path else bundle_urls.append(path))
    for bundle in bundle_urls[:14]:
        if all(n in found for n in names):
            break
        try:
            _, js = fetch(bundle, headers={"user-agent": UA}, timeout=20)
        except Exception:
            continue
        for name in names:
            if name in found:
                continue
            m = re.search(r'queryId:"([^"]+)",operationName:"' + name + '"', js)
            if m:
                found[name] = m.group(1)
    return found


# ---------------------------------------------------------------------------
# Feature flags. X rejects requests that omit any required feature flag with a
# 400 "The following features cannot be null: a, b, c". We start with a broad
# set and auto-heal: parse the missing names out of the error and default them
# to False, then retry. That keeps the tool alive across X's frequent flag
# churn without a code change every time.
# ---------------------------------------------------------------------------
BASE_FEATURES = {
    "rweb_video_screen_enabled": False,
    "profile_label_improvements_pcf_label_in_post_enabled": True,
    "rweb_tipjar_consumption_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
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
    "tweet_awards_web_tipping_enabled": False,
    "responsive_web_grok_show_grok_translated_post": False,
    "responsive_web_grok_analysis_button_from_backend": False,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_grok_image_annotation_enabled": True,
    "responsive_web_grok_imagine_annotation_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
    "responsive_web_grok_community_note_auto_translation_is_enabled": False,
    "responsive_web_twitter_article_plain_text_enabled": True,
}

MISSING_FEATURE_RE = re.compile(r"following features cannot be null:\s*(.+)", re.IGNORECASE)


def graphql_get(query_id, op_name, variables, guest_token, field_toggles=None):
    """GET an unauthenticated GraphQL operation, auto-healing missing flags."""
    headers = dict(BASE_HEADERS)
    headers["x-guest-token"] = guest_token
    features = dict(BASE_FEATURES)
    for _attempt in range(4):
        params = {
            "variables": json.dumps(variables, separators=(",", ":")),
            "features": json.dumps(features, separators=(",", ":")),
        }
        if field_toggles is not None:
            params["fieldToggles"] = json.dumps(field_toggles, separators=(",", ":"))
        url = f"https://x.com/i/api/graphql/{query_id}/{op_name}?{urlencode(params)}"
        try:
            _, text = fetch(url, headers=headers)
            return json.loads(text)
        except HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            m = MISSING_FEATURE_RE.search(body)
            if exc.code == 400 and m:
                added = False
                for name in re.split(r"[,\s]+", m.group(1)):
                    name = name.strip().strip("\"'.")
                    if name and name not in features:
                        features[name] = False
                        added = True
                if added:
                    continue  # retry with the now-complete flag set
            raise
    raise RuntimeError(f"{op_name}: exhausted feature auto-heal retries")


def get_path(obj, *keys):
    cur = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def focal_info(query_id, status_id, guest_token):
    """Return (handle, conversation_id, author_uid, is_article) for the focal tweet."""
    variables = {
        "tweetId": status_id,
        "withCommunity": True,
        "includePromotedContent": True,
        "withVoice": True,
    }
    field_toggles = {"withArticleRichContentState": True, "withArticlePlainText": True}
    data = graphql_get(
        query_id, "TweetResultByRestId", variables, guest_token, field_toggles
    )
    result = get_path(data, "data", "tweetResult", "result") or {}
    # Visibility wrappers nest the real tweet under .tweet
    if result.get("__typename") == "TweetWithVisibilityResults":
        result = result.get("tweet") or {}
    if result.get("__typename") != "Tweet":
        raise RuntimeError(f"focal tweet typename: {result.get('__typename')}")
    legacy = result.get("legacy") or {}
    user_core = get_path(result, "core", "user_results", "result", "core") or {}
    handle = (user_core.get("screen_name") or "").lstrip("@")
    uid = get_path(result, "core", "user_results", "result", "rest_id")
    conv = legacy.get("conversation_id_str") or status_id
    is_article = bool(get_path(result, "article", "article_results", "result"))
    return handle, conv, uid, is_article


def expand_urls(text, url_entities):
    """Replace t.co shortlinks with their expanded targets; drop media links."""
    for ent in url_entities or []:
        short = ent.get("url")
        expanded = ent.get("expanded_url")
        if short and expanded:
            text = text.replace(short, expanded)
    return text


def tweet_body(result):
    """Plain-text body of one tweet, t.co expanded, note-tweet aware."""
    legacy = result.get("legacy") or {}
    note = get_path(result, "note_tweet", "note_tweet_results", "result")
    if isinstance(note, dict) and note.get("text"):
        text = note.get("text") or ""
        urls = get_path(note, "entity_set", "urls") or []
        return expand_urls(text, urls).strip()
    text = legacy.get("full_text") or ""
    entities = legacy.get("entities") or {}
    text = expand_urls(text, entities.get("urls"))
    # Drop trailing media shortlinks (photos/videos) — not translatable prose.
    for media in (entities.get("media") or []):
        if media.get("url"):
            text = text.replace(media.get("url"), "")
    return text.strip()


def collect_thread(user_tweets_data, conversation_id, author_uid):
    """Walk the UserTweets payload, keeping the author's tweets in this convo."""
    found = {}

    def walk(node):
        if isinstance(node, dict):
            if node.get("__typename") == "Tweet" and "legacy" in node:
                legacy = node.get("legacy") or {}
                same_convo = legacy.get("conversation_id_str") == conversation_id
                same_author = (
                    str(legacy.get("user_id_str") or "") == str(author_uid)
                    or get_path(node, "core", "user_results", "result", "rest_id")
                    == author_uid
                )
                rest_id = node.get("rest_id")
                if same_convo and same_author and rest_id:
                    found[rest_id] = node
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(user_tweets_data)
    # Snowflake ids are time-ordered -> ascending == thread order.
    return [found[k] for k in sorted(found, key=lambda x: int(x))]


def iso_date(result):
    legacy = result.get("legacy") or {}
    raw = legacy.get("created_at") or ""
    from datetime import datetime

    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", raw)
    return m.group(1) if m else "unknown-date"


def emit_thread(handle, date, url, bodies, via):
    """Print a thread in the shared capture contract (@handle / date / Source
    URL / === MAIN TWEET === / === THREAD n/m ===) so downstream validators and
    fetch-x-article.sh keep passing regardless of which source produced it."""
    bodies = [b for b in bodies if b]
    total = len(bodies)
    lines = [
        f"@{handle} — {date}",
        f"Source URL: {url}",
        f"Fetched via: {via}",
        f"Thread: {total} tweets",
        "",
        "=== MAIN TWEET ===",
        bodies[0],
    ]
    for idx, body in enumerate(bodies[1:], start=2):
        lines.append("")
        lines.append(f"=== THREAD {idx}/{total} ===")
        lines.append(body)
    print("\n".join(lines).strip())


def _strip_tr_tweet_html(raw):
    """Reduce one Thread Reader App tweet block's inner HTML to plain text.
    Keeps the author's own "N/" numbering span, expands anchors to their href
    (TR already resolves t.co), drops the permalink sup and any other tags."""
    raw = re.sub(r'<span class="nop[^"]*">(.*?)</span>', r"\1", raw, flags=re.S)
    raw = re.sub(
        r'<a [^>]*?href=["\']?([^"\'\s>]+)["\']?[^>]*>.*?</a>',
        lambda m: m.group(1),
        raw,
        flags=re.S,
    )
    raw = re.sub(r"<[^>]+>", "", raw)
    text = htmllib.unescape(raw)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def fetch_threadreader(root_id):
    """Recover a thread from the Thread Reader App unroll.

    Self-contained: handle, date and every tweet body come from the one HTML
    page, no guest token needed. Used when X's guest timeline can't enumerate
    the thread (newer than ~12 months). TR only has a page if someone previously
    unrolled the thread, so this is best-effort.

    Returns (handle, iso_date, [body, ...]) with >=2 bodies, or None.
    """
    url = THREADREADER_TEMPLATE.format(root_id=root_id)
    try:
        status, page = fetch(
            url, headers={"user-agent": UA, "accept": "text/html"}, timeout=25
        )
    except Exception:
        return None
    if status != 200 or not page:
        return None
    blocks = {}
    for m in re.finditer(r'data-tweet="(\d+)"[^>]*\bdir="auto">(.*?)</div>', page, re.S):
        rid, body = m.group(1), _strip_tr_tweet_html(m.group(2))
        if body and rid not in blocks:
            blocks[rid] = body
    if len(blocks) < 2:
        return None
    # Snowflake ids are time-ordered -> ascending == thread order.
    ordered = [blocks[k] for k in sorted(blocks, key=lambda x: int(x))]
    mh = re.search(r'data-screenname="([^"]+)"', page)
    handle = mh.group(1).lstrip("@") if mh else ""
    mt = re.search(r'data-time="(\d+)"', page)
    date = (
        datetime.fromtimestamp(int(mt.group(1)), tz=timezone.utc).strftime("%Y-%m-%d")
        if mt
        else "unknown-date"
    )
    return handle, date, ordered


def threadreader_fallback(root_id, url, handle_hint=""):
    """Try the Thread Reader App unroll and emit it. Returns True on success."""
    tr = fetch_threadreader(root_id)
    if not tr:
        return False
    tr_handle, tr_date, bodies = tr
    emit_thread(tr_handle or handle_hint, tr_date, url, bodies, "threadreader")
    return True


def main(argv):
    if len(argv) < 2 or not argv[1].strip():
        print("Usage: fetch-x-thread.py <tweet_url>", file=sys.stderr)
        return HARD_FAIL
    url = argv[1].strip()
    status_id = extract_status_id(url)
    if not status_id:
        print(f"NOT_A_THREAD: no status id in {url}", file=sys.stderr)
        return NOT_A_THREAD

    # Best-known thread root for the Thread Reader App fallback. When the guest
    # focal lookup succeeds we replace this with the real conversation id; until
    # then the dropped URL's status id is the best guess (correct whenever the
    # user drops the thread's first tweet, which is the common case).
    tr_root = status_id
    handle = ""

    guest_ok = True
    try:
        guest = activate_guest()
    except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError) as exc:
        print(f"guest token unavailable, will try threadreader: {exc}", file=sys.stderr)
        guest_ok = False

    if guest_ok:
        qids = dict(FALLBACK_QIDS)
        qids.update(discover_query_ids(["TweetResultByRestId", "UserTweets"]) or {})
        try:
            handle, conv, uid, is_article = focal_info(
                qids["TweetResultByRestId"], status_id, guest
            )
            if is_article:
                # X Articles are single long-form tweets — let the article
                # renderer handle them; no thread, no TR fallback.
                print("NOT_A_THREAD: focal tweet is an X Article", file=sys.stderr)
                return NOT_A_THREAD
            tr_root = conv or status_id
            if uid:
                ut = graphql_get(
                    qids["UserTweets"],
                    "UserTweets",
                    {
                        "userId": uid,
                        "count": 40,
                        "includePromotedContent": False,
                        "withQuickPromoteEligibilityTweetFields": False,
                        "withVoice": True,
                    },
                    guest,
                )
                thread = collect_thread(ut, conv, uid)
                if len(thread) >= 2:
                    root = thread[0]
                    if not handle:
                        core = (
                            get_path(root, "core", "user_results", "result", "core")
                            or {}
                        )
                        handle = (core.get("screen_name") or "").lstrip("@")
                    bodies = [tweet_body(n) for n in thread]
                    emit_thread(handle, iso_date(root), url, bodies, "x-guest-thread")
                    return 0
        except Exception as exc:
            print(f"guest thread path failed, trying threadreader: {exc}", file=sys.stderr)

    # Guest timeline can't reach it (too recent / aged out / guest GraphQL down).
    # Fall back to the Thread Reader App unroll.
    if threadreader_fallback(tr_root, url, handle):
        return 0

    print(
        f"NOT_A_THREAD: guest timeline empty and no threadreader unroll for {tr_root}",
        file=sys.stderr,
    )
    return NOT_A_THREAD


if __name__ == "__main__":
    sys.exit(main(sys.argv))
