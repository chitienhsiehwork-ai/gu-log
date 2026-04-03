#!/usr/bin/env python3
"""Fetch article content from a URL using readability + BeautifulSoup.

Handles React SSR, SPAs, and normal HTML pages properly.
Falls back to raw HTML stripping if readability fails.

Usage:
    python3 scripts/fetch-article.py <url> [output_file]

Output: Clean markdown-ish text suitable for LLM processing.
"""

from __future__ import annotations

from datetime import date
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_BYTES = 5 * 1024 * 1024
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
CODE_MARKERS = [
    "{",
    "}",
    "function",
    "const ",
    "let ",
    "var ",
    "import ",
    "export ",
    "window.",
    "document.",
    "=>",
    "();",
    "__next",
    "webpack",
]
BLOCKED_MARKERS = [
    "enable javascript",
    "please enable javascript",
    "please verify you are human",
    "just a moment",
    "access denied",
    "too many requests",
    "rate limit",
    "captcha",
    "subscribe to continue",
    "sign in to continue",
    "already a subscriber",
    "continue reading with a free trial",
]
BOILERPLATE_MARKERS = [
    "cookie",
    "privacy policy",
    "terms of service",
    "all rights reserved",
    "sign in",
    "subscribe",
    "newsletter",
    "menu",
    "navigation",
]


def sniff_charset(raw_html: bytes, content_type: str) -> str:
    """Best-effort charset detection without extra dependencies."""
    header_match = re.search(r"charset=([^;\s]+)", content_type, re.IGNORECASE)
    if header_match:
        return header_match.group(1).strip("\"'")

    head = raw_html[:4096].decode("ascii", errors="ignore")
    meta_charset = re.search(
        r"<meta[^>]+charset=[\"']?\s*([a-zA-Z0-9_\-]+)",
        head,
        re.IGNORECASE,
    )
    if meta_charset:
        return meta_charset.group(1)

    meta_equiv = re.search(
        r"<meta[^>]+content=[\"'][^\"']*charset=([a-zA-Z0-9_\-]+)",
        head,
        re.IGNORECASE,
    )
    if meta_equiv:
        return meta_equiv.group(1)

    return "utf-8"


def decode_html(raw_html: bytes, content_type: str) -> str:
    """Decode response bytes using header/meta hints, then safe fallbacks."""
    candidates = [sniff_charset(raw_html, content_type), "utf-8", "utf-8-sig", "iso-8859-1"]
    seen = set()
    for encoding in candidates:
        if not encoding or encoding in seen:
            continue
        seen.add(encoding)
        try:
            return raw_html.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw_html.decode("utf-8", errors="replace")


