#!/usr/bin/env bash
# Static/no-token regressions for Tribunal v8 safety hardening.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"
VIBE="$ROOT_DIR/scripts/vibe-scorer.sh"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"
GROK_BRIDGE="$ROOT_DIR/scripts/tribunal-grok-provider.sh"
WRAPPER="$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh"
LOOP="$ROOT_DIR/scripts/tribunal-quota-loop.sh"
SERVICE="$ROOT_DIR/scripts/tribunal-loop.service"
SLICE="$ROOT_DIR/scripts/tribunal-runtime.slice"
OBSOLETE_CRON="$ROOT_DIR/scripts/cc-cron-tribunal.sh"
CODEX_AGENTS_DIR="$ROOT_DIR/.codex/agents"
CODEX_WRITER="$CODEX_AGENTS_DIR/tribunal-writer.toml"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

if [ -e "$OBSOLETE_CRON" ]; then
  fail "obsolete Tribunal cron entrypoint returned alongside the systemd runtime"
fi
if grep -Fq 'cc-cron-tribunal.sh' "$WRAPPER"; then
  fail "systemd wrapper still points readers at the obsolete cron entrypoint"
fi
pass "obsolete Tribunal cron entrypoint stays removed from the systemd runtime"

if grep -Eq -- '--no-verify|--no-gpg-sign' "$TRIBUNAL" "$VIBE" "$HELPERS"; then
  fail "Tribunal runtime contains hook-bypass flags"
fi
pass "no hook-bypass flags in Tribunal runtime"

if ! grep -q 'TRIBUNAL_NO_COMMIT=1; skipping commit_progress' "$TRIBUNAL"; then
  fail "commit_progress does not honor TRIBUNAL_NO_COMMIT"
fi
if ! grep -q 'TRIBUNAL_ALLOW_PUSH is not set' "$TRIBUNAL"; then
  fail "commit_progress does not default to no-push"
fi
if ! grep -q 'refusing to direct-push main' "$TRIBUNAL"; then
  fail "commit_progress does not refuse direct main pushes"
fi
pass "commit/push safety defaults are explicit"

if ! grep -q 'if \[ -n "\$ONLY_STAGE" \]' "$TRIBUNAL"; then
  fail "--only-stage default rewrite guard is missing"
fi
if ! grep -q 'Rewrite disabled for this run' "$TRIBUNAL"; then
  fail "judge-only failure path could invoke writer rewrite"
fi
if ! bash "$TRIBUNAL" --help 2>&1 | grep -q -- '--allow-rewrite'; then
  fail "--allow-rewrite is not documented in help"
fi
pass "judge-only/--only-stage requires explicit --allow-rewrite"

gp_rewrite_output=""
gp_rewrite_rc=0
gp_rewrite_output="$(bash "$TRIBUNAL" --allow-rewrite gp-nonexistent.mdx 2>&1)" || gp_rewrite_rc=$?
if [ "$gp_rewrite_rc" -eq 0 ] || ! grep -q 'GP source-preservation contract forbids --allow-rewrite' <<<"$gp_rewrite_output"; then
  fail "GP can still enter Tribunal writer/rebuild mode"
fi
if ! sed -n '/^repair_final_build_failure()/,/^}/p' "$TRIBUNAL" | grep -q 'ALLOW_REWRITE'; then
  fail "final build repair can bypass GP no-rewrite mode"
fi
pass "GP forbids Tribunal rewrite, including final-build repair"

if ! grep -q -- '--score-only --only-stage vibe' "$VIBE"; then
  fail "vibe-scorer does not delegate through non-mutating score-only mode"
fi
if ! grep -q 'WRITE_FRONTMATTER=0' "$TRIBUNAL"; then
  fail "score-only does not disable frontmatter writes"
fi
if ! grep -q 'TRIBUNAL_SCORE_ONLY_PROGRESS_FILE' "$TRIBUNAL"; then
  fail "score-only does not move progress writes out of repo"
fi
pass "vibe-scorer remains score-only/non-mutating"

if ! grep -q 'Invalid/missing .* score JSON schema' "$TRIBUNAL"; then
  fail "invalid judge JSON schema does not fail loudly"
fi
pass "invalid judge JSON fails loudly"

