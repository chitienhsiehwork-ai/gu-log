#!/usr/bin/env bash
# Linux host regression for deployed Codex transient-service containment.

set -euo pipefail

if [ "$(uname -s 2>/dev/null || true)" != "Linux" ]; then
  echo "SKIP: deployed Tribunal systemd containment is Linux-only."
  exit 0
fi
if ! command -v systemd-run >/dev/null 2>&1 ||
   ! command -v systemctl >/dev/null 2>&1; then
  echo "SKIP: user systemd tools are unavailable."
  exit 0
fi

probe_unit="gu-log-tribunal-test-probe-$$-${RANDOM:-0}"
if ! systemd-run --user --wait --pipe --collect --quiet \
  --service-type=exec "--unit=$probe_unit" /bin/true >/dev/null 2>&1; then
  echo "SKIP: user systemd manager is unavailable."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-systemd.XXXXXX")"
escaped_pid=""
cleanup() {
  if [ -n "$escaped_pid" ] && kill -0 "$escaped_pid" 2>/dev/null; then
    kill -KILL "$escaped_pid" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/work"
cat > "$TMP/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  exit 0
fi
prompt="${!#}"
pid_file="$(printf '%s\n' "$prompt" | sed -n 's/^PID_FILE=//p')"
prompt_file="$(printf '%s\n' "$prompt" | sed -n 's/^PROMPT_FILE=//p')"
[ -n "$pid_file" ] && [ -n "$prompt_file" ] || exit 64
printf '%s\n' "$prompt" > "$prompt_file"
# Survive the parent shell's HUP, but accept the cgroup stop signal. Ignoring
# TERM would turn the successful containment path into a unit timeout.
setsid /bin/sh -c 'trap "" HUP; while :; do sleep 1; done' &
printf '%s\n' "$!" > "$pid_file"
FAKE_CODEX
chmod +x "$TMP/bin/codex"

# shellcheck source=scripts/tribunal-helpers.sh
source "$HELPERS"
tribunal_codex_cmd() {
  printf '%s\n' "$TMP/bin/codex"
}

unit="$(tribunal_codex_systemd_unit_name hosttest)"
TRIBUNAL_DEPLOYED_MODE=1 \
TRIBUNAL_CODEX_SYSTEMD_UNIT="$unit" \
TRIBUNAL_CODEX_TIMEOUT_SEC=5 \
TRIBUNAL_CODEX_SCOPE_MEMORY_MAX=64M \
TRIBUNAL_CODEX_SCOPE_CPU_QUOTA=10% \
TRIBUNAL_CODEX_SCOPE_TASKS_MAX=16 \
  tribunal_codex_workspace_prompt_exec "$TMP/work" gpt-fixture \
    "\$kept
PID_FILE=$TMP/escaped.pid
PROMPT_FILE=$TMP/prompt"

escaped_pid="$(sed -n '1p' "$TMP/escaped.pid")"
case "$escaped_pid" in
  ''|*[!0-9]*) echo "x fake Codex did not record an escaped PID" >&2; exit 1 ;;
esac
if kill -0 "$escaped_pid" 2>/dev/null; then
  echo "x setsid descendant escaped the transient service cgroup" >&2
  exit 1
fi
grep -Fxq '$kept' "$TMP/prompt" ||
  { echo "x systemd-run expanded the untrusted prompt" >&2; exit 1; }
load_state="$(
  systemctl --user show "$unit" -p LoadState --value 2>/dev/null || true
)"
if [ "$load_state" = "loaded" ]; then
  echo "x transient Codex service was not collected" >&2
  exit 1
fi

echo "ok deployed transient service kills setsid descendants and preserves prompt bytes"
