#!/usr/bin/env python3
"""Fetch article content from a URL using readability + BeautifulSoup.

Handles React SSR, SPAs, and normal HTML pages properly.
Falls back to raw HTML stripping if readability fails.

Usage:
    python3 scripts/fetch-article.py <url> [output_file]

Output: Clean markdown-ish text suitable for LLM processing.
"""

from __future__ import annotations

from bs4 import BeautifulSoup, NavigableString, Tag
from datetime import date, datetime
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
CONTENT_BOILERPLATE_SELECTORS = (
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "iframe",
    ".entryFooter",
    ".post-footer",
    ".article-footer",
    ".share",
    ".sharing",
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
        longest_run = max((len(match.group(0)) for match in re.finditer(r"`+", text)), default=0)
        fence = "`" * max(3, longest_run + 1)
        rendered = f"{fence}\n{text}\n{fence}"
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


def escape_markdown_alt(text: str) -> str:
    """Keep literal alt text from becoming Markdown or MDX syntax."""
    return re.sub(r"([\\\[\]{}])", r"\\\1", text)


class MarkdownProjector:
    """Render a BeautifulSoup tree once, preserving source order and nesting."""

    BLOCK_TAGS = {"h1", "h2", "h3", "h4", "p", "li", "pre"}
    CONTAINER_TAGS = {"html", "body", "article", "main", "section", "div", "ul", "ol"}
    IGNORED_TAGS = {"script", "style", "noscript"}

    def __init__(self, title: str = "") -> None:
        self.title = re.sub(r"\s+", " ", title).strip()
        self.lines: list[str] = []
        self.has_h1 = False
        self.heading_keys: set[str] = set()

    def _inline(self, node: object) -> str:
        if isinstance(node, NavigableString):
            return str(node)
        if not isinstance(node, Tag):
            return ""
        tag = node.name.casefold()
        if tag in self.IGNORED_TAGS or tag in self.BLOCK_TAGS or tag in self.CONTAINER_TAGS or tag == "blockquote":
            return ""

        content = "".join(self._inline(child) for child in node.children)
        if tag == "a" and node.get("href"):
            return f"[{content}]({node['href']})"
        if tag == "code":
            longest_run = max((len(match.group(0)) for match in re.finditer(r"`+", content)), default=0)
            delimiter = "`" * max(1, longest_run + 1)
            return f"{delimiter}{content}{delimiter}"
        if tag in {"strong", "b"}:
            return f"**{content}**"
        if tag in {"em", "i"}:
            return f"*{content}*"
        if tag == "br":
            return "\n"
        if tag == "img" and node.get("src"):
            alt = str(node.get("alt", "")).strip()
            return f"![{escape_markdown_alt(alt)}]({node['src']})"
        if tag == "source" and node.get("src"):
            return f"[Video]({node['src']})"
        return content

    def _emit(self, node: Tag, quote_depth: int) -> None:
        tag = node.name.casefold()
        if tag == "pre":
            markdown = node.get_text("", strip=False)
        else:
            markdown = "".join(self._inline(child) for child in node.children)
        if tag == "h1":
            self.has_h1 = True
        if tag in {"h1", "h2"}:
            heading = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).casefold()
            if heading:
                self.heading_keys.add(heading)
        append_block(self.lines, tag, markdown, quote_depth)

    def _walk(self, parent: Tag | BeautifulSoup, quote_depth: int = 0) -> None:
        loose: list[str] = []

        def flush_loose() -> None:
            if loose:
                append_block(self.lines, "p", "".join(loose), quote_depth)
                loose.clear()

        for child in parent.children:
            if isinstance(child, NavigableString):
                loose.append(str(child))
                continue
            if not isinstance(child, Tag) or child.name.casefold() in self.IGNORED_TAGS:
                continue
            tag = child.name.casefold()
            if tag == "blockquote":
                flush_loose()
                self._walk(child, quote_depth + 1)
            elif tag in self.BLOCK_TAGS:
                flush_loose()
                self._emit(child, quote_depth)
                if tag == "li":
                    for nested in child.find_all(["ul", "ol"], recursive=False):
                        self._walk(nested, quote_depth)
            elif tag in self.CONTAINER_TAGS:
                flush_loose()
                self._walk(child, quote_depth)
            else:
                loose.append(self._inline(child))
        flush_loose()

    def markdown(self, root: Tag | BeautifulSoup) -> str:
        self._walk(root)
        if self.title and not self.has_h1 and self.title.casefold() not in self.heading_keys:
            self.lines[0:0] = [f"# {self.title}", ""]
        return "\n".join(self.lines).strip()


def normalize_publication_date(value: str) -> str:
    """Normalize common article publication date formats to YYYY-MM-DD."""
    value = re.sub(r"(?<=\d)(st|nd|rd|th)\b", "", value.strip(), flags=re.IGNORECASE)
    iso_match = re.search(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", value)
    if iso_match:
        try:
            return date.fromisoformat(iso_match.group(1)).isoformat()
        except ValueError:
            return ""
    for date_format in ("%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(value, date_format).date().isoformat()
        except ValueError:
            continue
    return ""


def extract_publication_date(html: str) -> str:
    """Return the first explicit publication date found in an HTML page."""
    soup = BeautifulSoup(html, "lxml")
    candidates: list[str] = []
    for meta in soup.find_all("meta"):
        metadata_key = str(meta.get("property") or meta.get("name") or meta.get("itemprop") or "").casefold()
        if metadata_key in PUBLICATION_META_KEYS and meta.get("content"):
            candidates.append(str(meta["content"]))
    candidates.extend(str(node["datetime"]) for node in soup.find_all("time", datetime=True))
    for class_name in PUBLICATION_CLASS_NAMES:
        candidates.extend(node.get_text(" ", strip=True) for node in soup.select(f".{class_name}"))

    for candidate in candidates:
        normalized = normalize_publication_date(candidate)
        if normalized:
            return normalized
    return ""


def soup_to_text(summary_html: str, title: str = "") -> str:
    """Convert HTML fragments to readable markdown-ish text."""
    soup = BeautifulSoup(summary_html, "lxml")
    root = soup.find("article") or soup.find("main") or soup.body or soup
    return MarkdownProjector(title).markdown(root)


def find_content_root(soup: BeautifulSoup | Tag) -> Tag | None:
    """Return the first explicit article container advertised by the page."""
    for selector in CONTENT_SELECTORS:
        root = soup.select_one(selector)
        if root is not None:
            return root
    return None


def extract_semantic_container(html: str, title: str = "") -> str:
    """Prefer an author-declared content container over heuristic cleanup."""
    soup = BeautifulSoup(html, "lxml")
    root = find_content_root(soup)
    if root is None:
        return ""
    for tag in root.select(", ".join(CONTENT_BOILERPLATE_SELECTORS)):
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
