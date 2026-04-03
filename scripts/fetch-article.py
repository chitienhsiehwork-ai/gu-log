#!/usr/bin/env python3
"""Fetch article content from a URL using readability + BeautifulSoup.

Handles React SSR, SPAs, and normal HTML pages properly.
Falls back to raw HTML stripping if readability fails.

Usage:
    python3 scripts/fetch-article.py <url> [output_file]

Output: Clean markdown-ish text suitable for LLM processing.
"""

import sys
import subprocess
import re
from urllib.request import urlopen, Request


def fetch_html(url: str) -> str:
    """Fetch HTML with a browser-like User-Agent."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_with_readability(html: str, url: str) -> str:
    """Use readability-lxml to extract main content."""
    from readability import Document
    doc = Document(html, url=url)
    summary_html = doc.summary()
    title = doc.title()

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(summary_html, "lxml")

    # Convert to clean text with structure preserved
    lines = []
    if title:
        lines.append(f"# {title}")
        lines.append("")

    for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote", "pre"]):
        tag = el.name
        text = el.get_text(separator=" ", strip=True)
        if not text:
            continue

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
        elif tag == "pre":
            lines.append(f"```\n{text}\n```")
        else:
            lines.append(text)
        lines.append("")

    return "\n".join(lines)


def extract_fallback(html: str) -> str:
    """Fallback: strip tags with BeautifulSoup."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")

    # Remove script, style, nav, footer, header
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def is_garbage(text: str) -> bool:
    """Check if extracted text is mostly JavaScript/CSS garbage."""
    if len(text) < 200:
        return True
    # Count lines that look like code vs prose
    lines = text.split("\n")
    code_indicators = sum(
        1 for l in lines
        if any(kw in l for kw in ["{", "}", "function", "var ", "const ", "import ",
                                    "export ", "window.", "document.", "=>", "();"])
    )
    ratio = code_indicators / max(len(lines), 1)
    return ratio > 0.3


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fetch-article.py <url> [output_file]", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        html = fetch_html(url)
    except Exception as e:
        print(f"ERROR: Failed to fetch {url}: {e}", file=sys.stderr)
        sys.exit(1)

    # Try readability first
    try:
        text = extract_with_readability(html, url)
        if is_garbage(text):
            print("WARN: Readability output looks like garbage, trying fallback", file=sys.stderr)
            text = extract_fallback(html)
    except Exception as e:
        print(f"WARN: Readability failed ({e}), using fallback", file=sys.stderr)
        text = extract_fallback(html)

    if is_garbage(text):
        print("ERROR: Could not extract readable content from URL", file=sys.stderr)
        sys.exit(1)

    # Add source metadata header
    output = f"Source URL: {url}\nFetched: {__import__('datetime').date.today().isoformat()}\n\n{text}"

    if output_file:
        with open(output_file, "w") as f:
            f.write(output)
        print(f"OK: {len(text)} chars written to {output_file}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
