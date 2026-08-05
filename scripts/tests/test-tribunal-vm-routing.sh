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
  printf 'Default model: grok-4.5\nAvailable models:\n  * grok-4.5 (default)\n'
  exit 0
fi
if [ "${1:-}" = --help ]; then
  exit 0
fi
: > "$GROK_CALLED"
printf '%s\n' "$@" > "$GROK_ARGS"
printf 'grok-ok\n'
SCRIPT
cat > "$BIN_DIR/systemd-run" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SYSTEMD_RUN_ARGS"
exit 0
SCRIPT
chmod +x "$BIN_DIR/codex" "$BIN_DIR/grok" "$BIN_DIR/systemd-run"

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

[ "$(tribunal_judge_provider vibe-opus-scorer)" = grok ]
[ "$(tribunal_llm_model_id vibe-opus-scorer)" = grok-4.5 ]
[ "$(tribunal_runner_label vibe-opus-scorer)" = grok-build-grok-4.5-low ]

work_dir="$TMP_DIR/work"
mkdir -p "$work_dir"

TRIBUNAL_GROK_REMAINING_PCT=19
export TRIBUNAL_GROK_REMAINING_PCT
quota_file="$TMP_DIR/vibe-quota"
rc=0
TRIBUNAL_QUOTA_STATUS_FILE="$quota_file" \
  tribunal_grok_exec "$work_dir" vibe-opus-scorer 'score fixture' \
  >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 75 ]
[ ! -e "$GROK_CALLED" ]
grep -q '^provider=grok$' "$quota_file"
grep -q '^tier=lowQuota$' "$quota_file"

TRIBUNAL_GROK_REMAINING_PCT=19 \
  tribunal_grok_exec "$work_dir" tribunal-writer 'rewrite fixture' >/dev/null
[ -e "$GROK_CALLED" ]
grep -Fxq -- '--model' "$GROK_ARGS"
grep -Fxq -- 'grok-4.5' "$GROK_ARGS"
grep -Fxq -- '--reasoning-effort' "$GROK_ARGS"
grep -Fxq -- 'low' "$GROK_ARGS"

rm -f "$GROK_CALLED"
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_CODEX_SYSTEMD_UNIT=gu-log-tribunal-codex-test-1-2-3 \
TRIBUNAL_GROK_REMAINING_PCT=19 \
  tribunal_grok_exec "$work_dir" tribunal-writer 'rewrite fixture' >/dev/null
[ ! -e "$GROK_CALLED" ]
grep -Fxq -- '--slice=tribunal-runtime.slice' "$SYSTEMD_RUN_ARGS"
grep -Fxq -- '--property=KillMode=control-group' "$SYSTEMD_RUN_ARGS"
grep -Fxq -- '--description=gu-log Tribunal isolated Grok invocation' \
  "$SYSTEMD_RUN_ARGS"
grep -Fxq -- "$BIN_DIR/grok" "$SYSTEMD_RUN_ARGS"

rm -f "$GROK_CALLED"
TRIBUNAL_GROK_REMAINING_PCT=9
export TRIBUNAL_GROK_REMAINING_PCT
rc=0
tribunal_grok_exec "$work_dir" tribunal-writer 'rewrite fixture' \
  >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 75 ]
[ ! -e "$GROK_CALLED" ]

printf 'ok VM Codex/Grok routing, provenance labels, and low-quota gates\n'
