# sp-pipeline SKILL

Agent-facing usage guide. If you are a future Claude / Codex / Gemini session picking up work on gu-log, read this before running any `sp-pipeline` subcommand.

> **Status**: Phase 4 complete. Every subcommand is live. `sp-pipeline run <url>` is the canonical entry point. `scripts/sp-pipeline.sh` is a thin shim that execs into this binary.

## What this binary is

`sp-pipeline` is the Go rewrite of `scripts/sp-pipeline.sh`. It exists because the bash pipeline hit 1428 lines, embedded two Python validators, and grew an in-house LLM dispatcher — all of which are easier to test, compose, and reason about in Go.

Design brief: Nick Baumann's "bespoke CLI + skill wrapper" pattern (translated as gu-log SP-170). Every step of the pipeline is a separate subcommand. Every subcommand has `--json` output so another agent can parse the result and compose the next step.

## The build step

The binary is not checked into git. Before running any subcommand, the self-compiling wrapper handles the first-time build automatically:

```bash
tools/sp-pipeline/sp-pipeline doctor
```

Expected: first call takes ~3 seconds (cold compile), subsequent calls are instant. If the wrapper reports `"go" not found on PATH`, install Go >= 1.24 before continuing.

## Which subcommand to run first

| User intent | Run | Why |
|-------------|-----|-----|
| **"Run the whole pipeline on a tweet URL"** | `sp-pipeline run <url>` | The canonical end-to-end entry point — fetch → eval → dedup → write → review → refine → credits → ralph → deploy |
| **"User wants a specific narrative angle"** | `sp-pipeline run --angle "focus on X while introducing the others" <url>` | Pipes the directive into the write + refine prompts; opening must establish the angle, closing must call back to it |
| **"Source is a docs / blog page, not a tweet"** | `sp-pipeline run --source-label "OpenClaw Docs" <url>` | Overrides the `source:` frontmatter line; without it, generic URLs render hostname (`docs.openclaw.ai`) which is usually fine but not pretty |
| "Resume a stuck run from a specific step" | `sp-pipeline run --from-step <name> --file <existing.mdx>` | Honors bash's `--from-step` contract: setup / fetch / eval / dedup / write / review / refine / ralph / deploy |
| "Run everything except deploy" | `sp-pipeline run --dry-run <url>` | Stops before the deploy step |
| "Is my environment set up correctly?" | `sp-pipeline doctor` | Walks PATH + repo-relative files, exits 0 if all required deps present |
| "Can the LLM providers respond non-interactively?" | `sp-pipeline doctor --probe-llm` | Sends a 1-token canary to each provider, reports ok/error/missing |
| "Just capture a tweet without running anything else" | `sp-pipeline fetch <url>` | Captures into `$REPO/tmp/sp-pending-<epoch>-pipeline/source-tweet.md` |
| "What ticketId will the next SP use?" | `sp-pipeline counter next --prefix SP` | Reads counter without mutating |
| "Allocate a new ticketId" | `sp-pipeline counter bump --prefix SP` | Atomically advances under `flock` |
| "Is this source already covered?" | `sp-pipeline dedup --url <x> --title <t>` | Wraps `scripts/dedup-gate.mjs` |
| "Run just one LLM-heavy step" | `sp-pipeline {eval,write,review,refine} --source ...` | Each step is independently callable; `--fake-provider` pins canned responses for tests |
| "Run the 4-stage tribunal on an existing post" | `sp-pipeline ralph --file <sp-NNN-*.mdx>` | Wraps `scripts/tribunal-all-claude.sh` + runs the frontmatter normaliser |
| "Patch pipeline credits into a final.mdx for debugging" | `sp-pipeline credits --file <final.mdx>` | Step 4.6 standalone |
| "Deploy a recovered article" | `sp-pipeline deploy --active-file ... --title ...` | Step 5 standalone — counter bump + rename + commit + push |

## Global flags

All subcommands inherit these from the root command:

