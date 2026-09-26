#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$BIN_DIR/grok" <<'SCRIPT'
#!/usr/bin/env bash
if [ "${1:-}" = models ]; then
  printf 'Default model: grok-4.6\nAvailable models:\n  * grok-4.6 (default)\n  * grok-4.5\n'
  exit 0
fi
if [ "${1:-}" = --help ]; then
  exit 0
fi
: > "$GROK_CALLED"
printf '%s\n' "$@" > "$GROK_ARGS"
printf 'grok-ok\n'
SCRIPT
cat > "$BIN_DIR/claude" <<'SCRIPT'
#!/usr/bin/env bash
if [ "${1:-}" = auth ] && [ "${2:-}" = status ]; then
  printf '{"loggedIn":true}\n'
  exit 0
fi
printf 'Claude CLI must not run in the VM routing test: %s\n' "$*" >&2
exit 72
SCRIPT
cat > "$BIN_DIR/systemd-run" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SYSTEMD_RUN_ARGS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -- ]; then
    shift
    break
  fi
  shift
done
[ "$#" -gt 0 ] || exit 64
exec "$@"
SCRIPT
chmod +x "$BIN_DIR/codex" "$BIN_DIR/claude" "$BIN_DIR/grok" \
  "$BIN_DIR/systemd-run"

export PATH="$BIN_DIR:$PATH"
export REPO_ROOT="$ROOT_DIR"
export TRIBUNAL_RUNTIME_PROFILE=vm-codex
export TRIBUNAL_STRICT_ROLE_PROVIDERS=1
export GROK_CALLED="$TMP_DIR/grok-called"
export GROK_ARGS="$TMP_DIR/grok-args"
export SYSTEMD_RUN_ARGS="$TMP_DIR/systemd-run-args"

# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

TRIBUNAL_REVIEWER_REMAINING_PCT=50
export TRIBUNAL_REVIEWER_REMAINING_PCT
[ "$(tribunal_judge_provider fact-checker)" = codex ]
[ "$(tribunal_llm_model_id fact-checker)" = gpt-5.6-sol ]
[ "$(tribunal_runner_label fact-checker)" = codex-gpt-5.6-sol-xhigh ]

TRIBUNAL_REVIEWER_REMAINING_PCT=19
export TRIBUNAL_REVIEWER_REMAINING_PCT
[ "$(tribunal_llm_model_id fact-checker)" = gpt-5.6-luna ]
[ "$(tribunal_runner_label fact-checker)" = codex-gpt-5.6-luna-max ]

expected_vibe_provider="$(jq -r '.profiles["vm-codex"].vibeScorer.provider' "$ROOT_DIR/config/llm-pipeline.json")"
expected_vibe_model="$(jq -r '.profiles["vm-codex"].vibeScorer.model' "$ROOT_DIR/config/llm-pipeline.json")"
expected_vibe_effort="$(jq -r '.profiles["vm-codex"].vibeScorer.reasoningEffort' "$ROOT_DIR/config/llm-pipeline.json")"
[ "$(tribunal_judge_provider vibe-opus-scorer)" = "$expected_vibe_provider" ]
[ "$(tribunal_llm_model_id vibe-opus-scorer)" = "$expected_vibe_model" ]
case "$expected_vibe_provider" in
  codex) expected_vibe_runner="codex-$expected_vibe_model-$expected_vibe_effort" ;;
  grok) expected_vibe_runner="grok-build-$expected_vibe_model-$expected_vibe_effort" ;;
  *) printf 'unsupported Vibe provider in fixture: %s\n' "$expected_vibe_provider" >&2; exit 1 ;;
esac
[ "$(tribunal_runner_label vibe-opus-scorer)" = "$expected_vibe_runner" ]
writer_pin="$(tribunal_claude_agent_model tribunal-writer)"
tribunal_writer_provenance_complete claude "$writer_pin" "$writer_pin"
if tribunal_writer_provenance_complete grok grok-4.6 grok-build-grok-4.6-low ||
   tribunal_writer_provenance_complete codex gpt-5.6-sol codex-gpt-5.6-sol-xhigh ||
   tribunal_writer_provenance_complete claude '' "$writer_pin"; then
  printf 'writer provenance guard accepted a non-Claude or incomplete writer\n' >&2
  exit 1
