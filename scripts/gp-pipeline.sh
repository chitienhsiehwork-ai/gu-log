#!/usr/bin/env bash
# gp-pipeline.sh — canonical scripts/ entry point for the translation pipeline.
#
# "GP" = Gu-log Picks, matching the blog brand. The real pipeline lives in
# tools/sp-pipeline/ (Go); this thin wrapper translates the legacy env-var
# surface into Go CLI flags and execs the self-compiling wrapper. The older
# scripts/sp-pipeline.sh is kept as a backwards-compat shim and behaves
# identically.

set -euo pipefail

# Preserve the old PATH prepend for the codex shim on the VPS.
export PATH="/home/clawd/.local/bin:$HOME/.local/bin:$PATH"

# Resolve repo root from the shim's own location so this works regardless
# of CWD. Honors GU_LOG_DIR when the caller set it.
GU_LOG_DIR="${GU_LOG_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GP_PIPELINE="$GU_LOG_DIR/tools/sp-pipeline/gp-pipeline"

if [ ! -x "$GP_PIPELINE" ]; then
  printf 'gp-pipeline shim: Go wrapper not found or not executable at %s\n' "$GP_PIPELINE" >&2
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

exec "$GP_PIPELINE" "${args[@]}" run "$@"
