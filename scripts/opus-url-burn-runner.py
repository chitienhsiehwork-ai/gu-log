#!/usr/bin/env python3
"""Claude Opus URL-only quota-burn runner for gu-log.

Runs blind Apple/Banana/Camera trials across claude-opus-4-7/4-6/4-5 from
one URL seed at a time. Results are local artifacts under .score-loop and do
not modify production posts.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import glob
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "src/content/posts"
OUT_ROOT = ROOT / ".score-loop/opus-url-burn"
MODELS = ["claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5"]
LABELS = ["Apple", "Banana", "Camera"]
TZ = dt.timezone(dt.timedelta(hours=8), "Asia/Taipei")
STOP = False

TASKS: list[tuple[str, str]] = [
    (
        "sp_draft",
        """
You start from exactly one URL:
{url}

Task: write a gu-log SP/CP-style article candidate from this URL only.
Requirements:
- Fetch/investigate the URL and any directly necessary public context.
- Produce a zh-tw article draft in gu-log voice: vivid 台灣中文, sharp ClawdNote-style stance, no corporate mush.
- Include title, subtitle, hook, sections, and 5-7 ClawdNote blocks.
- Preserve uncertainty: observed / inferred / speculative.
- End with 5 factual claims that must be manually verified before publication.
Do not ask for clarification. If the URL cannot be fetched, explain exactly what failed and still produce a useful fallback plan.
""",
    ),
    (
        "editorial_critique",
        """
You start from exactly one URL:
{url}

Task: act as a brutal gu-log editor evaluating what article should be written from this source.
Produce:
- one-sentence thesis
- strongest narrative angle
- 10 things a mediocre AI article would get wrong
- 8 concrete improvements for a gu-log-quality version
- likely factual traps and source-check checklist
- what Clawd would say that is not obvious from the source
Mark observed / inferred / speculative.
""",
    ),
    (
        "fact_grounding",
        """
You start from exactly one URL:
{url}

Task: perform source-grounding and factuality review for a future gu-log post.
Produce:
- key claims in the source, with confidence
- numbers, dates, product names, model names, and organization names to verify
- claims that are tempting but not supported
- likely outdated or ambiguous terminology
- links or search queries that would verify the fragile claims
- red/yellow/green publication risk table in prose bullets
Do not invent access. If blocked, say so.
""",
    ),
    (
        "engineering_strategy",
        """
You start from exactly one URL:
{url}

Task: extract product/engineering strategy lessons for gu-log readers.
Produce:
- technical mechanism, if any
- why this matters for people building agents/tools
- hidden constraints and second-order effects
- implementation checklist a founder/engineer could try this week
- what would make the idea fail in practice
- one contrarian read
Use fast-reading 台灣中文. Mark uncertainty.
""",
    ),
    (
        "overclaim_redteam",
        """
You start from exactly one URL:
{url}

