#!/usr/bin/env python3
"""
CP Dedup Similarity Engine
Layer 2 of the CP Dedup Guard — keyword Jaccard similarity.

Supports:
  --rebuild-cache           Build/rebuild the published articles cache
  --title + --summary       Check a single candidate
  --scan-queue <file>       Scan entire queue against cache
  --clean-queue <file>      Scan and auto-remove rejects from queue

Future: swap keyword Jaccard for Gemini text-embedding-004 when API key available.
"""

import argparse
import json
import os
import re
import sys
import yaml
from pathlib import Path
from urllib.parse import urlparse, urlunparse

# ============================================================================
# URL Normalization (shared with shell script)
# ============================================================================

URL_ALIASES = {
    ("claude.com", "/blog/auto-mode"): ("anthropic.com", "/engineering/claude-code-auto-mode"),
}

def normalize_url(url: str) -> str:
    """Normalize URL for dedup comparison."""
    url = url.strip().strip('"').strip("'")
    p = urlparse(url)
    
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    
    path = p.path.rstrip("/")
    
    query = "&".join(
        part for part in p.query.split("&")
        if part and not part.startswith(("utm_", "ref=", "source="))
    )
    
    for (alias_host, alias_path), (target_host, target_path) in URL_ALIASES.items():
        if host == alias_host and path.startswith(alias_path):
            host, path = target_host, target_path
            break
    
    return urlunparse(("https", host, path, "", query, ""))


# ============================================================================
# Keyword Extraction + Jaccard Similarity
# ============================================================================

def extract_en_keywords(text: str) -> set:
    """Extract English keywords (2+ chars, lowercased). Primary signal."""
    return set(re.findall(r'[a-zA-Z][a-zA-Z0-9]{1,}', text.lower()))


def extract_cn_bigrams(text: str) -> set:
    """Extract Chinese character bigrams. Secondary signal."""
    cn_chars = re.findall(r'[\u4e00-\u9fff]', text)
    return {cn_chars[i] + cn_chars[i + 1] for i in range(len(cn_chars) - 1)}


def jaccard(set_a: set, set_b: set) -> float:
    """Jaccard similarity between two sets."""
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


# Minimum overlapping English keywords (after stop word removal) to allow
# REJECT verdict. Below this, score is capped at FLAG tier to prevent
# false positives from common words like "anthropic" + "ai".
MIN_EN_OVERLAP_FOR_REJECT = 3

# Domain stop words: appear in >15% of gu-log articles.
# These words are too common to be discriminating on their own.
# They still contribute to Jaccard similarity score, but they DON'T
# count toward the minimum overlap threshold for REJECT.
DOMAIN_STOP_WORDS = {"ai", "agent", "claude", "code", "anthropic", "coding"}


def keyword_similarity(text_a: str, text_b: str) -> tuple:
    """Dual-track similarity: English Jaccard (0.7 weight) + Chinese bigram (0.3 weight).
    
    English keywords are the primary signal for tech articles — product names,
    author names, and technical terms are almost always in English.
    Chinese bigrams provide secondary signal for topic overlap.
    
    Returns (score, en_overlap_count) to enable the minimum overlap guard.
    """
    en_a = extract_en_keywords(text_a)
    en_b = extract_en_keywords(text_b)
    en_inter = en_a & en_b
    
    # Meaningful overlap = shared English words minus domain stop words
    meaningful_overlap = en_inter - DOMAIN_STOP_WORDS
    
    en_sim = jaccard(en_a, en_b)
    cn_sim = jaccard(extract_cn_bigrams(text_a), extract_cn_bigrams(text_b))
    
    # Weighted combination: English dominates, Chinese boosts
    score = en_sim * 0.7 + cn_sim * 0.3
    
    return (score, len(meaningful_overlap))


# ============================================================================
# Cache Management
# ============================================================================

def parse_frontmatter(filepath: Path) -> dict:
    """Extract frontmatter fields from an MDX file."""
    content = filepath.read_text(encoding="utf-8")
    
    # Find YAML frontmatter between --- delimiters
    match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return {}
    
    try:
        fm = yaml.safe_load(match.group(1))
        return fm if isinstance(fm, dict) else {}
    except yaml.YAMLError:
        return {}


