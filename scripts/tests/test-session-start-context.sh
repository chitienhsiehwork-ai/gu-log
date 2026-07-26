#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

jq -e '
  def covers($source):
    .matcher == null or ((.matcher | split("|")) | index($source) != null);
  any(
    .hooks.SessionStart[]?;
    covers("startup")
    and covers("resume")
    and covers("clear")
    and covers("compact")
    and any(
      .hooks[]?;
      .type == "command"
      and (.command | contains("--runtime codex --context"))
    )
  )
' .codex/hooks.json >/dev/null

jq -e '
  def covers($source):
    .matcher == null or ((.matcher | split("|")) | index($source) != null);
  any(
    .hooks.SessionStart[]?;
    covers("startup")
    and covers("resume")
    and covers("clear")
    and covers("compact")
    and any(
      .hooks[]?;
      .type == "command"
      and .command == "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/session-start.sh"
    )
  )
' .claude/settings.json >/dev/null

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
./scripts/detect-env.sh --runtime not-a-runtime --context \
  >"$TMP_DIR/invalid-runtime.stdout" 2>"$TMP_DIR/invalid-runtime.stderr"
invalid_runtime_status=$?
set -e
[[ "$missing_context_status" -eq 2 ]]
[[ "$missing_identity_status" -eq 2 ]]
[[ "$invalid_runtime_status" -eq 2 ]]
grep -q '^--context and --identity require --runtime ' "$TMP_DIR/missing-context.stderr"
grep -q '^--context and --identity require --runtime ' "$TMP_DIR/missing-identity.stderr"
grep -q '^invalid runtime: not-a-runtime$' "$TMP_DIR/invalid-runtime.stderr"

mac_cc_context="$(env -u GU_LOG_AGENT_RUNTIME \
  -u CODEX_SHELL \
  -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
  -u __CFBundleIdentifier \
  GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime claude-code --context)"
grep -q '^env: agent_id=m1-cc machine_id=m1 runtime=claude-code environment=local ' <<<"$mac_cc_context"
grep -q '^You are a machine-addressable Local Claude Code actor\.$' <<<"$mac_cc_context"
grep -q 'FULL PLAYBOOK: playbooks/local-agent-playbook.md' <<<"$mac_cc_context"
[[ "$(wc -l <<<"$mac_cc_context")" -le 15 ]]

ccc_context_from_detector="$(CLAUDE_CODE_REMOTE=true \
  GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime claude-code --context)"
grep -q '^env: agent_id=CCC machine_id=cloud runtime=claude-code environment=cloud ' \
  <<<"$ccc_context_from_detector"
grep -q '^You are Cloud Codex/Claude Code (CCC)\.$' <<<"$ccc_context_from_detector"
grep -q 'FULL PLAYBOOK: playbooks/CCC-playbook.md' <<<"$ccc_context_from_detector"

mac_cdx_context="$(env -u CODEX_SHELL \
  -u CODEX_INTERNAL_ORIGINATOR_OVERRIDE \
  -u __CFBundleIdentifier \
  GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --context)"
grep -q '^env: agent_id=m1-cdx machine_id=m1 runtime=codex environment=local ' <<<"$mac_cdx_context"
grep -q '^You are a machine-addressable Local Codex Desktop / Codex CLI actor\.$' <<<"$mac_cdx_context"
grep -q 'FULL PLAYBOOK: playbooks/local-agent-playbook.md' <<<"$mac_cdx_context"
[[ "$(wc -l <<<"$mac_cdx_context")" -le 15 ]]

mac_cdx_identity="$(GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --identity)"
[[ "$mac_cdx_identity" == "m1-cdx" ]]

forced_claude_identity="$(CODEX_SHELL=1 GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime claude-code --identity)"
[[ "$forced_claude_identity" == "m1-cc" ]]

forced_codex_identity="$(GU_LOG_AGENT_RUNTIME=claude-code GU_LOG_MACHINE_ID=m1 \
  ./scripts/detect-env.sh --runtime codex --identity)"
[[ "$forced_codex_identity" == "m1-cdx" ]]

hook_command="$(jq -r '
  first(
    .hooks.SessionStart[]?.hooks[]?
    | select(
        .type == "command"
        and (.command | contains("--runtime codex --context"))
      )
  ).command
' .codex/hooks.json)"
hook_stdout="$(GU_LOG_MACHINE_ID=m1 sh -c "$hook_command")"
[[ "$hook_stdout" == "$mac_cdx_context" ]]

