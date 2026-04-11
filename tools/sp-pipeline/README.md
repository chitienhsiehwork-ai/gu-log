# sp-pipeline

The gu-log SP/CP translation pipeline, Go edition. `scripts/sp-pipeline.sh` is now a thin shim that execs into this binary.

> **Status**: Phase 4 complete. `run` is the canonical entry point. `doctor`, `fetch`, `eval`, `write`, `review`, `refine`, `credits`, `ralph`, `deploy`, `dedup`, `counter`, and `run` are all implemented. Phase 5 (native port of `fetch-x-article.sh` and `ralph-all-claude.sh`) is explicitly out of scope — those stay as bash helpers.

## Why a Go rewrite

`scripts/sp-pipeline.sh` is 1428 lines of bash that orchestrates a 10-step pipeline: fetch → eval → dedup → write → review → refine → credits → ralph tribunal → deploy. It works, but it has hit the complexity ceiling of bash:

- Two inline Python heredoc validators (embedded `python3 - <<'PY'` blocks) that cannot be tested in isolation
- A home-grown LLM dispatcher (`run_with_fallback`) with ~60 lines of tempfile bookkeeping per call
- A background `sleep | kill -TERM $$` subshell for the 50-minute timeout watchdog
- Four separate `sed -i` mutations of MDX frontmatter scattered across three steps
- `flock` + `jq` + `mv` dance to bump `scripts/article-counter.json` atomically
- An `--from-step` flag whose implementation is an integer-threshold check duplicated at every step

None of these are wrong — they are just pushing bash past its good zone. Go gets us: proper testing, typed errors, `context.Context` propagation, one code path per LLM provider, native frontmatter round-tripping with `yaml.v3`, and the kind of `--help` discipline Nick Baumann's bespoke-CLI post is entirely about (and which SP-170 translates in detail, if you want the philosophy).

## Design philosophy (bespoke CLI + skill)

Every step is a subcommand. Agents compose them without running the whole monolith:

```bash
sp-pipeline fetch <url>                      # step 1 only
sp-pipeline eval --source <file>             # step 1.5
sp-pipeline dedup --url <url> --title <t>    # step 1.7
sp-pipeline write --source <file>            # step 2
sp-pipeline review --draft <file>            # step 3
sp-pipeline refine --draft <file>            # step 4
sp-pipeline ralph --file <mdx>               # step 4.7
sp-pipeline deploy --file <mdx>              # step 5
sp-pipeline run <url>                        # whole pipeline
sp-pipeline doctor [--probe-llm]             # preflight checks
sp-pipeline counter {next,bump} --prefix SP  # ticket counter
```

Global flags: `--json` (machine output), `--verbose`, `--timeout 50m`, `--work-dir <dir>`.

Exit codes are distinct so failures can be handled programmatically:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | generic error |
| 2 | split eval verdict (GO/SKIP mismatch) |
| 10 | source fetch failed after all fallbacks |
| 11 | source validation failed (contaminated / paywall) |
| 12 | eval rejected (SKIP/SKIP) |
| 13 | dedup gate blocked |
| 14 | LLM dispatcher failure (all providers exhausted) |
| 15 | ralph quality bar not met (strict mode only) |
| 16 | validate-posts.mjs rejected the article |
| 17 | `pnpm run build` failed |
| 18 | git push failed |
| 124 | pipeline timeout (matches GNU `timeout`) |

See [`SKILL.md`](./SKILL.md) for the agent-facing subcommand contract.

## Build

The binary is **not checked into git**. Use the self-compiling wrapper:

```bash
tools/sp-pipeline/sp-pipeline doctor
```

First invocation cold-builds into `tools/sp-pipeline/bin/sp-pipeline` (takes ~3 seconds); subsequent invocations reuse the binary and are effectively instant. Go's incremental build cache handles source-file change detection.

Direct build (if you prefer):

```bash
cd tools/sp-pipeline
make build      # or: go build -o bin/sp-pipeline ./cmd/sp-pipeline
make test       # or: go test ./...
make doctor     # build + run doctor
```

Requirements:

- Go >= 1.24 (verified in CI; `sp-pipeline doctor` reports the detected version)
- Everything `sp-pipeline doctor` checks (bash, node, python3, git, curl) — these are shared with the existing bash pipeline

## Repository layout

```
tools/sp-pipeline/
├── sp-pipeline                      # self-compiling bash wrapper (entry point)
├── Makefile                         # build / test / vet / fmt / clean targets
├── go.mod / go.sum                  # Go module
├── README.md                        # this file
├── SKILL.md                         # agent-facing usage guide
├── cmd/sp-pipeline/
│   ├── main.go                      # cobra root + typed ExitError + stub subcommands
│   ├── doctor.go                    # `doctor` implementation
│   ├── fetch.go                     # `fetch` implementation
│   ├── counter.go                   # `counter next/bump` implementation
│   └── dedup.go                     # `dedup` implementation
├── internal/
│   ├── config/                      # resolve repo-relative paths
│   ├── logx/                        # colored + JSON logger
│   ├── runner/                      # exec.CommandContext wrapper
│   ├── source/                      # fetch + validate (native Go port of Python validators)
│   ├── frontmatter/                 # MDX frontmatter text-level mutation (replaces sed -i)
│   ├── counter/                     # article-counter.json with syscall.Flock atomic bump
│   ├── dedup/                       # wrapper around scripts/dedup-gate.mjs
│   └── llm/                         # dispatcher + claude/codex/gemini providers
└── testdata/                        # fixtures for source validator tests
    └── clean-fxtwitter.md
```