fi

work_dir="$TMP_DIR/work"
mkdir -p "$work_dir"

# The live config routes every article-writing role to the Claude model, so
# the Grok executor refuses a rewrite before it ever starts the Grok CLI.
rc=0
tribunal_grok_exec "$work_dir" tribunal-writer 'rewrite fixture' \
  >/dev/null 2>"$TMP_DIR/writer-live.err" || rc=$?
[ "$rc" -ne 0 ]
[ ! -e "$GROK_CALLED" ]
grep -Fq 'non-Grok route' "$TMP_DIR/writer-live.err"

# Each fixture needs a fresh shell: the router reads TRIBUNAL_MODEL_CONFIG
# when it is sourced.
run_with_config() {
  local config="$1"
  shift
  TRIBUNAL_MODEL_CONFIG="$config" bash -c '
    set -euo pipefail
    source "$REPO_ROOT/scripts/tribunal-helpers.sh"
    "$@"
  ' _ "$@"
}

# Even a config that routes the writer to Grok cannot reach the Grok CLI:
# the router refuses any non-Claude model for article writing.
writer_on_grok="$TMP_DIR/llm-pipeline-writer-on-grok.json"
jq '.profiles["vm-codex"].writer = {"provider":"grok","model":"grok-4.6","reasoningEffort":"low"}
    | .profiles["vm-codex"].requiredProviders = ["codex","claude","grok"]' \
  "$ROOT_DIR/config/llm-pipeline.json" > "$writer_on_grok"
rc=0
run_with_config "$writer_on_grok" \
  tribunal_grok_exec "$work_dir" tribunal-writer 'rewrite fixture' \
  >/dev/null 2>"$TMP_DIR/writer-on-grok.err" || rc=$?
[ "$rc" -ne 0 ]
[ ! -e "$GROK_CALLED" ]
grep -Fq 'must use the Claude model' "$TMP_DIR/writer-on-grok.err"

# Grok stays a judge-only provider. A config that routes the Vibe judge to
# Grok passes the Grok preflight and runs inside the isolated systemd-run
# service with the configured model and effort.
vibe_on_grok="$TMP_DIR/llm-pipeline-vibe-on-grok.json"
jq '.profiles["vm-codex"].vibeScorer += {"provider":"grok","model":"grok-4.6","reasoningEffort":"high"}
    | .profiles["vm-codex"].requiredProviders = ["codex","claude","grok"]' \
  "$ROOT_DIR/config/llm-pipeline.json" > "$vibe_on_grok"
[ "$(run_with_config "$vibe_on_grok" tribunal_judge_provider vibe-opus-scorer)" = grok ]
[ "$(run_with_config "$vibe_on_grok" tribunal_runner_label vibe-opus-scorer)" = \
  grok-build-grok-4.6-high ]
TRIBUNAL_CODEX_SYSTEMD_UNIT=gu-log-tribunal-codex-test-1-2-3 \
  run_with_config "$vibe_on_grok" \
  tribunal_grok_exec "$work_dir" vibe-opus-scorer 'score fixture' >/dev/null
[ -e "$GROK_CALLED" ]
grep -Fxq -- '--model' "$GROK_ARGS"
grep -Fxq -- 'grok-4.6' "$GROK_ARGS"
grep -Fxq -- '--reasoning-effort' "$GROK_ARGS"
grep -Fxq -- 'high' "$GROK_ARGS"
grep -Fxq -- '--sandbox' "$GROK_ARGS"
grep -Fxq -- 'read-only' "$GROK_ARGS"
grep -Fxq -- '--slice=tribunal-runtime.slice' "$SYSTEMD_RUN_ARGS"
grep -Fxq -- '--property=KillMode=control-group' "$SYSTEMD_RUN_ARGS"
grep -Fxq -- '--unit=gu-log-tribunal-codex-test-1-2-3' "$SYSTEMD_RUN_ARGS"
grep -Fxq -- '--description=gu-log Tribunal isolated Grok invocation' \
  "$SYSTEMD_RUN_ARGS"
grep -Fxq -- "$BIN_DIR/grok" "$SYSTEMD_RUN_ARGS"

printf 'ok VM routing: Codex judges, Claude-only article writing, Grok judge-only isolation\n'