Task: safe red-team the narrative before gu-log publishes anything based on it.
Do not do intrusive testing. Review only public information reachable from the URL.
Produce:
- overclaim risks
- hallucination traps for an article writer
- privacy/security/abuse considerations if relevant
- reader-misleading phrasings to avoid
- a conservative rewrite of the core claim
- 10 hard questions Sprin should ask before shipping
""",
    ),
]

KEYWORDS = re.compile(
    r"agent|claude|codex|openai|anthropic|model|llm|ai|mcp|harness|eval|tool|infra|"
    r"gpt|opus|vibe|workflow|computer-use|automation|prompt|context|token",
    re.I,
)


def log(msg: str) -> None:
    print(f"[{dt.datetime.now(TZ).isoformat(timespec='seconds')}] {msg}", flush=True)


def on_signal(signum: int, _frame: Any) -> None:
    global STOP
    STOP = True
    log(f"received signal {signum}; stopping after current batch")


def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    fm = parts[1]
    out: dict[str, str] = {}
    for key in ("title", "sourceUrl", "ticketId", "date"):
        m = re.search(rf"^{key}:\s*[\"']?(.+?)[\"']?\s*$", fm, re.M)
        if m:
            out[key] = m.group(1).strip().strip('"\'')
    return out


def extract_candidates(limit: int, include_all: bool = False) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path_s in glob.glob(str(POSTS / "*.mdx")):
        path = Path(path_s)
        if path.name.startswith("en-"):
            continue
        text = path.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)
        url = fm.get("sourceUrl", "")
        ticket = fm.get("ticketId", "")
        if not url or not re.match(r"https?://", url):
            continue
        slug = path.name
        if not include_all and not (slug.startswith(("sp-", "cp-")) or ticket.startswith(("SP-", "CP-"))):
            continue
        hay = " ".join([slug, ticket, fm.get("title", ""), url])
        score = 0
        if slug.startswith("sp-181"):
            score += 10000
        if KEYWORDS.search(hay):
            score += 500
        num_m = re.search(r"(?:sp|cp)-(\d+)", slug)
        if num_m:
            score += int(num_m.group(1))
        body_len = len(text.split("---", 2)[-1])
        if 3500 <= body_len <= 12000:
            score += 100
        if "bloomberg.com" in url or "techcrunch.com" in url:
            score -= 50
        rows.append({
            "post": slug,
            "ticketId": ticket,
            "title": fm.get("title", ""),
            "url": url,
            "body_len": body_len,
            "score": score,
        })
    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows[:limit]


def midnight_deadline() -> dt.datetime:
    now = dt.datetime.now(TZ)
    return dt.datetime(now.year, now.month, now.day, 23, 59, 30, tzinfo=TZ)


def shell_quote_for_record(argv: list[str]) -> str:
    import shlex
    return " ".join(shlex.quote(x) for x in argv)


def classify_quota_error(text: str) -> bool:
    t = text.lower()
    needles = ["quota", "usage limit", "rate limit", "subscription", "max plan", "billing", "too many requests"]
    return any(n in t for n in needles)


def run_one(model: str, label: str, prompt: str, trial_dir: Path, task: str, candidate: dict[str, Any], budget: float, timeout_sec: int) -> dict[str, Any]:
    started = dt.datetime.now(TZ)
    stem = f"{label.lower()}_{task}_{model}"
    raw_path = trial_dir / f"{stem}.json"
    md_path = trial_dir / f"{stem}.md"
    cmd = [
        "claude", "-p",
        "--model", model,
        "--output-format", "json",
        "--permission-mode", "bypassPermissions",
        "--tools", "WebFetch,WebSearch",
        "--max-budget-usd", str(budget),
        prompt,
    ]
    meta: dict[str, Any] = {
        "started_at": started.isoformat(timespec="seconds"),
        "label": label,
        "model": model,
        "task": task,
        "url": candidate["url"],
        "post": candidate["post"],
        "raw_path": str(raw_path),
        "md_path": str(md_path),
        "cmd": shell_quote_for_record(cmd[:12]) + " ...",
    }
    try:
        p = subprocess.run(cmd, cwd=str(ROOT), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout_sec)
        raw_path.write_text(p.stdout, encoding="utf-8")
        meta["exit_code"] = p.returncode
        meta["quota_like_error"] = classify_quota_error(p.stdout)
        result = p.stdout
        try:
            j = json.loads(p.stdout)
            meta["subtype"] = j.get("subtype")
            meta["total_cost_usd"] = j.get("total_cost_usd")
            meta["session_id"] = j.get("session_id")
            meta["modelUsage"] = j.get("modelUsage")
            meta["stop_reason"] = j.get("stop_reason")
            result = j.get("result") or p.stdout
        except Exception as e:
            meta["parse_error"] = repr(e)
        md_path.write_text(f"# {label} — {task}\n\nURL: {candidate['url']}\nPost: {candidate['post']}\n\n{result}\n", encoding="utf-8")
    except subprocess.TimeoutExpired as e:
        text = e.stdout if isinstance(e.stdout, str) else repr(e.stdout)
        raw_path.write_text(text or "", encoding="utf-8")
        md_path.write_text(f"# TIMEOUT {label} — {task}\n\n{text}\n", encoding="utf-8")
        meta["timeout"] = True
        meta["quota_like_error"] = classify_quota_error(text or "")
    except Exception as e:
        raw_path.write_text(repr(e), encoding="utf-8")
        md_path.write_text(f"# ERROR {label} — {task}\n\n{repr(e)}\n", encoding="utf-8")
        meta["error"] = repr(e)
        meta["quota_like_error"] = classify_quota_error(repr(e))
    meta["finished_at"] = dt.datetime.now(TZ).isoformat(timespec="seconds")
    meta["duration_sec"] = int((dt.datetime.now(TZ) - started).total_seconds())
    return meta


def usage_sample() -> dict[str, Any]:
    script = Path.home() / "clawd/scripts/usage-monitor.sh"
    if not script.exists():
        return {"error": "usage-monitor missing"}
    p = subprocess.run(["bash", str(script), "--json"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    try:
        return {"exit_code": p.returncode, "data": json.loads(p.stdout)}
    except Exception:
        return {"exit_code": p.returncode, "raw": p.stdout[-2000:]}


def main() -> int:
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    ap = argparse.ArgumentParser()
    ap.add_argument("--deadline", default="midnight", help="midnight or ISO datetime with timezone")
    ap.add_argument("--candidate-limit", type=int, default=24)
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--budget", type=float, default=12.0, help="max-budget-usd per Claude call guardrail")
    ap.add_argument("--timeout-sec", type=int, default=2400)
    ap.add_argument("--max-trials", type=int, default=999)
    ap.add_argument("--include-all", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.deadline == "midnight":
        deadline = midnight_deadline()
    else:
        deadline = dt.datetime.fromisoformat(args.deadline)
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=TZ)
    stamp = dt.datetime.now(TZ).strftime("%Y%m%d-%H%M%S")
    run_dir = OUT_ROOT / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = run_dir / "manifest.jsonl"
    quota_log = run_dir / "quota-samples.jsonl"

    candidates = extract_candidates(args.candidate_limit, include_all=args.include_all)
    (run_dir / "candidates.json").write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"RUN_DIR={run_dir}")
    log(f"deadline={deadline.isoformat(timespec='seconds')} candidates={len(candidates)}")
    if args.dry_run:
        for c in candidates:
            print(f"{c['ticketId']}\t{c['post']}\t{c['url']}\t{c['title']}")
        return 0
    if not candidates:
        log("no candidates found")
        return 2

    quota_errors = 0
    trial_no = 0
    while not STOP and trial_no < args.max_trials and dt.datetime.now(TZ) < deadline:
        candidate = candidates[trial_no % len(candidates)]
        task, tmpl = TASKS[trial_no % len(TASKS)]
        mapping_models = MODELS[:]
        random.shuffle(mapping_models)
        mapping = dict(zip(LABELS, mapping_models))
        trial_dir = run_dir / f"trial-{trial_no:04d}-{candidate['post'].removesuffix('.mdx')}-{task}"
        trial_dir.mkdir(parents=True, exist_ok=True)
        (trial_dir / "mapping.private.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
        (trial_dir / "candidate.json").write_text(json.dumps(candidate, ensure_ascii=False, indent=2), encoding="utf-8")
        prompt = tmpl.strip().format(url=candidate["url"])
        (trial_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
        sample = {"ts": dt.datetime.now(TZ).isoformat(timespec="seconds"), "event": "trial_start", "trial": trial_no, "usage": usage_sample()}
        with quota_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
        log(f"trial={trial_no} task={task} post={candidate['post']} url={candidate['url']}")
        log(f"blind labels={list(mapping.keys())}; mapping saved locally")

        metas: list[dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.parallel, 3)) as ex:
            futs = [
                ex.submit(run_one, model, label, prompt, trial_dir, task, candidate, args.budget, args.timeout_sec)
                for label, model in mapping.items()
            ]
            for fut in concurrent.futures.as_completed(futs):
                meta = fut.result()
                metas.append(meta)
                with manifest.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(meta, ensure_ascii=False) + "\n")
                log(json.dumps({k: meta.get(k) for k in ["label", "model", "task", "exit_code", "subtype", "total_cost_usd", "timeout", "quota_like_error"]}, ensure_ascii=False))
        qerr_this = sum(1 for m in metas if m.get("quota_like_error"))
        quota_errors = quota_errors + qerr_this if qerr_this else 0
        sample = {"ts": dt.datetime.now(TZ).isoformat(timespec="seconds"), "event": "trial_end", "trial": trial_no, "quota_like_errors_in_row": quota_errors, "usage": usage_sample()}
        with quota_log.open("a", encoding="utf-8") as f:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
        if quota_errors >= 3:
            log("stopping: repeated quota-like errors")
            break
        trial_no += 1

    summary = {
        "finished_at": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "trials_started": trial_no + (1 if trial_no < args.max_trials else 0),
        "stop_flag": STOP,
        "deadline": deadline.isoformat(timespec="seconds"),
        "quota_errors_in_row": quota_errors,
        "run_dir": str(run_dir),
    }
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"DONE RUN_DIR={run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
