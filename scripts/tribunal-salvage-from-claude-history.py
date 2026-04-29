#!/usr/bin/env python3
"""Recover Tribunal writer rewrites from Claude Code JSONL history.

This replays Read + Edit/MultiEdit/Write tool calls from ~/.claude/projects for
specific post slugs. It is intentionally conservative:
- only target zh-tw post + en-* counterpart are considered
- candidates must validate with scripts/validate-posts.mjs after scores are stripped
- high-confidence candidates require zh+en coverage when an en counterpart exists,
  non-trivial body diff, and no zh-tw body 你/我 outside note blocks
- default mode is dry-run; --apply copies only high-confidence candidates

Usage:
  python3 scripts/tribunal-salvage-from-claude-history.py \
    --invalidated .score-loop/state/tribunal-progress-invalidated-after-publish-fix.txt \
    --out .score-loop/salvage --limit 20
  python3 scripts/tribunal-salvage-from-claude-history.py ... --apply --max-apply 10
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

NOTE_RE = re.compile(r"<(ClawdNote|ShroomDogNote)>[\s\S]*?</\1>")
FM_RE = re.compile(r"^---\n([\s\S]*?)\n---\n", re.M)


@dataclass
class Candidate:
    session: Path
    files: Dict[str, str]
    actions: List[str] = field(default_factory=list)
    valid: bool = False
    reason: str = ""
    zh_pronoun_ni: int = 0
    zh_pronoun_wo: int = 0
    zh_diff_lines: int = 0
    en_diff_lines: int = 0
    score: int = 0


def load_jsonl(path: Path) -> Iterable[dict]:
    try:
        with path.open(errors="ignore") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except Exception:
                    continue
    except Exception:
        return


def tool_uses(obj: dict) -> Iterable[Tuple[str, dict]]:
    msg = obj.get("message") or {}
    cont = msg.get("content")
    if not isinstance(cont, list):
        return
    for item in cont:
        if isinstance(item, dict) and item.get("type") == "tool_use":
            yield item.get("name") or "", item.get("input") or {}


def read_results(obj: dict) -> Iterable[Tuple[str, str]]:
    tr = obj.get("toolUseResult")
    if isinstance(tr, dict) and tr.get("type") == "text" and isinstance(tr.get("file"), dict):
        fp = tr["file"].get("filePath") or ""
        content = tr["file"].get("content")
        if isinstance(content, str):
            yield fp, content

    msg = obj.get("message") or {}
    cont = msg.get("content")
    if isinstance(cont, list):
        for item in cont:
            if isinstance(item, dict) and item.get("type") == "tool_result":
                # Some Claude versions embed the read output as line-numbered text.
                continue


def normalize_tool_path(inp: dict) -> str:
    return inp.get("file_path") or inp.get("filePath") or ""


def strip_scores_frontmatter(text: str) -> str:
    m = FM_RE.match(text)
    if not m:
        return text
    fm = m.group(1).splitlines()
    out: List[str] = []
    skipping = False
    for line in fm:
        if line.startswith("scores:"):
            skipping = True
            continue
        if skipping:
            # Resume when a top-level key begins. Empty lines inside scores are skipped.
            if line and not line.startswith((" ", "\t")):
                skipping = False
                out.append(line)
            else:
                continue
        else:
            out.append(line)
    return "---\n" + "\n".join(out).rstrip() + "\n---\n" + text[m.end():]


def body_without_notes(text: str) -> str:
    m = FM_RE.match(text)
    body = text[m.end():] if m else text
    return NOTE_RE.sub("", body)


def diff_line_count(a: str, b: str) -> int:
    return sum(1 for line in difflib.unified_diff(a.splitlines(), b.splitlines()) if line.startswith(("+", "-")) and not line.startswith(("+++", "---")))


def replay_session(path: Path, slug: str) -> Candidate:
    state: Dict[str, str] = {}
    actions: List[str] = []
    for obj in load_jsonl(path):
        for fp, content in read_results(obj):
            if slug in fp and fp.endswith(".mdx"):
                state[fp] = content
        for name, inp in tool_uses(obj):
            fp = normalize_tool_path(inp)
            if slug not in fp or not fp.endswith(".mdx"):
                continue
            if name == "Write":
                content = inp.get("content")
                if isinstance(content, str):
                    state[fp] = content
                    actions.append(f"Write:{Path(fp).name}:{len(content)}")
            elif name == "Edit":
                old = inp.get("old_string") or inp.get("oldString") or ""
                new = inp.get("new_string") or inp.get("newString") or ""
                if fp in state and old in state[fp]:
                    state[fp] = state[fp].replace(old, new, 0 if inp.get("replace_all") else 1)
                    actions.append(f"Edit:{Path(fp).name}:{len(new)}")
                else:
                    actions.append(f"EditMISS:{Path(fp).name}:{len(old)}")
            elif name == "MultiEdit":
                ok = miss = 0
                for edit in inp.get("edits") or []:
                    old = edit.get("old_string") or edit.get("oldString") or ""
                    new = edit.get("new_string") or edit.get("newString") or ""
                    if fp in state and old in state[fp]:
                        state[fp] = state[fp].replace(old, new, 0 if edit.get("replace_all") else 1)
                        ok += 1
                    else:
                        miss += 1
                actions.append(f"MultiEdit:{Path(fp).name}:ok={ok}:miss={miss}")
    return Candidate(path, state, actions)


def validate_candidate(repo: Path, slug: str, cand: Candidate, outdir: Path) -> Candidate:
    post = f"{slug}.mdx"
    enpost = f"en-{slug}.mdx"
    current_zh = repo / "src/content/posts" / post
    current_en = repo / "src/content/posts" / enpost
    zh_key = next((k for k in cand.files if k.endswith("/" + post)), None)
    en_key = next((k for k in cand.files if k.endswith("/" + enpost)), None)
    if not zh_key:
        cand.reason = "no zh candidate"
        return cand
    if current_en.exists() and not en_key:
        cand.reason = "missing en counterpart"
        return cand

    zh_text = strip_scores_frontmatter(cand.files[zh_key])
    en_text = strip_scores_frontmatter(cand.files[en_key]) if en_key else None
    cand.zh_pronoun_ni = body_without_notes(zh_text).count("你")
    cand.zh_pronoun_wo = body_without_notes(zh_text).count("我")
    cand.zh_diff_lines = diff_line_count(current_zh.read_text(), zh_text)
    if en_text is not None and current_en.exists():
        cand.en_diff_lines = diff_line_count(current_en.read_text(), en_text)

    # material rewrite guard: avoid applying candidates that only differ by scores or tiny edits
    if cand.zh_diff_lines < 10:
        cand.reason = f"tiny zh diff ({cand.zh_diff_lines})"
        return cand
    if current_en.exists() and cand.en_diff_lines < 10:
        cand.reason = f"tiny en diff ({cand.en_diff_lines})"
        return cand

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        zh_tmp = td / post
        zh_tmp.write_text(zh_text)
        paths = [str(zh_tmp)]
        if en_text is not None:
            en_tmp = td / enpost
            en_tmp.write_text(en_text)
            paths.append(str(en_tmp))
        # validate-posts accepts arbitrary file paths.
        res = subprocess.run(["node", "scripts/validate-posts.mjs", *paths], cwd=repo, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if res.returncode != 0:
            cand.reason = "validate failed: " + res.stdout[-500:].replace("\n", " ")
            return cand

    cand.valid = True
    cand.reason = "valid"
    # simple score: prefer latest full edits, no pronouns, bigger material diffs, fewer miss edits
    miss = sum(1 for a in cand.actions if "MISS" in a)
    cand.score = 100 + cand.zh_diff_lines + cand.en_diff_lines - 20 * miss - 30 * (cand.zh_pronoun_ni + cand.zh_pronoun_wo)

    safe = outdir / slug
    safe.mkdir(parents=True, exist_ok=True)
    (safe / post).write_text(zh_text)
    if en_text is not None:
        (safe / enpost).write_text(en_text)
    (safe / "source-session.txt").write_text(str(cand.session) + "\n" + "\n".join(cand.actions) + "\n")
    return cand


def candidate_sessions(history_root: Path, slug: str) -> List[Path]:
    out: List[Tuple[float, Path]] = []
    for p in history_root.rglob("*.jsonl"):
        try:
            txt = p.read_text(errors="ignore")
        except Exception:
            continue
        if slug in txt and any(n in txt for n in ('"name":"Edit"', '"name":"Write"', '"name":"MultiEdit"')):
            out.append((p.stat().st_mtime, p))
    return [p for _, p in sorted(out, reverse=True)]


def apply_candidate(repo: Path, slug: str, outdir: Path) -> None:
    srcdir = outdir / slug
    for name in [f"{slug}.mdx", f"en-{slug}.mdx"]:
        src = srcdir / name
        dst = repo / "src/content/posts" / name
        if src.exists():
            shutil.copyfile(src, dst)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--history-root", default=str(Path.home() / ".claude/projects"))
    ap.add_argument("--invalidated", required=True)
    ap.add_argument("--out", default=".score-loop/salvage")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--max-apply", type=int, default=10)
    ap.add_argument("--max-sessions-per-post", type=int, default=30)
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    history_root = Path(args.history_root).expanduser().resolve()
    outdir = (repo / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    report = []

    slugs = [line.strip().removesuffix(".mdx") for line in Path(args.invalidated).read_text().splitlines() if line.strip()]
    if args.limit:
        slugs = slugs[: args.limit]

    applied = 0
    for slug in slugs:
        sessions = candidate_sessions(history_root, slug)
        cands: List[Candidate] = []
        for p in sessions[: args.max_sessions_per_post]:
            cand = replay_session(p, slug)
            if any(not a.startswith("EditMISS") for a in cand.actions):
                cands.append(validate_candidate(repo, slug, cand, outdir))
        valids = [c for c in cands if c.valid]
        valids.sort(key=lambda c: c.score, reverse=True)
        if not valids:
            best_reason = cands[0].reason if cands else "no edit sessions"
            report.append({"slug": slug, "status": "no_candidate", "sessions": len(sessions), "reason": best_reason})
            continue
        best = valids[0]
        high = best.zh_pronoun_ni == 0 and best.zh_pronoun_wo == 0 and best.zh_diff_lines >= 10 and (best.en_diff_lines >= 10 or not (repo / "src/content/posts" / f"en-{slug}.mdx").exists())
        status = "high" if high else "review"
        if args.apply and high and applied < args.max_apply:
            apply_candidate(repo, slug, outdir)
            applied += 1
            status = "applied"
        report.append({
            "slug": slug,
            "status": status,
            "sessions": len(sessions),
            "session": str(best.session),
            "zh_diff_lines": best.zh_diff_lines,
            "en_diff_lines": best.en_diff_lines,
            "zh_pronoun_ni": best.zh_pronoun_ni,
            "zh_pronoun_wo": best.zh_pronoun_wo,
            "score": best.score,
            "actions": best.actions,
        })

    (outdir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    counts: Dict[str, int] = {}
    for r in report:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(json.dumps({"posts": len(slugs), "counts": counts, "applied": applied, "out": str(outdir)}, ensure_ascii=False, indent=2))
    for r in report[:80]:
        print(r["status"], r["slug"], "sessions", r.get("sessions"), "diff", r.get("zh_diff_lines"), r.get("en_diff_lines"), "pron", r.get("zh_pronoun_ni"), r.get("zh_pronoun_wo"), "reason", r.get("reason", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