if ! grep -q 'TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC:-900' "$HELPERS"; then
  fail "Codex idle watchdog default is not 15 minutes"
fi
if ! grep -q 'no output/score-file progress' "$HELPERS"; then
  fail "Codex idle watchdog does not track output + score progress"
fi
pass "Codex idle watchdog semantics are present"

if grep -q 'TRIBUNAL_PROCESS_GROUP_FILE' "$HELPERS"; then
  fail "watchdog still exposes process-group kill authority through child-visible state"
fi
if ! grep -Fq 'tribunal_terminate_process_group "$pid"' "$HELPERS"; then
  fail "watchdog does not terminate the parent-held judge process group"
fi
pass "watchdog kill authority remains parent-held"

judge_exec_body="$(sed -n '/^tribunal_codex_exec()/,/^}/p' "$HELPERS")"
if printf '%s\n' "$judge_exec_body" | grep -q -- '--sandbox danger-full-access'; then
  fail "Codex judge still executes untrusted article prose with danger-full-access"
fi
if ! printf '%s\n' "$judge_exec_body" |
     grep -Fq 'tribunal_codex_workspace_prompt_exec "$work_dir" "$model" "$prompt"'; then
  fail "Codex judge does not use the shared isolated workspace executor"
fi
judge_sandbox_body="$(
  sed -n '/^tribunal_codex_workspace_prompt_exec()/,/^}/p' "$HELPERS"
)"
for required in \
  'approval_policy="never"' \
  'sandbox_workspace_write.writable_roots=[]' \
  'sandbox_workspace_write.exclude_slash_tmp=true' \
  'sandbox_workspace_write.exclude_tmpdir_env_var=true' \
  'sandbox_workspace_write.network_access=false' \
  'shell_environment_policy.inherit="core"' \
  'web_search="disabled"' \
  '--sandbox workspace-write' \
  '--ignore-user-config' \
  '--ignore-rules' \
  '--ephemeral' \
  '--strict-config'; do
  if ! printf '%s\n' "$judge_sandbox_body" | grep -Fq -- "$required"; then
    fail "Codex judge sandbox is missing required boundary: $required"
  fi
done
pass "Codex judge treats article prose as untrusted inside a network-off read-only-repo sandbox"

if ! git -C "$ROOT_DIR" check-ignore -q \
  ".score-loop/recovery/fixture.token.json"; then
  fail "durable Tribunal recovery tokens are not excluded from git state"
fi
pass "durable Tribunal recovery tokens stay out of commits"

if ! grep -q '.codex/agents/\$agent_name.toml' "$HELPERS"; then
  fail "Codex tribunal helper does not prefer .codex/agents custom agents"
fi
if ! grep -q 'Ignore YAML' "$HELPERS" || ! grep -q 'frontmatter runtime fields' "$HELPERS"; then
  fail "Codex tribunal helper does not ignore Claude Code frontmatter runtime"
fi
pass "Codex agent specs are separated from Claude Code frontmatter"

if ! grep -Fq -- '--model "$model"' "$HELPERS"; then
  fail "Codex tribunal helper does not use its resolved role model"
fi
if ! grep -q 'MIN_CODEX_VERSION="0.128.0"' "$TRIBUNAL"; then
  fail "Tribunal does not reject known-broken old Codex CLI versions"
fi
if ! grep -Fq 'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"' "$WRAPPER"; then
  fail "Tribunal systemd wrapper does not prefer the current ~/.local/bin Codex before stale ~/bin"
fi
# model_id is provider-resolved. Codex reads each role TOML unless an explicit
# run-scoped override is present; Claude remains the CCC sandbox fallback.
if ! grep -q 'model_id="$(tribunal_llm_model_id' "$TRIBUNAL"; then
  fail "Tribunal model_id is not resolved through the provider-aware tribunal_llm_model_id"
fi
if ! grep -q 'tribunal_codex_agent_model()' "$HELPERS" ||
   ! grep -q 'tribunal_codex_toml_model()' "$HELPERS"; then
  fail "Codex provider path lacks strict per-role TOML model resolution"