- `--json` — single JSON object on stdout, human-readable logs on stderr. Use this whenever another agent parses the output
- `--verbose` / `-v` — extra debug logs on stderr (currently reserved; no extra output yet)
- `--timeout 50m` — wall-clock deadline for the whole invocation (Go duration string). Default 50m matches the bash pipeline's `PIPELINE_TIMEOUT=3000`
- `--work-dir <dir>` — pin the pipeline work directory. Default is `$REPO/tmp/sp-pending-<unix>-pipeline`

## `run` / `write` / `refine` shaping flags

These three flags shape the LLM output without changing the step sequence. Use them when the default "translate this faithfully, X-source attribution" behavior doesn't fit:

- `--angle "<directive>"` (run, write, refine) — narrative directive. Empty = default "cover ALL ideas with equal weight" stance. When set, the write + refine prompts get an extra section telling the LLM to pivot the article's spine around the directive: opening establishes the angle within 3 paragraphs, closing calls back to it, other source material becomes supporting characters. **Pass the SAME `--angle` to both `write` and `refine`** — refine without it can flatten the angle when applying review feedback. `run --angle ...` propagates automatically.
- `--source-label "<label>"` (run, write) — overrides the `source:` frontmatter line. Empty = auto: `@<handle> on X` for X URLs, hostname for everything else. Set this for docs / blog / institutional sources where the hostname is ugly (e.g. `--source-label "OpenAI Cookbook"` for a github.com/openai/openai-cookbook capture).
- `--source-is-x=false` (write standalone only) — pair with `--author <hostname>` when calling `write` directly on a generic URL capture; `run` infers this from the fetch result automatically.

Example: SP from a docs page with a custom angle:

```bash
tools/sp-pipeline/sp-pipeline run \
  --angle "Focus on Task Flow while introducing the others. Use intriguing stories to cover the knowledge." \
  --source-label "OpenClaw Docs" \
  https://docs.openclaw.ai/automation
```

## JSON output contract

Every subcommand emits a single JSON object on stdout when `--json` is set:

```json
{
  "ok": true,
  "step": "fetch",
  "url": "https://x.com/nickbaumann_/status/...",
  "output": {
    "sourceFile": "/.../tmp/sp-pending-.../source-tweet.md",
    "handle": "@nickbaumann_",
    "date": "2026-04-10",
    "fetchedVia": "fxtwitter",
    "bytes": 3421
  },
  "elapsedMs": 4320
}
```

On error:

```json
{
  "ok": false,
  "step": "fetch",
  "url": "https://x.com/...",
  "errorCode": 11,
  "error": "source validation failed: capture contains tool-exec scaffolding markers",
  "elapsedMs": 1200
}
```

## Exit codes

Distinct per failure mode so agents can branch on `$?` without parsing stderr:

| Code | Meaning | Retry advice |
|------|---------|--------------|
| 0 | success | — |
| 1 | generic error | Read stderr, escalate |
| 2 | split eval verdict (go/skip mismatch) | User decides — not automatically retryable |
| 10 | fetch failed (fxtwitter + vxtwitter both dead) | Retry once after 30s. If still failing, ask user to paste the tweet body |
| 11 | capture validation failed | Do NOT retry. The capture is contaminated or truncated — do not translate it. See `CONTRIBUTING.md` Source Completeness rules |
| 12 | eval rejected (SKIP/SKIP) | Not an error — the evaluator said this source is not SP-worthy. Drop from queue |
| 13 | dedup gate blocked | Check the printed match; the source is already covered. Either skip or justify to the user |
| 14 | all LLM providers failed | Run `sp-pipeline doctor --probe-llm` to diagnose which provider is down |
| 15 | ralph quality bar not met | Run `sp-pipeline ralph --file <mdx>` again with feedback; escalate after 3 failed rewrites |
| 16 | validate-posts.mjs rejected | Read the validator output, fix the frontmatter or content, retry |
| 17 | `pnpm run build` failed | Astro build broke — almost always a regression in the MDX or a component |
| 18 | git push failed | Check network, check if `claude/xxx` branch exists upstream |
| 124 | pipeline timeout | The whole invocation blew the `--timeout` budget. Default is 50m |

## Which actions need approval

