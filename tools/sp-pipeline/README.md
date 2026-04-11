# sp-pipeline

Go rewrite of `scripts/sp-pipeline.sh`. Under construction — Phase 1 of a 6-phase migration.

> **Status**: Phase 1. `doctor` and `fetch` work; every other subcommand is a stub that exits non-zero. `scripts/sp-pipeline.sh` remains the production pipeline — this binary is purely additive and safe to ignore until Phase 4.

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
│   ├── main.go                      # cobra root + stub subcommands
│   ├── doctor.go                    # `doctor` implementation
│   └── fetch.go                     # `fetch` implementation
├── internal/
│   ├── config/                      # resolve repo-relative paths
│   ├── logx/                        # colored + JSON logger
│   ├── runner/                      # exec.CommandContext wrapper
│   ├── source/                      # fetch + validate (native Go port of Python validators)
│   └── llm/                         # dispatcher + claude/codex/gemini providers
└── testdata/                        # fixtures for source validator tests
    └── clean-fxtwitter.md
```

## Migration plan (6 phases)

| Phase | Scope | Risk | Status |
|-------|-------|------|--------|
| **1** | Scaffold, `doctor`, `fetch`, LLM dispatcher (wired, not yet used by pipeline), Python validator → Go port | 🟢 low (purely additive; bash unchanged) | **in progress** |
| 2 | `eval`, `write`, `review`, `refine`, frontmatter round-tripping | 🟡 medium (MDX byte-equivalence matters) | planned |
| 3 | `ralph` (wraps `ralph-all-claude.sh`), `credits`, `counter`, `deploy` | 🟡 medium (touches git push) | planned |
| 4 | Docs / playbook / skill cutover, `sp-pipeline.sh` becomes a shim | 🟢 low | planned |
| 5 | Native port of `fetch-x-article.sh` + `ralph-all-claude.sh` | 🟠 high (optional polish) | planned |
| 6 | Delete `scripts/sp-pipeline.sh` | 🟢 low | planned |

The existing Node / Python helpers (`validate-posts.mjs`, `detect-model.mjs`, `frontmatter-scores.mjs`, `dedup-gate.mjs`, `fetch-article.py`) stay in their current languages forever — they are part of the Astro build and outside the pipeline hot path.

## Phase 1 acceptance

- [x] `go build ./...` passes
- [x] `go vet ./...` passes
- [x] `go test ./...` passes (source validator table-driven tests)
- [x] `sp-pipeline --help` prints the subcommand tree with stubs marked
- [x] `sp-pipeline doctor` reports binary + file health
- [ ] `sp-pipeline doctor --probe-llm` sends canary prompts (not exercised in sandbox — CI will verify on mac-CC)
- [x] `sp-pipeline fetch <url>` captures a tweet into `$REPO/tmp/sp-pending-<epoch>-pipeline/source-tweet.md`
- [x] Source validator is a native Go port of the Python heredocs (not a shell-out)
- [x] LLM dispatcher has claude/codex/gemini providers wired, fallback chain, `Probe()` for doctor
- [x] No binary checked into git (self-compiling wrapper handles cold start)

## References

- Nick Baumann, "The best tools I give Codex are bespoke CLIs" — this is the literal design brief for the CLI shape. Gu-log's SP-170 is a translation: `src/content/posts/sp-170-20260411-nickbaumann-codex-bespoke-cli-skill.mdx`
- `scripts/sp-pipeline.sh` — production pipeline, the source of truth for pipeline behaviour
- `scripts/ralph-all-claude.sh` — 4-stage tribunal, wrapped in Phase 3 and ported in Phase 5
- `scripts/fetch-x-article.sh` — tweet capture script, wrapped today and ported in Phase 5