def fetch_html(url: str) -> tuple[str, str]:
    """Fetch HTML with a browser-like User-Agent and basic sanity checks."""
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=30) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if content_type and not any(token in content_type.lower() for token in ("html", "xml", "text/plain")):
                raise RuntimeError(f"Unexpected Content-Type: {content_type}")

            raw_html = resp.read(MAX_BYTES + 1)
            if len(raw_html) > MAX_BYTES:
                raise RuntimeError(f"Response too large (> {MAX_BYTES // (1024 * 1024)} MB)")

            return resp.geturl(), decode_html(raw_html, content_type)
    except HTTPError as exc:
        if exc.code == 429:
            raise RuntimeError("HTTP 429: rate limited by source site") from exc
        if exc.code in {401, 403}:
            raise RuntimeError(f"HTTP {exc.code}: blocked or paywalled by source site") from exc
        raise RuntimeError(f"HTTP {exc.code}: {exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def append_block(lines: list[str], tag: str, text: str) -> None:
    """Append a markdown-ish block to the output buffer."""
    if tag == "pre":
        text = text.strip("\n")
        if not text:
            return
        lines.append(f"```\n{text}\n```")
        lines.append("")
        return

    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return

    if tag == "h1":
        lines.append(f"# {text}")
    elif tag == "h2":
        lines.append(f"## {text}")
    elif tag == "h3":
        lines.append(f"### {text}")
    elif tag == "h4":
        lines.append(f"#### {text}")
    elif tag == "li":
        lines.append(f"- {text}")
    elif tag == "blockquote":
        lines.append(f"> {text}")
    else:
        lines.append(text)
    lines.append("")


def soup_to_text(summary_html: str, title: str = "") -> str:
    """Convert HTML fragments to readable markdown-ish text."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(summary_html, "lxml")
    root = soup.find("article") or soup.find("main") or soup

    lines: list[str] = []
    seen_keys: set[str] = set()

    if title:
        normalized_title = re.sub(r"\s+", " ", title).strip()
        if normalized_title:
            lines.append(f"# {normalized_title}")
            lines.append("")
            seen_keys.add(normalized_title.casefold())

    for el in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote", "pre"]):
        text = el.get_text(separator="\n" if el.name == "pre" else " ", strip=True)
        key = re.sub(r"\s+", " ", text).strip().casefold()
        if not key:
            continue
        if el.name in {"h1", "h2"} and key in seen_keys:
            continue
        seen_keys.add(key)
        append_block(lines, el.name, text)

    return "\n".join(lines).strip()


def extract_with_readability(html: str, url: str) -> str:
    """Use readability-lxml to extract main content."""
    from readability import Document

    doc = Document(html, url=url)
    summary_html = doc.summary()
    title = doc.title() or ""
    return soup_to_text(summary_html, title)


def extract_fallback(html: str) -> str:
    """Fallback extractor: prune noisy chrome, then keep readable structure."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "iframe"]):
        tag.decompose()

    root = soup.find("article") or soup.find("main") or soup.body or soup
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    return soup_to_text(str(root), title)


def looks_blocked_or_paywalled(text: str) -> bool:
    """Detect common anti-bot / paywall pages that look readable but are useless."""
    lowered = text.lower()
    marker_hits = sum(marker in lowered for marker in BLOCKED_MARKERS)
    if marker_hits >= 2 and len(text) < 6000:
        return True
    if re.search(r"(sign in|subscribe).{0,80}(continue|reading)", lowered, re.DOTALL) and len(text) < 6000:
        return True
    return False


def is_garbage(text: str) -> bool:
    """Check if extracted text is mostly JS/CSS/boilerplate instead of article prose."""
    clean = text.strip()
    if len(clean) < 200:
        return True
    if looks_blocked_or_paywalled(clean):
        return True

    lines = [line.strip() for line in clean.splitlines() if line.strip()]
    if not lines:
        return True

    code_lines = sum(1 for line in lines if any(marker in line for marker in CODE_MARKERS))
    boilerplate_lines = sum(1 for line in lines if any(marker in line.lower() for marker in BOILERPLATE_MARKERS))
    prose_lines = sum(1 for line in lines if len(line.split()) >= 8)
    alpha_ratio = sum(ch.isalpha() for ch in clean) / max(len(clean), 1)

    if code_lines / len(lines) > 0.3:
        return True
    if boilerplate_lines / len(lines) > 0.35 and prose_lines < 4:
        return True
    if alpha_ratio < 0.35:
        return True
    return False


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 fetch-article.py <url> [output_file]", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        final_url, html = fetch_html(url)
    except Exception as exc:
        print(f"ERROR: Failed to fetch {url}: {exc}", file=sys.stderr)
        sys.exit(1)

    text = ""
    try:
        text = extract_with_readability(html, final_url)
        if is_garbage(text):
            print("WARN: Readability output looks like garbage, trying fallback", file=sys.stderr)
            text = extract_fallback(html)
    except Exception as exc:
        print(f"WARN: Readability failed ({exc}), using fallback", file=sys.stderr)
        try:
            text = extract_fallback(html)
        except Exception as fallback_exc:
            print(f"ERROR: Fallback extraction failed ({fallback_exc})", file=sys.stderr)
            sys.exit(1)

    if is_garbage(text):
        print("ERROR: Could not extract readable content from URL (page may be blocked, paywalled, or JS-only)", file=sys.stderr)
        sys.exit(1)

    output = f"Source URL: {final_url}\nFetched: {date.today().isoformat()}\n\n{text}"

    if output_file:
        with open(output_file, "w", encoding="utf-8") as file_obj:
            file_obj.write(output)
        print(f"OK: {len(text)} chars written to {output_file}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
