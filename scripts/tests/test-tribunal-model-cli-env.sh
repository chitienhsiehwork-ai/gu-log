#!/usr/bin/env bash
# Isolation of Tribunal model CLI calls: a Codex judge's transient service
# drops the Claude credential variables, a deployed Claude writing call starts
# from a clean environment, and no Claude writing call loads host settings or
# MCP servers, inside or outside the service.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
WORK_DIR="$TMP_DIR/work"
mkdir -p "$BIN_DIR" "$WORK_DIR"
SYSTEMD_RUN_ARGS="$TMP_DIR/systemd-run.args"
CLAUDE_ARGS="$TMP_DIR/claude.args"
CLAUDE_ENV="$TMP_DIR/claude.env"

fail() { echo "x $*" >&2; exit 1; }

# The stubs carry their capture paths: a clean Claude environment would not
# pass them along. The systemd-run stub runs the command after `--`.
cat > "$BIN_DIR/systemd-run" <<SCRIPT
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$SYSTEMD_RUN_ARGS"
while [ "\$#" -gt 0 ]; do
  if [ "\$1" = -- ]; then
    shift
    break
  fi
  shift
done
exec "\$@"
SCRIPT
cat > "$BIN_DIR/claude" <<SCRIPT
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$CLAUDE_ARGS"
/usr/bin/env > "$CLAUDE_ENV"
cat > /dev/null
printf 'rewritten\n'
SCRIPT
chmod +x "$BIN_DIR/systemd-run" "$BIN_DIR/claude"
export PATH="$BIN_DIR:$PATH"
export REPO_ROOT="$ROOT_DIR"

# shellcheck source=scripts/tribunal-helpers.sh
source "$ROOT_DIR/scripts/tribunal-helpers.sh"

export CODEX_HOME="$TMP_DIR/codex-home"
export CLAUDE_CONFIG_DIR="$TMP_DIR/claude-config"

( tribunal_exec_transient_service codex "$WORK_DIR" 5 -- /bin/true )
grep -Fxq -- "--property=UnsetEnvironment=$(tribunal_transient_service_unset_env codex)" \
  "$SYSTEMD_RUN_ARGS" || fail "codex service keeps Claude credential variables"
grep -Fxq -- "--setenv=CODEX_HOME=$CODEX_HOME" "$SYSTEMD_RUN_ARGS" ||
  fail "codex service lost CODEX_HOME"
if grep -q -- '--setenv=CLAUDE_CONFIG_DIR=' "$SYSTEMD_RUN_ARGS"; then
  fail "codex service received the Claude config directory"
fi
grep -Fxq -- '--description=gu-log Tribunal isolated Codex invocation' \
  "$SYSTEMD_RUN_ARGS" || fail "codex service description drifted"

if ( tribunal_exec_transient_service grok "$WORK_DIR" 5 -- /bin/true ) 2>/dev/null; then
  fail "transient service accepted an unknown provider"
fi

# A deployed Claude writing call sees none of the host's variables: not an API
# key, not a key handed over as a file descriptor, not anything unrelated.
leaked="ANTHROPIC_API_KEY CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR GU_LOG_FIXTURE_UNRELATED"
for variable in $leaked; do
  export "$variable=fixture-secret"
done
TZ=Asia/Taipei TRIBUNAL_DEPLOYED_MODE=1 \
  tribunal_claude_writer_prompt_exec "$WORK_DIR" claude-writer-fixture 'rewrite' \
  >/dev/null
for variable in $leaked; do
  if grep -q "^$variable=" "$CLAUDE_ENV"; then
    fail "deployed Claude writer call kept $variable"
  fi
done
for kept in "HOME=$HOME" "PATH=$PATH" "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR" TZ=Asia/Taipei; do
  grep -Fxq -- "$kept" "$CLAUDE_ENV" ||
    fail "deployed Claude writer call lost $kept"
done
if grep -q -- '^--property=UnsetEnvironment=' "$SYSTEMD_RUN_ARGS"; then
  fail "the clean Claude environment should not need an unset list"
fi
grep -Fxq -- '--description=gu-log Tribunal isolated writer invocation (Claude model)' \
  "$SYSTEMD_RUN_ARGS" || fail "claude service description drifted"
if grep -q -- '--setenv=CODEX_HOME=' "$SYSTEMD_RUN_ARGS"; then
  fail "claude service received the Codex home"
fi
for shared in --slice=tribunal-runtime.slice --property=KillMode=control-group \
  --expand-environment=no "--working-directory=$WORK_DIR"; do
  grep -Fxq -- "$shared" "$SYSTEMD_RUN_ARGS" ||
    fail "shared transient service contract omitted $shared"
done
for variable in $leaked; do
  unset "$variable"
done

# Outside the deployed service (dev machines, CCC) the Claude writer still
# drops API-key variables, so a stray key cannot switch billing to the API.
unset CLAUDE_CODE_OAUTH_TOKEN
for variable in $TRIBUNAL_CLAUDE_API_KEY_ENV; do
  export "$variable=fixture-secret"
done
TRIBUNAL_DEPLOYED_MODE=0 \
  tribunal_claude_writer_prompt_exec "$WORK_DIR" claude-writer-fixture 'rewrite' \
  >/dev/null
for variable in $TRIBUNAL_CLAUDE_API_KEY_ENV; do
  if grep -q "^$variable=" "$CLAUDE_ENV"; then
    fail "direct Claude writer call kept $variable"
  fi
  unset "$variable"
done
grep -q "^CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR$" "$CLAUDE_ENV" ||
  fail "direct Claude writer call lost the CLI login state directory"
# The contained call loads no host settings or MCP servers.
awk 'prev == "--setting-sources" && $0 == "" { ok = 1 } { prev = $0 } END { exit !ok }' \
  "$CLAUDE_ARGS" || fail "Claude writer call loads host settings"
grep -Fxq -- '--strict-mcp-config' "$CLAUDE_ARGS" ||
  fail "Claude writer call loads host MCP servers"

echo "ok model CLI calls start Claude from a clean environment, drop Claude credentials from Codex, and never load host Claude settings or MCP servers"
