#!/usr/bin/env bash
# Isolation of Tribunal model CLI calls: the shared transient service drops
# each provider's forbidden credential variables, and a Claude writing call
# never carries API-key variables nor loads host settings or MCP servers,
# inside or outside the service.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
WORK_DIR="$TMP_DIR/work"
mkdir -p "$BIN_DIR" "$WORK_DIR"

fail() { echo "x $*" >&2; exit 1; }

cat > "$BIN_DIR/systemd-run" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SYSTEMD_RUN_ARGS"
SCRIPT
cat > "$BIN_DIR/claude" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CLAUDE_ARGS"
env > "$CLAUDE_ENV"
cat > /dev/null
printf 'rewritten\n'
SCRIPT
chmod +x "$BIN_DIR/systemd-run" "$BIN_DIR/claude"
export PATH="$BIN_DIR:$PATH"
export SYSTEMD_RUN_ARGS="$TMP_DIR/systemd-run.args"
export CLAUDE_ARGS="$TMP_DIR/claude.args"
export CLAUDE_ENV="$TMP_DIR/claude.env"
export REPO_ROOT="$ROOT_DIR"

# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

unset_list() {
  sed -n 's/^--property=UnsetEnvironment=//p' "$SYSTEMD_RUN_ARGS"
}

assert_unsets() {
  local provider="$1"
  shift
  local list variable
  list=" $(unset_list) "
  for variable in "$@"; do
    case "$list" in
      *" $variable "*) ;;
      *) fail "$provider service keeps $variable (UnsetEnvironment=$list)" ;;
    esac
  done
}

export CODEX_HOME="$TMP_DIR/codex-home"
export CLAUDE_CONFIG_DIR="$TMP_DIR/claude-config"

( tribunal_exec_transient_service codex "$WORK_DIR" 5 -- /bin/true )
assert_unsets codex CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_API_KEY
grep -Fxq -- "--setenv=CODEX_HOME=$CODEX_HOME" "$SYSTEMD_RUN_ARGS" ||
  fail "codex service lost CODEX_HOME"
if grep -q -- '--setenv=CLAUDE_CONFIG_DIR=' "$SYSTEMD_RUN_ARGS"; then
  fail "codex service received the Claude config directory"
fi
grep -Fxq -- '--description=gu-log Tribunal isolated Codex invocation' \
  "$SYSTEMD_RUN_ARGS" || fail "codex service description drifted"

( tribunal_exec_transient_service claude "$WORK_DIR" 5 -- /bin/true )
assert_unsets claude ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_API_KEY \
  CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY CODEX_API_KEY
grep -Fxq -- "--setenv=CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR" "$SYSTEMD_RUN_ARGS" ||
  fail "claude service lost the CLI login state directory"
if grep -q -- '--setenv=CODEX_HOME=' "$SYSTEMD_RUN_ARGS"; then
  fail "claude service received the Codex home"
fi
for shared in --slice=tribunal-runtime.slice --property=KillMode=control-group \
  --expand-environment=no "--working-directory=$WORK_DIR"; do
  grep -Fxq -- "$shared" "$SYSTEMD_RUN_ARGS" ||
    fail "shared transient service contract omitted $shared"
done

if ( tribunal_exec_transient_service grok "$WORK_DIR" 5 -- /bin/true ) 2>/dev/null; then
  fail "transient service accepted an unknown provider"
fi

# Outside the deployed service the Claude writer still drops API-key
# variables, so a stray key cannot switch billing to the API.
unset CLAUDE_CODE_OAUTH_TOKEN
ANTHROPIC_API_KEY=sk-ant-fixture ANTHROPIC_AUTH_TOKEN=bearer-fixture \
CLAUDE_API_KEY=claude-key-fixture TRIBUNAL_DEPLOYED_MODE=0 \
  tribunal_claude_writer_prompt_exec "$WORK_DIR" claude-writer-fixture 'rewrite' \
  >/dev/null
for variable in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_API_KEY; do
  if grep -q "^$variable=" "$CLAUDE_ENV"; then
    fail "direct Claude writer call kept $variable"
  fi
done
grep -q "^CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR$" "$CLAUDE_ENV" ||
  fail "direct Claude writer call lost the CLI login state directory"
# The contained call loads no host settings or MCP servers.
awk 'prev == "--setting-sources" && $0 == "" { ok = 1 } { prev = $0 } END { exit !ok }' \
  "$CLAUDE_ARGS" || fail "Claude writer call loads host settings"
grep -Fxq -- '--strict-mcp-config' "$CLAUDE_ARGS" ||
  fail "Claude writer call loads host MCP servers"

echo "ok model CLI calls drop forbidden credentials and never load host Claude settings or MCP servers"
