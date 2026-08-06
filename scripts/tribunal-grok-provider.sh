#!/usr/bin/env bash
# Provider bridge for gp-pipeline. Prompt bytes arrive on stdin so the Go and
# Bash paths share one VM-only containment and credential-scrubbing executor.

set -euo pipefail

if [ "$#" -ne 4 ]; then
  printf 'Usage: %s <work-dir> <model> <reasoning> <read-only|workspace>\n' \
    "$0" >&2
  exit 64
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export REPO_ROOT
work_dir="$1"
model="$2"
reasoning="$3"
sandbox_profile="$4"

[ -d "$work_dir" ] || {
  printf 'Grok work directory does not exist: %s\n' "$work_dir" >&2
  exit 66
}
case "$sandbox_profile" in
  read-only|workspace) ;;
  *)
    printf 'Invalid Grok sandbox profile: %s\n' "$sandbox_profile" >&2
    exit 64
    ;;
esac

# shellcheck source=scripts/tribunal-helpers.sh
source "$SCRIPT_DIR/tribunal-helpers.sh"
runtime_profile="$(model_router_profile)"
[ "$runtime_profile" = "vm-codex" ] || {
  printf 'Grok provider bridge requires vm-codex (got %s)\n' \
    "$runtime_profile" >&2
  exit 78
}
model_router_assert_profile_compatible "$runtime_profile"

prompt="$(cat)"
[ -n "$prompt" ] || {
  printf 'Grok provider bridge received an empty prompt\n' >&2
  exit 64
}
tribunal_grok_prompt_exec \
  "$work_dir" "$model" "$reasoning" "$sandbox_profile" "$prompt"
