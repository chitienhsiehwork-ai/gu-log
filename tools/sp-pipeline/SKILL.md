# sp-pipeline SKILL

Agent-facing usage guide. If you are a future Claude / Codex / Gemini session picking up work on gu-log, read this before running any `sp-pipeline` subcommand.

> **Status**: Phase 2a. `doctor`, `fetch`, `counter`, and `dedup` are fully implemented. `eval`/`write`/`review`/`refine`/`ralph`/`deploy`/`run` are stubs that exit non-zero — do not rely on them yet.

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
| "Is my environment set up correctly?" | `sp-pipeline doctor` | Walks PATH + repo-relative files, exits 0 if all required deps present |
| "Can the LLM providers respond non-interactively?" | `sp-pipeline doctor --probe-llm` | Sends a 1-token canary to each provider, reports ok/error/missing |
| "I have a tweet URL and want to start an SP" | `sp-pipeline fetch <url>` | Captures into `$REPO/tmp/sp-pending-<epoch>-pipeline/source-tweet.md`, prints the path |
| "What ticketId will the next SP use?" | `sp-pipeline counter next --prefix SP` | Reads `scripts/article-counter.json` without mutation |
| "Allocate a new ticketId" | `sp-pipeline counter bump --prefix SP` | Atomically advances the counter under `flock`, prints the value just allocated |
| "Is this source already covered?" | `sp-pipeline dedup --url <x> --title <t>` | Wraps `scripts/dedup-gate.mjs`, returns PASS / WARN / BLOCK |
| "Run the whole pipeline" | *stubbed* — use `bash scripts/sp-pipeline.sh <url>` for now | Phase 2b target |

## Global flags

All subcommands inherit these from the root command:

- `--json` — single JSON object on stdout, human-readable logs on stderr. Use this whenever another agent parses the output
- `--verbose` / `-v` — extra debug logs on stderr (currently reserved; no extra output yet)
- `--timeout 50m` — wall-clock deadline for the whole invocation (Go duration string). Default 50m matches the bash pipeline's `PIPELINE_TIMEOUT=3000`
- `--work-dir <dir>` — pin the pipeline work directory. Default is `$REPO/tmp/sp-pending-<unix>-pipeline`

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

**Safe to run autonomously** (read-only or sandboxed to `tmp/`):

- `doctor`, `doctor --probe-llm`
- `fetch` (writes only to `tmp/sp-pending-<epoch>-pipeline/`)
- `counter next` (read-only)
- `dedup` (read-only, invokes the Node gate)
- Future: `eval`, `write`, `review`, `refine`, `ralph` (all sandboxed to `tmp/`)

**Requires explicit user approval** (mutates shared state):

- `counter bump` — modifies `scripts/article-counter.json` under flock. Safe but the mutation IS visible to concurrent pipelines, so only call this when you actually mean to allocate a ticketId
- `deploy` — validates, builds, commits, pushes to origin
- `run` — wraps `deploy`

In practice: call `counter next` first, confirm with the user, THEN call `counter bump` right before writing the article file.

## Common failure modes

### "doctor: missing required binary: python3"

The pipeline depends on `python3` for `scripts/fetch-article.py` (non-X URL fallback). Install it.

### "fetch: source validation failed"

fetch shelled out to `scripts/fetch-x-article.sh`, got output, but the native Go validator rejected it. Read the reason:

- `capture too short (<120 chars)` → fxtwitter returned an empty body. Retry once
- `capture contains tool-exec scaffolding markers` → the capture has `tool=exec` / `Process exited with code` / `fetch-agent-stderr.log` markers. This is a bash-pipeline bug leaking into stdout; investigate `scripts/fetch-x-article.sh`
- `capture missing required @handle + date/source-url header` → the X URL returned something unexpected. Try `--json` and inspect the raw stdout under `tmp/`

### "doctor --probe-llm: claude-opus: error: exit code 1"

The `claude` CLI is installed but cannot run non-interactively in this shell. This is the predicted failure mode for `claude -p` in a subprocess without a TTY. Possible fixes:

- Run `claude` interactively once to seed credentials
- Set `CLAUDE_API_KEY` directly in the environment
- If on CCC (no interactive auth available), use `scripts/sp-pipeline.sh` for now and file an issue — Phase 2 needs to handle this properly

### "sp-pipeline: 'go' not found on PATH"

You are on a machine without Go 1.24+. Install it from https://go.dev/dl/ or ask the user to do so. On CCC sandboxes Go is pre-installed at `/usr/local/go/bin/go`.

## Relationship to `scripts/sp-pipeline.sh`

Phase 1 is purely additive. The bash pipeline is untouched and remains the production entry point until Phase 4.

Safe assumption: `bash scripts/sp-pipeline.sh <url>` always works (it is tested in CI); `sp-pipeline run <url>` does NOT work yet (Phase 2 target). Use the bash pipeline when the user asks for "run the full pipeline"; use the Go binary when you want to run a single step in isolation (`fetch`, `doctor`).

## Reporting issues

File issues at `anthropics/claude-code` if a subcommand crashes or prints unexpected output. Include the full `--json` report, the environment info from `sp-pipeline doctor`, and the tweet URL (if applicable) so the failure can be reproduced.