claude_hook_command="$(jq -r '
  first(
    .hooks.SessionStart[]?.hooks[]?
    | select(
        .type == "command"
        and (.command | contains(".claude/hooks/session-start.sh"))
      )
  ).command
' .claude/settings.json)"

# Exercise the real Claude wrapper against fixture entrypoints. This verifies
# explicit runtime delivery, local no-provision behavior, CCC provisioning,
# and a model-visible fallback when identity detection fails.
fixture="$TMP_DIR/fixture project"
fixture_log="$TMP_DIR/fixture-log"
mkdir -p "$fixture/.claude/hooks" "$fixture/scripts" "$fixture_log"
ln -s "$ROOT_DIR/.claude/hooks/session-start.sh" "$fixture/.claude/hooks/session-start.sh"
# These variables belong to the generated fixture, not this process.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >"$TEST_LOG_DIR/detect.args"' \
  'if [ "${TEST_DETECT_FAIL:-}" = "1" ]; then' \
  '  echo "stub detect failed" >&2' \
  '  exit 2' \
  'fi' \
  'printf "\\nenv: agent_id=%s machine_id=%s runtime=claude-code environment=%s branch=test os=fixture cwd=%s\\n\\nFULL PLAYBOOK: %s\\n" "${TEST_AGENT_ID:-m1-cc}" "${TEST_MACHINE_ID:-m1}" "${TEST_ENVIRONMENT:-local}" "$PWD" "${TEST_PLAYBOOK:-playbooks/local-agent-playbook.md}"' \
  >"$fixture/scripts/detect-env.sh"
# These variables belong to the generated fixture, not this process.
# shellcheck disable=SC2016
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\\n" "$*" >"$TEST_LOG_DIR/smoke.args"' \
  'echo "CCC smoke provisioned"' \
  >"$fixture/scripts/ccc-smoke-test.sh"
chmod +x "$fixture/scripts/detect-env.sh" "$fixture/scripts/ccc-smoke-test.sh"

local_context="$(TEST_LOG_DIR="$fixture_log" \
  CLAUDE_PROJECT_DIR="$fixture" \
  CLAUDE_CODE_REMOTE='' \
  sh -c "$claude_hook_command")"
grep -q '^env: agent_id=m1-cc machine_id=m1 runtime=claude-code environment=local ' \
  <<<"$local_context"
[[ "$(<"$fixture_log/detect.args")" == "--runtime claude-code --context" ]]
[[ ! -e "$fixture_log/smoke.args" ]]

rm -f "$fixture_log/detect.args"
ccc_context="$(TEST_LOG_DIR="$fixture_log" \
  TEST_AGENT_ID=CCC \
  TEST_MACHINE_ID=cloud \
  TEST_ENVIRONMENT=cloud \
  TEST_PLAYBOOK=playbooks/CCC-playbook.md \
  CLAUDE_PROJECT_DIR="$fixture" \
  CLAUDE_CODE_REMOTE=true \
  sh -c "$claude_hook_command")"
grep -q '^env: agent_id=CCC machine_id=cloud runtime=claude-code environment=cloud ' \
  <<<"$ccc_context"
grep -q '^CCC smoke provisioned$' <<<"$ccc_context"
[[ "$(<"$fixture_log/detect.args")" == "--runtime claude-code --context" ]]
[[ "$(<"$fixture_log/smoke.args")" == "--fix" ]]

set +e
TEST_LOG_DIR="$fixture_log" \
  TEST_DETECT_FAIL=1 \
  CLAUDE_PROJECT_DIR="$fixture" \
  CLAUDE_CODE_REMOTE='' \
  bash "$ROOT_DIR/.claude/hooks/session-start.sh" \
  >"$TMP_DIR/claude-failure.stdout" 2>"$TMP_DIR/claude-failure.stderr"
claude_failure_status=$?
set -e
[[ "$claude_failure_status" -eq 0 ]]
grep -q '^stub detect failed$' "$TMP_DIR/claude-failure.stderr"
grep -q '^WARNING: gu-log SessionStart context unavailable (exit 2)。$' \
  "$TMP_DIR/claude-failure.stdout"
grep -q '^Fallback: 先讀 AGENTS.md，再跑 ./scripts/detect-env.sh --runtime claude-code --context。$' \
  "$TMP_DIR/claude-failure.stdout"

echo "Codex/Claude SessionStart context contract tests passed"
