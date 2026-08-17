#!/usr/bin/env python3
"""Fetch article content from a URL using readability + BeautifulSoup.

Handles React SSR, SPAs, and normal HTML pages properly.
Falls back to raw HTML stripping if readability fails.

Usage:
    python3 scripts/fetch-article.py <url> [output_file]

Output: Clean markdown-ish text suitable for LLM processing.
"""

from __future__ import annotations

from datetime import date, datetime
from html.parser import HTMLParser
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
CONTENT_SELECTORS = (
    "article",
    "main",
    "[role=main]",
    ".entry-content",
    ".post-content",
    ".article-content",
    ".entryPage",
)
PUBLICATION_META_KEYS = {
    "article:published_time",
    "date",
    "datepublished",
    "dc.date",
    "publish-date",
    "pubdate",
}
PUBLICATION_CLASS_NAMES = {
    "date",
    "entry-date",
    "mobile-date",
    "post-date",
    "published",
}


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


def append_block(lines: list[str], tag: str, text: str, quote_depth: int = 0) -> None:
    """Append one markdown-ish block to the output buffer."""
    if tag == "pre":
        text = text.strip("\n")
        if not text:
            return
        rendered = f"```\n{text}\n```"
    else:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return

        if tag == "h1":
            rendered = f"# {text}"
        elif tag == "h2":
            rendered = f"## {text}"
        elif tag == "h3":
            rendered = f"### {text}"
        elif tag == "h4":
            rendered = f"#### {text}"
        elif tag == "li":
            rendered = f"- {text}"
        else:
            rendered = text

    if quote_depth:
        prefix = "> " * quote_depth
        rendered = "\n".join(prefix + line for line in rendered.splitlines())

    lines.append(rendered)
    lines.append("")


class MarkdownHTMLParser(HTMLParser):
    """Project an article HTML fragment to Markdown without nested duplicates."""

    BLOCK_TAGS = {"h1", "h2", "h3", "h4", "p", "li", "pre"}
    IGNORED_TAGS = {"script", "style", "noscript"}

    def __init__(self, title: str = "") -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.seen_keys: set[str] = set()
        self.blocks: list[dict[str, object]] = []
        self.block_events: list[tuple[str, dict[str, object] | None]] = []
        self.inline_events: list[tuple[str, str, dict[str, object]]] = []
        self.implicit_block: dict[str, object] | None = None
        self.quote_depth = 0
        self.ignored_depth = 0

        normalized_title = re.sub(r"\s+", " ", title).strip()
        if normalized_title:
            self.lines.extend([f"# {normalized_title}", ""])
            self.seen_keys.add(normalized_title.casefold())

    def _new_block(self, tag: str) -> dict[str, object]:
        return {
            "tag": tag,
            "markdown": [],
            "plain": [],
            "quote_depth": self.quote_depth,
        }

    def _current_block(self, create_implicit: bool = False) -> dict[str, object] | None:
        if self.blocks:
            return self.blocks[-1]
        if create_implicit and self.implicit_block is None:
            self.implicit_block = self._new_block("p")
        return self.implicit_block

    def _append(self, markdown: str, plain: str | None = None) -> None:
        block = self._current_block(create_implicit=True)
        if block is None:
            return
        block["markdown"].append(markdown)  # type: ignore[union-attr]
        block["plain"].append(markdown if plain is None else plain)  # type: ignore[union-attr]

    def _emit(self, block: dict[str, object]) -> None:
        tag = str(block["tag"])
        markdown = "".join(block["markdown"])  # type: ignore[arg-type]
        plain = re.sub(r"\s+", " ", "".join(block["plain"])).strip()  # type: ignore[arg-type]
        key = plain.casefold()
        if not key:
            return
        if tag in {"h1", "h2"} and key in self.seen_keys:
            return
        if tag in {"h1", "h2"}:
            self.seen_keys.add(key)
        append_block(self.lines, tag, markdown, int(block["quote_depth"]))

    def _flush_implicit(self) -> None:
        if self.implicit_block is not None:
            self._emit(self.implicit_block)
            self.implicit_block = None

    def _in_pre(self) -> bool:
        return bool(self.blocks and self.blocks[-1]["tag"] == "pre")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        attributes = {name.casefold(): value or "" for name, value in attrs}

        if tag in self.IGNORED_TAGS:
            self.ignored_depth += 1
            return
        if self.ignored_depth:
            return

        if self._in_pre():
            if tag == "br":
                self._append("\n")
            return

        if tag == "blockquote":
            self._flush_implicit()
            self.quote_depth += 1
            return

        if tag in self.BLOCK_TAGS:
            self._flush_implicit()
            if tag == "p" and self.blocks and self.blocks[-1]["tag"] == "li":
                self.block_events.append((tag, None))
                return
            block = self._new_block(tag)
            self.blocks.append(block)
            self.block_events.append((tag, block))
            return

        if tag == "br":
            self._append("\n")
            return

        if tag == "img":
            src = attributes.get("src", "").strip()
            alt = attributes.get("alt", "").strip()
            if src:
                self._append(f"![{alt}]({src})", alt)
            return

        if tag == "source":
            src = attributes.get("src", "").strip()
            if src:
                self._append(f"[Video]({src})", "Video")
            return

        opening = ""
        closing = ""
        if tag == "a" and attributes.get("href"):
            opening, closing = "[", f"]({attributes['href']})"
        elif tag == "code":
            opening = closing = "`"
        elif tag in {"strong", "b"}:
            opening = closing = "**"
        elif tag in {"em", "i"}:
            opening = closing = "*"

        if opening:
            block = self._current_block(create_implicit=True)
            if block is not None:
                block["markdown"].append(opening)  # type: ignore[union-attr]
                self.inline_events.append((tag, closing, block))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if self.ignored_depth:
            if tag in self.IGNORED_TAGS:
                self.ignored_depth -= 1
            return

        if self._in_pre() and tag != "pre":
            return

        if tag == "blockquote":
            self._flush_implicit()
            self.quote_depth = max(0, self.quote_depth - 1)
            return

        if tag in self.BLOCK_TAGS:
            for index in range(len(self.block_events) - 1, -1, -1):
                event_tag, block = self.block_events[index]
                if event_tag != tag:
                    continue
                del self.block_events[index]
                if block is not None and block in self.blocks:
                    self.blocks.remove(block)
                    self._emit(block)
                return

        for index in range(len(self.inline_events) - 1, -1, -1):
            event_tag, closing, block = self.inline_events[index]
            if event_tag != tag:
                continue
            del self.inline_events[index]
            if block is self._current_block():
                block["markdown"].append(closing)  # type: ignore[union-attr]
            return

    def handle_data(self, data: str) -> None:
        if self.ignored_depth or not data:
            return
        if not self.blocks and self.implicit_block is None and not data.strip():
            return
        self._append(data)

    def markdown(self) -> str:
        self._flush_implicit()
        while self.blocks:
            self._emit(self.blocks.pop())
        return "\n".join(self.lines).strip()