**Safe to run autonomously** (read-only, tmp-scoped, or file-scoped under --file):

- `doctor`, `doctor --probe-llm`
- `fetch` (writes only to `tmp/sp-pending-<epoch>-pipeline/`)
- `counter next` (read-only)
- `dedup` (read-only, invokes the Node gate)
- `eval`, `write`, `review`, `refine` (each writes only under `--work-dir`)
- `ralph --file <sp-NNN-*.mdx>` (mutates a SINGLE posts/ file with a deterministic frontmatter normaliser; safe because the file is already committed)
- `credits --file <final.mdx>` (debugging single-file mutation)
- `run --dry-run <url>` (skips the deploy step)

**Requires explicit user approval** (mutates shared state):

- `counter bump` — advances `scripts/article-counter.json` under flock. Safe but visible to concurrent pipelines
- `deploy` — validates, builds, commits, pushes to origin
- `run <url>` (WITHOUT `--dry-run`) — wraps all of the above

In practice: call `counter next` first, confirm with the user, THEN call `counter bump` right before writing the article file. For unattended agent runs, `run --dry-run` is the safest rehearsal.

## Common failure modes

### "doctor: missing required binary: python3"

The pipeline depends on `python3` for `scripts/fetch-article.py` (non-X URL fallback). Install it.

### "fetch: source validation failed"

fetch shelled out to `scripts/fetch-x-article.sh`, got output, but the native Go validator rejected it. Read the reason:

- `capture too short (<120 chars)` → fxtwitter returned an empty body. Retry once
- `capture contains tool-exec scaffolding markers` → the capture has `tool=exec` / `Process exited with code` / `fetch-agent-stderr.log` markers. This is a bash-pipeline bug leaking into stdout; investigate `scripts/fetch-x-article.sh`
- `capture missing required @handle + date/source-url header` → the X URL returned something unexpected. Try `--json` and inspect the raw stdout under `tmp/`

### "doctor --probe-llm: claude-opus: error: exit code 1"

`claude -p` is installed but the 1-token canary did not complete. Common causes:

- **`--dangerously-skip-permissions cannot be used with root/sudo privileges`** — Claude Code refuses the permission-bypass flags under root. `ClaudeProvider.Run` and the shell judges now drop those flags when `id -u == 0` (CCC), so this shouldn't surface from the current Go/shell call sites. If you see it, something upstream still passes the flag; grep for `dangerously-skip-permissions` and `permission-mode` and gate the match with an `id -u` check.
- **Canary stalls on CLAUDE.md discovery (CCC)** — without the bypass flag, `claude -p` runs in the default permission mode, auto-discovers `CLAUDE.md`, and may try context-aware work on the repo instead of answering the canary. It will stall waiting for permission it can't receive and hit the 30 s probe timeout with an empty error. Real creative prompts (write / review / refine) are less susceptible because the task is the prompt, not the repo — but a red probe does NOT prove the real pipeline is broken. Try `sp-pipeline run --dry-run <url>` before escalating.
- **Credentials** — run `claude` interactively once to seed them, or set `ANTHROPIC_API_KEY`.
- **No TTY** — harmless for `-p` in non-interactive shells; no fix needed.

### "sp-pipeline: 'go' not found on PATH"

You are on a machine without Go 1.24+. Install it from https://go.dev/dl/ or ask the user to do so. On CCC sandboxes Go is pre-installed at `/usr/local/go/bin/go`.

## Relationship to `scripts/sp-pipeline.sh`

Phase 1 is purely additive. The bash pipeline is untouched and remains the production entry point until Phase 4.

Safe assumption: `bash scripts/sp-pipeline.sh <url>` always works (it is tested in CI); `sp-pipeline run <url>` does NOT work yet (Phase 2 target). Use the bash pipeline when the user asks for "run the full pipeline"; use the Go binary when you want to run a single step in isolation (`fetch`, `doctor`).

## Reporting issues

File issues at `anthropics/claude-code` if a subcommand crashes or prints unexpected output. Include the full `--json` report, the environment info from `sp-pipeline doctor`, and the tweet URL (if applicable) so the failure can be reproduced.
