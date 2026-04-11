#!/usr/bin/env bash
# sp-pipeline.sh — backwards-compat shim.
#
# The real pipeline lives in tools/sp-pipeline/ (Go) as of Phase 4 of the
# Go rewrite. This file exists so crontabs, playbooks, and ad-hoc
# invocations that spell `bash scripts/sp-pipeline.sh <url>` keep working.
# It translates the legacy env-var surface into Go CLI flags and execs
# into the self-compiling Go binary.
#
# Removal policy: the shim is intended to live forever — a 20-line
# exec wrapper is free, and deleting it breaks unknown callers. If you
# are reading this years later and the Go binary is gone, you want to
# restore the old bash implementation from git history, not delete this.

set -euo pipefail

# Preserve the old PATH prepend for the codex shim on the VPS.
export PATH="/home/clawd/.local/bin:$HOME/.local/bin:$PATH"

# Resolve repo root from the shim's own location so this works regardless
# of CWD. Honors GU_LOG_DIR when the caller set it.
GU_LOG_DIR="${GU_LOG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SP_PIPELINE="$GU_LOG_DIR/tools/sp-pipeline/sp-pipeline"

if [ ! -x "$SP_PIPELINE" ]; then
  printf 'sp-pipeline shim: Go wrapper not found or not executable at %s\n' "$SP_PIPELINE" >&2
  printf 'Run: cd %s && go build ./... to rebuild.\n' "$GU_LOG_DIR/tools/sp-pipeline" >&2
  exit 127
fi

# Translate legacy env vars → CLI flags. The Go CLI intentionally has no
# env-var surface so that its contract is entirely visible in --help.
args=()
if [ -n "${PIPELINE_TIMEOUT:-}" ]; then
  args+=("--timeout" "${PIPELINE_TIMEOUT}s")
fi
if [ -n "${PIPELINE_WORK_DIR:-}" ]; then
  args+=("--work-dir" "$PIPELINE_WORK_DIR")
fi
if [ "${OPUS_MODE:-}" = "true" ]; then
  args+=("--opus")
fi

# PIPELINE_SOURCE_KEEP — used to be a "do not refetch if source-tweet.md
# exists" switch. The Go Fetch step already honors that behavior
# unconditionally (keeps existing source-tweet.md on disk), so this var
# is now a no-op. Document and drop.

exec "$SP_PIPELINE" "${args[@]}" run "$@"
