#!/usr/bin/env python3
"""Build a deterministic evidence packet for the Tribunal Librarian judge.

The Librarian needs broad repo context (old posts, glossary, links), but the LLM
should not spend most of its budget discovering files. This script does the cheap,
repeatable repo scan and hands the judge a compact packet.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "src" / "content" / "posts"
GLOSSARY_PATH = ROOT / "src" / "data" / "glossary.json"

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
LINK_RE = re.compile(r"\]\((/[^)]+)\)")
TAG_RE = re.compile(r"tags:\s*\[(.*?)\]")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9+\-_/\.]*|[\u4e00-\u9fff]{2,}")


def parse_scalar(fm: str, key: str) -> str:
    m = re.search(rf"^{re.escape(key)}:\s*(.+?)\s*$", fm, re.M)
    if not m:
        return ""
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    return val.strip()


def parse_tags(fm: str) -> list[str]:
    m = TAG_RE.search(fm)
    if not m:
        return []
    return [x.strip().strip('"\'') for x in m.group(1).split(',') if x.strip()]


def split_post(path: Path) -> tuple[dict[str, Any], str, str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = FRONTMATTER_RE.match(text)
    fm_text = m.group(1) if m else ""
    body = text[m.end():] if m else text
    fm = {
        "ticketId": parse_scalar(fm_text, "ticketId"),
        "title": parse_scalar(fm_text, "title"),
        "source": parse_scalar(fm_text, "source"),
        "sourceUrl": parse_scalar(fm_text, "sourceUrl"),
        "summary": parse_scalar(fm_text, "summary"),
        "tags": parse_tags(fm_text),
    }
    return fm, fm_text, body


def tokens(text: str) -> set[str]:
    out: set[str] = set()
    for tok in WORD_RE.findall(text.lower()):
        if re.fullmatch(r"[\u4e00-\u9fff]{2,}", tok):
            out.update(tok[i:i+2] for i in range(max(0, len(tok)-1)))
        elif len(tok) > 2:
            out.add(tok)
    stop = {"the", "and", "for", "with", "that", "this", "from", "https", "http", "www", "com"}
    return {t for t in out if t not in stop}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def load_glossary_terms() -> list[str]:
    try:
        raw = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    terms: list[str] = []
    if isinstance(raw, dict):
        for k, v in raw.items():
            terms.append(str(k))
            if isinstance(v, dict):
                for kk in ("term", "name", "aliases"):
                    vv = v.get(kk)
                    if isinstance(vv, str):
                        terms.append(vv)
                    elif isinstance(vv, list):
                        terms.extend(map(str, vv))
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                for kk in ("term", "name", "aliases"):
                    vv = item.get(kk)
                    if isinstance(vv, str):
                        terms.append(vv)
                    elif isinstance(vv, list):
                        terms.extend(map(str, vv))
    return sorted({t for t in terms if t and len(t) > 1}, key=str.lower)


def slug_for(path: Path) -> str:
    return path.stem


def existing_post_index() -> dict[str, Path]:
    return {slug_for(p): p for p in POSTS_DIR.glob("*.mdx")}


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: tribunal-librarian-packet.py <post-filename-or-path>", file=sys.stderr)
        return 2

    post_path = Path(sys.argv[1])
    if not post_path.is_absolute():
        post_path = POSTS_DIR / post_path.name
    if not post_path.exists():
        print(f"ERROR: post not found: {post_path}", file=sys.stderr)
        return 1

    target_fm, _target_fm_text, target_body = split_post(post_path)
    target_text = "\n".join([target_fm.get("title", ""), target_fm.get("summary", ""), target_body])
    target_tokens = tokens(target_text)
    target_tags = set(target_fm.get("tags", []))

    glossary_terms = load_glossary_terms()
    lower_body = target_body.lower()
    matched_terms = []
    unlinked_terms = []
    for term in glossary_terms:
        if term.lower() in lower_body:
            matched_terms.append(term)
            if f"](/glossary#{term.lower().replace(' ', '-')}" not in lower_body and f"/glossary" not in lower_body[max(0, lower_body.find(term.lower())-80):lower_body.find(term.lower())+120]:
                unlinked_terms.append(term)

    post_index = existing_post_index()
    links = []
    broken = []
    for href in LINK_RE.findall(target_body):
        if href.startswith("/posts/") or href.startswith("/en/posts/"):
            slug = href.rstrip("/").split("/")[-1]
            ok = slug in post_index
            links.append((href, ok))
            if not ok:
                broken.append(href)

    candidates = []
    for path in POSTS_DIR.glob("*.mdx"):
        if path == post_path or path.name.startswith("en-"):
            continue
        fm, _fm_text, body = split_post(path)
        meta_text = "\n".join([fm.get("title", ""), fm.get("summary", ""), " ".join(fm.get("tags", []))])
        sim = jaccard(target_tokens, tokens(meta_text + "\n" + body[:2500]))
        tag_overlap = len(target_tags & set(fm.get("tags", [])))
        same_source = bool(target_fm.get("sourceUrl") and fm.get("sourceUrl") == target_fm.get("sourceUrl"))
        score = sim + 0.04 * tag_overlap + (0.35 if same_source else 0.0)
        if score > 0.045 or tag_overlap:
            candidates.append((score, sim, tag_overlap, same_source, path, fm))
    candidates.sort(reverse=True, key=lambda x: x[0])
    top = candidates[:18]

    headings = [line.strip() for line in target_body.splitlines() if line.startswith("## ")][:12]
    body_word_counts = Counter(WORD_RE.findall(target_body.lower()))
    key_terms = ", ".join([w for w, _ in body_word_counts.most_common(30) if len(w) > 2])

    print("# Librarian Evidence Packet")
    print()
    print("## Target post")
    print(f"- file: {post_path.relative_to(ROOT)}")
    for k in ("ticketId", "title", "source", "sourceUrl", "summary"):
        print(f"- {k}: {target_fm.get(k, '')}")
    print(f"- tags: {', '.join(target_fm.get('tags', []))}")
    print(f"- headings: {' | '.join(headings)}")
    print(f"- lexical hints: {key_terms[:500]}")
    print()

    print("## Deterministic checks")
    print(f"- glossary terms detected: {', '.join(matched_terms[:40]) or 'none'}")
    print(f"- possibly unlinked glossary terms: {', '.join(unlinked_terms[:30]) or 'none'}")
    print(f"- internal links checked: {len(links)}")
    print(f"- broken internal links: {', '.join(broken) or 'none'}")
    print()

    print("## Similar / related old posts to consider for citation")
    if not top:
        print("- none above threshold")
    for rank, (score, sim, tag_overlap, same_source, path, fm) in enumerate(top, 1):
        slug = slug_for(path)
        print(f"{rank}. /posts/{slug}/")
        print(f"   - file: {path.name}")
        print(f"   - title: {fm.get('title','')}")
        print(f"   - summary: {fm.get('summary','')[:260]}")
        print(f"   - tags: {', '.join(fm.get('tags', []))}")
        print(f"   - similarity: {sim:.3f}; tagOverlap: {tag_overlap}; sameSource: {same_source}")
    print()

    print("## Librarian policy reminder")
    print("- If an old post has a similar idea, the new post does not need to be rejected automatically.")
    print("- Instead, judge whether the new post has a new POV, newer source, sharper framing, or different practical angle.")
    print("- If the idea happened before or overlaps, crossRef should require citing the most relevant old post(s).")
    print("- Also judge terminology: awkward literal zh-tw calques should be replaced with natural zh-tw or a canonical English glossary term.")
    print("- If a term choice affects gu-log's long-term vocabulary, flag it as a terminology decision for ShroomDog/Librarian instead of silently passing it.")
    print("- Use this packet as evidence; do not rescan the entire repo unless the packet is clearly insufficient.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