def build_cache(posts_dir: str) -> dict:
    """Build cache of published articles with normalized URLs and keywords."""
    posts_path = Path(posts_dir)
    articles = []
    
    for mdx_file in sorted(posts_path.glob("*.mdx")):
        # Skip English translations (they share the same content)
        if mdx_file.name.startswith("en-"):
            continue
        
        fm = parse_frontmatter(mdx_file)
        if not fm:
            continue
        
        title = fm.get("title", "")
        summary = fm.get("summary", "")
        source_url = fm.get("sourceUrl", "")
        ticket_id = fm.get("ticketId", "")
        
        # Normalize URL
        norm_url = normalize_url(source_url) if source_url else ""
        
        # Build keyword text (title + summary for matching)
        keyword_text = f"{title} {summary}".strip()
        keywords = list(extract_en_keywords(keyword_text) | extract_cn_bigrams(keyword_text))
        
        articles.append({
            "file": mdx_file.name,
            "ticketId": ticket_id,
            "title": title,
            "summary": summary,
            "sourceUrl": source_url,
            "normalized_url": norm_url,
            "keyword_text": keyword_text,
            "keyword_count": len(keywords),
        })
    
    return {
        "version": 1,
        "engine": "keyword-jaccard",  # Will change to "gemini-embedding" later
        "article_count": len(articles),
        "articles": articles,
    }


# ============================================================================
# Single Candidate Check
# ============================================================================

def check_candidate(cache: dict, title: str, summary: str,
                    reject_threshold: float, flag_threshold: float) -> tuple:
    """
    Check a candidate against published articles using dual comparison:
    1. candidate title vs published title (tight match, prevents same-topic dupes)
    2. candidate title+summary vs published title+summary (broad match)
    Take the max score to catch both cases.
    
    Returns (verdict, score, match_info) where verdict is PASS/FLAG/REJECT.
    """
    candidate_full = f"{title} {summary}".strip()
    
    best_score = 0.0
    best_en_overlap = 0
    best_match = None
    
    for article in cache.get("articles", []):
        pub_title = article.get("title", "")
        pub_full = article.get("keyword_text", "")
        if not pub_title:
            continue
        
        # Dual comparison: title-vs-title (tight) and full-vs-full (broad)
        title_score, title_en = keyword_similarity(title, pub_title)
        full_score, full_en = keyword_similarity(candidate_full, pub_full)
        
        if title_score >= full_score:
            score, en_overlap = title_score, title_en
        else:
            score, en_overlap = full_score, full_en
        
        if score > best_score:
            best_score = score
            best_en_overlap = en_overlap
            best_match = article
    
    # Minimum overlap guard: if fewer than N English words overlap,
    # cap verdict at FLAG (never auto-reject on thin evidence like
    # "anthropic" + "ai" matching unrelated Anthropic articles)
    if best_score >= reject_threshold and best_en_overlap >= MIN_EN_OVERLAP_FOR_REJECT:
        return ("REJECT", best_score, best_match)
    elif best_score >= flag_threshold:
        return ("FLAG", best_score, best_match)
    else:
        return ("PASS", best_score, best_match)


# ============================================================================
# Queue Operations
# ============================================================================