## Migration plan (6 phases)

| Phase | Scope | Risk | Status |
|-------|-------|------|--------|
| **1** | Scaffold, `doctor`, `fetch`, LLM dispatcher, Python validator → Go port | 🟢 low | **done** |
| **2a** | `internal/frontmatter`, `internal/counter`, `internal/dedup`, `counter next/bump`, `dedup` subcommand, typed ExitError | 🟢 low | **done** |
| **2b** | `eval`, `write`, `review`, `refine`, `internal/prompts` (embed.FS + text/template), `FakeProvider` for CCC unit tests | 🟡 medium | **done** |
| **3** | `credits`, `ralph` (wraps `ralph-all-claude.sh`), `deploy` (counter bump → rename → validate → build → commit → push) | 🟡 medium | **done** |
| **2c** | `run` orchestrator with `--from-step`, `--dry-run`, `--force`, `--opus`, `--file`, etc. | 🟡 medium | **done** |
| **4** | Docs cutover, `scripts/sp-pipeline.sh` → 49-line shim, `CLAUDE.md`/`CONTRIBUTING.md`/`crontab-tribunal.example` updated | 🟢 low | **done** |
| 5 | Native port of `fetch-x-article.sh` + `ralph-all-claude.sh` | 🟠 high | **out of scope** — bash helpers stay |
| 6 | Delete the shim | 🟢 low | **not planned** — 49-line shim is free insurance for unknown callers |

The existing Node / Python helpers (`validate-posts.mjs`, `detect-model.mjs`, `frontmatter-scores.mjs`, `dedup-gate.mjs`, `fetch-article.py`) stay in their current languages forever — they are part of the Astro build and outside the pipeline hot path.

## Acceptance (all phases done)

- [x] `go fmt / go vet / go build / go test ./...` clean with zero cache
- [x] `sp-pipeline --help` lists every subcommand, no stubs left
- [x] `sp-pipeline doctor` reports binary + file health
- [x] `sp-pipeline fetch <url>` captures a tweet into the work dir (native Go validator, no shell-out)
- [x] `sp-pipeline counter next/bump --prefix SP` uses syscall.Flock, 20-goroutine concurrency test
- [x] `sp-pipeline dedup` wraps `dedup-gate.mjs`, exit 13 on BLOCK
- [x] `sp-pipeline eval` runs two evaluators via FakeProvider (CCC) or real LLM chain (mac-CC), GO/GO / SKIP/SKIP / split exit codes
- [x] `sp-pipeline write` renders `internal/prompts/write.tmpl` with source + style guide, outputs draft-v1.mdx
- [x] `sp-pipeline review` / `sp-pipeline refine` run their respective prompts with stdout fallback
- [x] `sp-pipeline credits` stamps the 4-entry pipeline block via `frontmatter.SetBlock` — verified round-trip on real SP-170
- [x] `sp-pipeline ralph --file <mdx>` wraps `scripts/ralph-all-claude.sh`, runs the frontmatter normaliser, log-and-continues on tribunal failure
- [x] `sp-pipeline deploy` bumps counter → renames pending → replaces frontmatter ticketId → validates → builds → commits → pushes (with `SkipBuild`/`SkipPush`/`SkipValidate` test hooks)
- [x] `sp-pipeline run <url>` walks all 9 steps end-to-end in the happy path; `--from-step ralph --file <mdx>` resumes on SP-170
- [x] `scripts/sp-pipeline.sh` is a 49-line shim that translates env vars → flags and execs into the Go binary
- [x] No binary checked into git (self-compiling wrapper handles cold start)

**CCC sandbox cannot verify** (mac-CC responsibility):
- Real `claude -p --model opus` invocation under a non-TTY subprocess
- Real `codex exec` / `gemini` CLI calls
- Full production run on a live X URL with the real LLM chain

## References

- Nick Baumann, "The best tools I give Codex are bespoke CLIs" — this is the literal design brief for the CLI shape. Gu-log's SP-170 is a translation: `src/content/posts/sp-170-20260411-nickbaumann-codex-bespoke-cli-skill.mdx`
- `scripts/sp-pipeline.sh` — production pipeline, the source of truth for pipeline behaviour
- `scripts/ralph-all-claude.sh` — 4-stage tribunal, wrapped in Phase 3 and ported in Phase 5
- `scripts/fetch-x-article.sh` — tweet capture script, wrapped today and ported in Phase 5