def normalize_publication_date(value: str) -> str:
    """Normalize common article publication date formats to YYYY-MM-DD."""
    value = re.sub(r"(?<=\d)(st|nd|rd|th)\b", "", value.strip(), flags=re.IGNORECASE)
    iso_match = re.search(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", value)
    if iso_match:
        return iso_match.group(1)
    for date_format in ("%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, date_format).date().isoformat()
        except ValueError:
            continue
    return ""


class PublicationDateHTMLParser(HTMLParser):
    """Collect publication metadata without depending on site-specific JS."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.candidates: list[str] = []
        self.capture_depth = 0
        self.capture_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name.casefold(): value or "" for name, value in attrs}
        metadata_key = (attributes.get("property") or attributes.get("name") or attributes.get("itemprop", "")).casefold()
        if tag.casefold() == "meta" and metadata_key in PUBLICATION_META_KEYS and attributes.get("content"):
            self.candidates.append(attributes["content"])
        if tag.casefold() == "time" and attributes.get("datetime"):
            self.candidates.append(attributes["datetime"])

        if self.capture_depth:
            self.capture_depth += 1
            return
        class_names = set(attributes.get("class", "").split())
        if class_names & PUBLICATION_CLASS_NAMES:
            self.capture_depth = 1
            self.capture_parts = []

    def handle_endtag(self, tag: str) -> None:
        if not self.capture_depth:
            return
        self.capture_depth -= 1
        if self.capture_depth == 0:
            candidate = "".join(self.capture_parts).strip()
            if candidate:
                self.candidates.append(candidate)
            self.capture_parts = []

    def handle_data(self, data: str) -> None:
        if self.capture_depth:
            self.capture_parts.append(data)


def extract_publication_date(html: str) -> str:
    """Return the first explicit publication date found in an HTML page."""
    parser = PublicationDateHTMLParser()
    parser.feed(html)
    parser.close()
    for candidate in parser.candidates:
        normalized = normalize_publication_date(candidate)
        if normalized:
            return normalized
    return ""


def soup_to_text(summary_html: str, title: str = "") -> str:
    """Convert HTML fragments to readable markdown-ish text."""
    parser = MarkdownHTMLParser(title)
    parser.feed(summary_html)
    parser.close()
    return parser.markdown()


def find_content_root(soup: object) -> object | None:
    """Return the first explicit article container advertised by the page."""
    for selector in CONTENT_SELECTORS:
        root = soup.select_one(selector)  # type: ignore[attr-defined]
        if root is not None:
            return root
    return None


def extract_semantic_container(html: str, title: str = "") -> str:
    """Prefer an author-declared content container over heuristic cleanup."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    root = find_content_root(soup)
    if root is None:
        return ""
    for tag in root.find_all(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "iframe"]):
        tag.decompose()
    return soup_to_text(str(root), title)


def extract_with_readability(html: str, url: str) -> str:
    """Use readability-lxml to extract main content."""
    from readability import Document

    doc = Document(html, url=url)
    title = doc.title() or ""
    semantic_text = extract_semantic_container(html, title)
    if semantic_text and not is_garbage(semantic_text):
        return semantic_text
    summary_html = doc.summary()
    return soup_to_text(summary_html, title)


def extract_fallback(html: str) -> str:
    """Fallback extractor: prune noisy chrome, then keep readable structure."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "iframe"]):
        tag.decompose()

    root = find_content_root(soup) or soup.body or soup
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

    publication_date = extract_publication_date(html)
    publication_line = f"Published: {publication_date}\n" if publication_date else ""
    output = f"Source URL: {final_url}\nFetched: {date.today().isoformat()}\n{publication_line}\n{text}"

    if output_file:
        with open(output_file, "w", encoding="utf-8") as file_obj:
            file_obj.write(output)
        print(f"OK: {len(text)} chars written to {output_file}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