def load_queue(queue_file: str) -> list:
    """Load candidates from queue YAML."""
    with open(queue_file, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("candidates", [])


def save_queue(queue_file: str, candidates: list):
    """Save candidates back to queue YAML."""
    with open(queue_file, "w", encoding="utf-8") as f:
        yaml.dump(
            {"candidates": candidates},
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
            width=200,
        )


def scan_queue(cache: dict, queue_file: str,
               reject_threshold: float, flag_threshold: float) -> list:
    """Scan entire queue, return results for each candidate."""
    candidates = load_queue(queue_file)
    results = []
    
    for i, c in enumerate(candidates):
        url = c.get("url", "")
        title = c.get("title", "")
        summary = c.get("summary", "")
        
        # Layer 1: URL match
        norm_url = normalize_url(url) if url else ""
        url_match = None
        for article in cache.get("articles", []):
            if article.get("normalized_url") == norm_url and norm_url:
                url_match = article
                break
        
        if url_match:
            results.append({
                "index": i,
                "verdict": "REJECT",
                "layer": 1,
                "score": 1.0,
                "reason": f"URL match → {url_match['ticketId']} {url_match['title'][:50]}",
                "candidate": title,
            })
            continue
        
        # Layer 2: Keyword similarity
        verdict, score, match = check_candidate(
            cache, title, summary, reject_threshold, flag_threshold
        )
        
        match_info = ""
        if match:
            match_info = f"{match.get('ticketId', '?')} {match['title'][:50]}"
        
        results.append({
            "index": i,
            "verdict": verdict,
            "layer": 2,
            "score": round(score, 3),
            "reason": f"Similarity {score:.3f} → {match_info}" if match else "No match",
            "candidate": title,
        })
    
    return results


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="CP Dedup Similarity Engine")
    parser.add_argument("--cache", required=True, help="Path to cache file")
    parser.add_argument("--posts-dir", required=True, help="Path to posts directory")
    parser.add_argument("--reject-threshold", type=float, default=0.30)
    parser.add_argument("--flag-threshold", type=float, default=0.18)
    
    # Modes
    parser.add_argument("--rebuild-cache", action="store_true")
    parser.add_argument("--title", help="Candidate title (single check)")
    parser.add_argument("--summary", default="", help="Candidate summary (single check)")
    parser.add_argument("--scan-queue", help="Queue file to scan")
    parser.add_argument("--clean-queue", help="Queue file to clean")
    
    args = parser.parse_args()
    
    # Rebuild cache
    if args.rebuild_cache:
        cache = build_cache(args.posts_dir)
        with open(args.cache, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
        print(f"✅ Cache built: {cache['article_count']} articles", file=sys.stderr)
        return
    
    # Load cache (rebuild if missing or stale)
    if not os.path.exists(args.cache):
        print("Cache missing, rebuilding...", file=sys.stderr)
        cache = build_cache(args.posts_dir)
        with open(args.cache, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    else:
        with open(args.cache, encoding="utf-8") as f:
            cache = json.load(f)
    
    # Single check mode
    if args.title:
        verdict, score, match = check_candidate(
            cache, args.title, args.summary,
            args.reject_threshold, args.flag_threshold,
        )
        
        if verdict == "REJECT":
            match_info = f"{match['ticketId']} — {match['title']}" if match else "?"
            print(f"🔴 REJECT (Layer 2: keyword similarity {score:.3f})")
            print(f"  Candidate: {args.title}")
            print(f"  Matches:   {match_info}")
            sys.exit(1)
        elif verdict == "FLAG":
            match_info = f"{match['ticketId']} — {match['title']}" if match else "?"
            print(f"🟡 FLAG (Layer 2: keyword similarity {score:.3f})")
            print(f"  Candidate: {args.title}")
            print(f"  Closest:   {match_info}")
            sys.exit(2)
        else:
            print(f"🟢 PASS (best similarity: {score:.3f})")
            sys.exit(0)
    
    # Scan queue mode
    if args.scan_queue:
        results = scan_queue(
            cache, args.scan_queue,
            args.reject_threshold, args.flag_threshold,
        )
        
        rejects = [r for r in results if r["verdict"] == "REJECT"]
        flags = [r for r in results if r["verdict"] == "FLAG"]
        passes = [r for r in results if r["verdict"] == "PASS"]
        
        if rejects:
            print(f"\n🔴 REJECT ({len(rejects)}):")
            for r in rejects:
                print(f"  [{r['index']}] L{r['layer']} {r['score']:.3f} | {r['candidate'][:60]}")
                print(f"       → {r['reason']}")
        
        if flags:
            print(f"\n🟡 FLAG ({len(flags)}):")
            for r in flags:
                print(f"  [{r['index']}] L{r['layer']} {r['score']:.3f} | {r['candidate'][:60]}")
                print(f"       → {r['reason']}")
        
        print(f"\n🟢 PASS: {len(passes)}")
        print(f"📊 Total: {len(results)} | Reject: {len(rejects)} | Flag: {len(flags)} | Pass: {len(passes)}")
        return
    
    # Clean queue mode
    if args.clean_queue:
        results = scan_queue(
            cache, args.clean_queue,
            args.reject_threshold, args.flag_threshold,
        )
        
        reject_indices = {r["index"] for r in results if r["verdict"] == "REJECT"}
        
        if not reject_indices:
            print("✅ No duplicates found in queue")
            return
        
        candidates = load_queue(args.clean_queue)
        
        print(f"Removing {len(reject_indices)} duplicates:")
        for r in results:
            if r["verdict"] == "REJECT":
                print(f"  ❌ [{r['index']}] {r['candidate'][:60]}")
                print(f"       → {r['reason']}")
        
        new_candidates = [c for i, c in enumerate(candidates) if i not in reject_indices]
        save_queue(args.clean_queue, new_candidates)
        
        print(f"\n✅ Queue cleaned: {len(candidates)} → {len(new_candidates)} candidates")
        return
    
    parser.print_help()


if __name__ == "__main__":
    main()
