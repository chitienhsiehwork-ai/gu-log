#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

jq -e '
  (.hooks.SessionStart | length) == 1
  and .hooks.SessionStart[0].matcher == "startup|resume|clear|compact"
  and (.hooks.SessionStart[0].hooks | length) == 1
  and .hooks.SessionStart[0].hooks[0].type == "command"
' .codex/hooks.json >/dev/null

normal_stdout="$(./scripts/detect-env.sh 2>"$TMP_DIR/normal.stderr")"
[[ "$normal_stdout" == "CC" || "$normal_stdout" == "CCC" ]]
grep -q '^runtime not specified; mode-only result\.' "$TMP_DIR/normal.stderr"
if grep -Eq 'agent_id=|Local Codex|Local Claude Code' "$TMP_DIR/normal.stderr"; then
  echo "plain mode leaked actor identity context" >&2
  exit 1
fi

set +e
./scripts/detect-env.sh --context >"$TMP_DIR/missing-context.stdout" 2>"$TMP_DIR/missing-context.stderr"
missing_context_status=$?
./scripts/detect-env.sh --identity >"$TMP_DIR/missing-identity.stdout" 2>"$TMP_DIR/missing-identity.stderr"
missing_identity_status=$?
set -e
[[ "$missing_context_status" -eq 2 ]]
[[ "$missing_identity_status" -eq 2 ]]
grep -q '^--context and --identity require --runtime ' "$TMP_DIR/missing-context.stderr"
grep -q '^--context and --identity require --runtime ' "$TMP_DIR/missing-identity.stderr"

mac_cc_context="$(env -u GU_LOG_AGENT_RUNTIME \
  -u CODEX_SHELL \
  -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
  -u __CFBundleIdentifier \
  GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime claude-code --context)"
grep -q '^env: agent_id=m1-cc machine_id=m1 runtime=claude-code environment=local ' <<<"$mac_cc_context"

mac_cdx_context="$(env -u CODEX_SHELL \
  -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
  -u __CFBundleIdentifier \
  GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --context)"
grep -q '^env: agent_id=m1-cdx machine_id=m1 runtime=codex environment=local ' <<<"$mac_cdx_context"
grep -q '^You are a machine-addressable Local Codex Desktop / Codex CLI actor\.$' <<<"$mac_cdx_context"

mac_cdx_identity="$(GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --identity)"
[[ "$mac_cdx_identity" == "m1-cdx" ]]

forced_claude_identity="$(CODEX_SHELL=1 GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime claude-code --identity)"
[[ "$forced_claude_identity" == "m1-cc" ]]

forced_codex_identity="$(GU_LOG_AGENT_RUNTIME=claude-code GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --identity)"
[[ "$forced_codex_identity" == "m1-cdx" ]]

hook_command="$(jq -r '.hooks.SessionStart[0].hooks[0].command' .codex/hooks.json)"
hook_stdout="$(GU_LOG_MACHINE_ID=m1 sh -c "$hook_command")"
[[ "$hook_stdout" == "$mac_cdx_context" ]]

echo "Codex SessionStart hook contract tests passed"