fi
missing_models=$(grep -L '^model = "[A-Za-z0-9][A-Za-z0-9._:-]*"$' "$CODEX_AGENTS_DIR"/*.toml || true)
if [ -n "$missing_models" ]; then
  fail "One or more Codex tribunal agent specs lack a top-level model: $missing_models"
fi
pass "Tribunal model selection: per-role TOML + explicit run-scoped override"

# The internal progress ledger runner_label must be provider-aware too, sharing
# the same resolver as the frontmatter model_id. A refactor must not regress it
# back to a static codex-gpt-5.5-medium string (that would mislabel CCC Claude
# runs as codex in calibration/audit data).
if ! grep -q 'tribunal_runner_label()' "$HELPERS"; then
  fail "tribunal_runner_label provider-aware helper is missing"
fi
if ! grep -Fq "printf 'codex-%s-%s" "$HELPERS" ||
   ! grep -Fq '${TRIBUNAL_CODEX_REASONING:-medium}' "$HELPERS"; then
  fail "tribunal_runner_label codex path no longer includes the resolved model and actual reasoning effort"
fi
if ! grep -q 'runner_label="$(tribunal_runner_label' "$TRIBUNAL"; then
  fail "Tribunal progress runner_label is not resolved through tribunal_runner_label"
fi
if grep -Eq 'codex-[^:[:space:]]+-medium:(factCheck|librarian|freshEyes|vibe)' "$TRIBUNAL"; then
  fail "STAGES still hardcodes a static Codex runner_label column"
fi
pass "Progress ledger runner_label is provider-aware (codex/claude), not a static codex string"

# Per-judge provider resolver: deployed strict mode keeps every judge on Codex;
# compatibility mode may still use Claude when strict mode is unset.
if ! grep -q 'tribunal_judge_provider()' "$HELPERS"; then
  fail "tribunal_judge_provider agent-aware resolver is missing"
fi
if [ "$(grep -cF 'tribunal_judge_provider "$agent_name"' "$HELPERS")" -lt 3 ]; then
  fail "model_id/runner_label/exec_raw/watchdog do not all route through tribunal_judge_provider"
fi
pass "per-judge provider resolver is wired through deployed/compatibility boundaries"

(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-codex-model.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  mkdir -p "$fixture_root/.codex/agents" "$fixture_root/bin"
  printf 'model = "gpt-role-a"\n' > "$fixture_root/.codex/agents/fact-checker.toml"
  # shellcheck disable=SC1090
  source "$HELPERS"
  REPO_ROOT="$fixture_root"
  got="$(tribunal_codex_agent_model fact-checker)"
  [ "$got" = "gpt-role-a" ] || {
    echo "x role model = '$got', want gpt-role-a" >&2
    exit 1
  }
  got="$(GP_CODEX_MODEL=gpt-override tribunal_codex_agent_model fact-checker)"
  [ "$got" = "gpt-override" ] || {
    echo "x override model = '$got', want gpt-override" >&2
    exit 1
  }
  printf 'model = ["not", "scalar"]\n' > "$fixture_root/.codex/agents/fact-checker.toml"
  if tribunal_codex_agent_model fact-checker >/dev/null 2>&1; then
    echo "x invalid TOML model resolved successfully" >&2
    exit 1
  fi
  marker="$fixture_root/codex-called"
  cat > "$fixture_root/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
: > "$FAKE_CODEX_CALLED"
exit 0
FAKE_CODEX
  chmod +x "$fixture_root/bin/codex"
  if PATH="$fixture_root/bin:$PATH" FAKE_CODEX_CALLED="$marker" \
    tribunal_codex_exec "$fixture_root" fact-checker 'test prompt' >/dev/null 2>&1; then
    echo "x Codex exec succeeded with an invalid role model" >&2
    exit 1
  fi
  if [ -e "$marker" ]; then
    echo "x fake Codex was invoked before role-model validation failed" >&2
    exit 1
  fi
) || fail "Codex TOML model selection is not strict/per-role"
pass "Codex TOML parser selects per-role model, honors explicit override, and fails closed"

# Missing/legacy agent specs must fall back to the declared Tribunal writer
# model, not a second hardcoded copy that can drift from agent frontmatter.
(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-model-ssot.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  mkdir -p "$fixture_root/.claude/agents"
  printf '%s\n' '---' 'name: tribunal-writer' 'model: claude-opus-future-fixture' '---' \
    > "$fixture_root/.claude/agents/tribunal-writer.md"
  # shellcheck disable=SC1090
  source "$HELPERS"
  # shellcheck disable=SC2034 # sourced helpers intentionally read this override
  REPO_ROOT="$fixture_root"
  got_fallback="$(tribunal_claude_agent_model missing-legacy-agent)"
  [ "$got_fallback" = "claude-opus-future-fixture" ] || {
    echo "x missing agent fallback = '$got_fallback', want tribunal-writer frontmatter model" >&2
    exit 1
  }
) || fail "Claude fallback model drifted from tribunal-writer agent SSOT"
pass "Claude fallback model is derived from tribunal-writer agent frontmatter"

# Model selection must read only the first YAML frontmatter block and fail
# before invoking Claude when that block has no usable model declaration.
(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-model-fail-closed.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  mkdir -p "$fixture_root/.claude/agents" "$fixture_root/bin"
  # shellcheck disable=SC1090
  source "$HELPERS"
  # shellcheck disable=SC2034 # sourced helpers intentionally read this override
  REPO_ROOT="$fixture_root"

  printf '%s\n' '---' 'name: tribunal-writer' '---' 'no model here' \
    > "$fixture_root/.claude/agents/tribunal-writer.md"
  if tribunal_claude_agent_model tribunal-writer >/dev/null 2>&1; then
    echo "x writer without a frontmatter model resolved successfully" >&2
    exit 1
  fi

  printf '%s\n' '---' 'name: tribunal-writer' '---' 'model: body-only-fixture' \
    > "$fixture_root/.claude/agents/tribunal-writer.md"
  if tribunal_claude_agent_model tribunal-writer >/dev/null 2>&1; then
    echo "x body-only model declaration was accepted as frontmatter" >&2
    exit 1
  fi

  for invalid_model in null '"opus' '[opus]' '#comment'; do
    printf '%s\n' '---' 'name: tribunal-writer' "model: $invalid_model" '---' \
      > "$fixture_root/.claude/agents/tribunal-writer.md"
    if tribunal_claude_agent_model tribunal-writer >/dev/null 2>&1; then
      echo "x invalid model selector '$invalid_model' was accepted" >&2
      exit 1
    fi
  done

  marker="$fixture_root/claude-called"
  cat > "$fixture_root/bin/claude" <<'FAKE_CLAUDE'
#!/usr/bin/env bash
: > "$FAKE_CLAUDE_CALLED"
exit 0
FAKE_CLAUDE
  chmod +x "$fixture_root/bin/claude"
  printf '%s\n' '---' 'name: tribunal-writer' 'model: null' '---' \
    > "$fixture_root/.claude/agents/tribunal-writer.md"
  if PATH="$fixture_root/bin:$PATH" FAKE_CLAUDE_CALLED="$marker" \
    tribunal_claude_exec "$fixture_root" tribunal-writer 'test prompt' >/dev/null 2>&1; then
    echo "x Claude exec succeeded without a frontmatter model" >&2
    exit 1
  fi
  if [ -e "$marker" ]; then
    echo "x fake Claude was invoked before model validation failed" >&2
    exit 1
  fi
) || fail "Claude model parsing/execution is not fail closed"
pass "Claude model parser is frontmatter-only and exec fails before invocation"

(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-provider-contract.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  mkdir -p "$fixture_root/.codex/agents" "$fixture_root/.claude/agents" "$fixture_root/bin"
  for role in vibe-opus-scorer fact-checker librarian fresh-eyes; do
    printf 'model = "gpt-%s-fixture"\n' "$role" > "$fixture_root/.codex/agents/$role.toml"
  done
  printf '%s\n' '---' 'model: claude-vibe-fixture' '---' \
    > "$fixture_root/.claude/agents/vibe-opus-scorer.md"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture_root/bin/codex"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture_root/bin/claude"
  chmod +x "$fixture_root/bin/codex" "$fixture_root/bin/claude"
  ln -s "$(command -v python3)" "$fixture_root/bin/python3"
  # shellcheck disable=SC1090
  source "$HELPERS"
  REPO_ROOT="$fixture_root"
  PATH="$fixture_root/bin:/usr/bin:/bin"

  got_vibe="$(TRIBUNAL_STRICT_ROLE_PROVIDERS=1 tribunal_judge_provider vibe-opus-scorer)"
  [ "$got_vibe" = "codex" ] || { echo "x strict vibe = '$got_vibe', want codex" >&2; exit 1; }
  got_vibe_model="$(TRIBUNAL_STRICT_ROLE_PROVIDERS=1 tribunal_llm_model_id vibe-opus-scorer)"
  [ "$got_vibe_model" = "gpt-vibe-opus-scorer-fixture" ] || {
    echo "x strict vibe model = '$got_vibe_model'" >&2
    exit 1
  }
  got_fact="$(TRIBUNAL_STRICT_ROLE_PROVIDERS=1 tribunal_judge_provider fact-checker)"
  [ "$got_fact" = "codex" ] || { echo "x strict fact = '$got_fact', want codex" >&2; exit 1; }
  got_model="$(TRIBUNAL_STRICT_ROLE_PROVIDERS=1 tribunal_llm_model_id fact-checker)"
  [ "$got_model" = "gpt-fact-checker-fixture" ] || {
    echo "x strict fact model = '$got_model'" >&2
    exit 1
  }
  if TRIBUNAL_STRICT_ROLE_PROVIDERS=1 TRIBUNAL_FORCE_PROVIDER=codex \
    tribunal_judge_provider fact-checker >/dev/null 2>&1; then
    echo "x strict mode accepted TRIBUNAL_FORCE_PROVIDER" >&2
    exit 1
  fi

  got_forced="$(TRIBUNAL_FORCE_PROVIDER=codex tribunal_judge_provider vibe-opus-scorer)"
  [ "$got_forced" = "codex" ] || { echo "x compat force override = '$got_forced'" >&2; exit 1; }
  rm "$fixture_root/bin/codex"
  got_fallback="$(tribunal_judge_provider fact-checker)"
  [ "$got_fallback" = "claude" ] || { echo "x compat fallback = '$got_fallback', want claude" >&2; exit 1; }
  if TRIBUNAL_STRICT_ROLE_PROVIDERS=1 tribunal_judge_provider fact-checker >/dev/null 2>&1; then
    echo "x strict objective judge silently fell back without codex" >&2
    exit 1
  fi
) || fail "strict role provider / compatibility fallback behavioral check failed"
pass "strict routing keeps all four judges on role-pinned Codex; compatibility fallback remains strict-off only"

if ! grep -q '^Environment=TRIBUNAL_STRICT_ROLE_PROVIDERS=1$' "$SERVICE" ||
   ! grep -q '^Environment=TRIBUNAL_RUNTIME_PROFILE=vm-codex$' "$SERVICE" ||
   ! grep -q '^Environment=GP_WRITER_MODE=grok$' "$SERVICE" ||
   ! grep -q '^Slice=tribunal-runtime.slice$' "$SERVICE" ||
   ! grep -q '^export TRIBUNAL_RUNTIME_PROFILE="${TRIBUNAL_RUNTIME_PROFILE:-legacy}"$' "$WRAPPER" ||
   ! grep -q '^export GP_WRITER_MODE="${GP_WRITER_MODE:-codex}"$' "$WRAPPER" ||
   ! grep -q '^if \[ "$TRIBUNAL_RUNTIME_PROFILE" = "vm-codex" \]; then$' "$WRAPPER"; then
  fail "service must select VM/Grok while the generic wrapper preserves legacy defaults and guards host identity"
fi
if ! grep -q '^MemoryMax=4G$' "$SLICE" ||
   ! grep -q '^CPUQuota=200%$' "$SLICE" ||
   ! grep -q '^TasksMax=1024$' "$SLICE"; then
  fail "shared Tribunal slice does not preserve the aggregate resource boundary"
fi
if ! grep -Fq -- '--slice=tribunal-runtime.slice' "$HELPERS" ||
   ! grep -Fq -- '--property=KillMode=control-group' "$HELPERS" ||
   ! grep -Fq -- '--expand-environment=no' "$HELPERS" ||
   ! grep -q 'tribunal_stop_systemd_invocation' "$HELPERS"; then
  fail "deployed Codex calls lack transient-service cgroup containment"
fi
if grep -Eq 'CLAUDE_CODE_OAUTH_TOKEN|cc-cron-token' "$WRAPPER" "$SERVICE"; then
  fail "deployed service/wrapper still reads Claude credentials"
fi
if grep -q 'USAGE_MONITOR' "$WRAPPER" "$SERVICE"; then
  fail "deployed service/wrapper still depends on an off-repo combined usage monitor"
fi
if ! grep -q 'deployed_runtime_preflight' "$LOOP" ||
   ! grep -q 'tribunal_writer_preflight' "$HELPERS"; then
  fail "deployed writer preflight is not wired before quota-loop dispatch"
fi
if ! grep -q 'recover-pending' "$LOOP" ||
   ! grep -q 'recover-pending "$wt/src/content/posts"' "$LOOP"; then
  fail "deployed startup does not recover pending canonical bilingual transactions"
fi
worker_recovery_line="$(
  grep -n 'recover_worker_pending_transactions "$wt"' "$LOOP" |
    head -1 | cut -d: -f1
)"
worker_sync_line="$(
  grep -n 'tribunal-worker-bootstrap.sh" sync' "$LOOP" |
    head -1 | cut -d: -f1
)"
if [ -z "$worker_recovery_line" ] || [ -z "$worker_sync_line" ] ||
   [ "$worker_recovery_line" -ge "$worker_sync_line" ]; then
  fail "worker crash journals are not recovered before destructive worktree sync"
fi
(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-writer-preflight.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  mkdir -p "$fixture_root/.codex/agents" "$fixture_root/bin"
  printf 'model = "gpt-writer-fixture"\n' \
    > "$fixture_root/.codex/agents/tribunal-writer.toml"
  cat > "$fixture_root/bin/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then exit 0; fi
prompt="${!#}"
for ((i = 1; i < $#; i++)); do
  printf '%s\n' "${!i}"
done > "$FAKE_CODEX_ARGS"
path="$(printf '%s\n' "$prompt" | sed -n 's/^Canary path: //p')"
token="$(printf '%s\n' "$prompt" | sed -n 's/^Canary token: //p')"
[ -n "$path" ] && [ -n "$token" ] || exit 2
printf '%s\n' "$token" > "$path"
printf 'OK\n'
FAKE_CODEX
  chmod +x "$fixture_root/bin/codex"
  # shellcheck disable=SC1090
  source "$HELPERS"
  REPO_ROOT="$fixture_root"
  args="$fixture_root/args"
  if GP_WRITER_MODE=none tribunal_writer_preflight >/dev/null 2>&1; then
    echo "x writer preflight accepted none mode" >&2
    exit 1
  fi
  if GP_WRITER_MODE=subagent tribunal_writer_preflight >/dev/null 2>&1; then
    echo "x writer preflight accepted unconsumed subagent mode" >&2
    exit 1
  fi
  if GP_WRITER_MODE=cli tribunal_writer_preflight >/dev/null 2>&1; then
    echo "x writer preflight accepted compatibility-only cli mode" >&2
    exit 1
  fi
  PATH="$fixture_root/bin:$PATH" FAKE_CODEX_ARGS="$args" GP_WRITER_MODE=codex \
    TRIBUNAL_WRITER_PREFLIGHT_TIMEOUT_SEC=2 tribunal_writer_preflight >/dev/null
  cat > "$fixture_root/expected.args" <<'EXPECTED_ARGS'
exec
--model
gpt-writer-fixture
-c
model_reasoning_effort="medium"
-c
approval_policy="never"
-c
sandbox_workspace_write.writable_roots=[]
-c
sandbox_workspace_write.exclude_slash_tmp=true
-c
sandbox_workspace_write.exclude_tmpdir_env_var=true
-c
sandbox_workspace_write.network_access=false
-c
shell_environment_policy.inherit="core"
-c
web_search="disabled"
--sandbox
workspace-write
--ignore-user-config
--ignore-rules
--ephemeral
--strict-config
--skip-git-repo-check
--
EXPECTED_ARGS
  cmp -s "$fixture_root/expected.args" "$args" || {
    diff -u "$fixture_root/expected.args" "$args" >&2 || true
    exit 1
  }
) || fail "bounded Codex write-canary preflight behavioral check failed"
pass "deployed runtime selects the VM profile while legacy Codex preflight stays compatible"

if ! grep -Fq 'codex|grok) ;;' "$TRIBUNAL" ||
   grep -Fq 'complete Codex provider/model provenance' "$TRIBUNAL"; then
  fail "isolated writer transaction does not accept complete Grok provenance"
fi
if ! grep -Fq 'tribunal_grok_prompt_exec' "$GROK_BRIDGE" ||
   ! grep -Fq 'model_router_assert_profile_compatible' "$GROK_BRIDGE"; then
  fail "Go Grok bridge bypasses the shared VM compatibility/containment executor"
fi
pass "Grok writer transactions and Go calls share provider-neutral provenance + containment"

(
  fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/gu-tribunal-notifier.XXXXXX")"
  trap 'rm -rf "$fixture_root"' EXIT
  capture="$fixture_root/capture"
  marker="$fixture_root/must-not-exist"
  cat > "$fixture_root/notifier" <<'NOTIFIER'
#!/usr/bin/env bash
printf '%s\n' "$#" "$1" > "$TRIBUNAL_NOTIFIER_CAPTURE"
NOTIFIER
  chmod +x "$fixture_root/notifier"
  # shellcheck disable=SC1090
  source "$HELPERS"
  message="spaces 'quotes' \$(touch $marker); semicolon"
  TRIBUNAL_NOTIFIER_CAPTURE="$capture" \
    TRIBUNAL_NOTIFIER="$fixture_root/notifier" \
    tribunal_quota_alarm "$message" 2>/dev/null
  [ "$(sed -n '1p' "$capture")" = "1" ] || {
    echo "x notifier did not receive exactly one argument" >&2
    exit 1
  }
  [ "$(sed -n '2p' "$capture")" = "$message" ] || {
    echo "x notifier message changed" >&2
    exit 1
  }
  [ ! -e "$marker" ] || {
    echo "x notifier message was evaluated as shell code" >&2
    exit 1
  }
) || fail "TRIBUNAL_NOTIFIER argv safety check failed"
pass "notifier receives one unchanged argv without shell evaluation"

if ! grep -q 'temporary directory' "$CODEX_WRITER" || ! grep -q 'surgical editor' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt lacks GPT-5.5 temp-dir/surgical-edit guardrails"
fi
if ! grep -q 'Do not run the full tribunal' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt does not prohibit nested tribunal/quota-burning calls"
fi
if ! grep -q 'The Repo root is read-only reference material' "$TRIBUNAL" ||
   ! grep -q 'TRIBUNAL_CANDIDATE_ZH_PATH' "$TRIBUNAL"; then
  fail "Tribunal writer task prompt does not confine edits to candidate paths"
fi
if ! grep -q 'tribunal_codex_writer_exec' "$HELPERS" ||
   ! grep -q 'tribunal_codex_writer_prompt_exec' "$HELPERS" ||
   ! grep -q -- '--sandbox workspace-write' "$HELPERS" ||
   ! grep -q 'sandbox_workspace_write.exclude_slash_tmp=true' "$HELPERS"; then
  fail "Tribunal Codex writer lacks its dedicated fail-closed sandbox"
fi
if ! sed -n '/^tribunal_codex_writer_exec()/,/^}/p' "$HELPERS" |
     grep -q 'tribunal_codex_writer_prompt_exec' ||
   ! sed -n '/^tribunal_codex_writer_prompt_exec()/,/^}/p' "$HELPERS" |
     grep -q 'tribunal_codex_workspace_prompt_exec' ||
   ! sed -n '/^tribunal_writer_preflight()/,/^)/p' "$HELPERS" |
     grep -q 'tribunal_codex_writer_prompt_exec' ||
   [ "$(sed -n '/^tribunal_codex_workspace_prompt_exec()/,/^}/p' "$HELPERS" |
        grep -c -- '--sandbox workspace-write')" -ne 1 ]; then
  fail "formal writer and deployed canary do not share one exact sandbox executor"
fi
if grep -q 'WRITING_GUIDELINES.md' "$TRIBUNAL" "$CODEX_WRITER"; then
  fail "Tribunal writer prompt references removed WRITING_GUIDELINES.md"
fi
pass "Codex tribunal writer prompt is tuned for GPT-5.5 isolated execution"

if ! grep -q 'tribunal-assert-pass-artifacts.sh' "$TRIBUNAL"; then
  fail "PASS artifact guard is not wired into commit_progress"
fi
pass "PASS artifact guard remains wired"
