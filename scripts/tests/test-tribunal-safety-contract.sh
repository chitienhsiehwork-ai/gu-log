#!/usr/bin/env bash
# Static/no-token regressions for Tribunal v8 safety hardening.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"
VIBE="$ROOT_DIR/scripts/vibe-scorer.sh"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"
WRAPPER="$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh"
CODEX_AGENTS_DIR="$ROOT_DIR/.codex/agents"
CODEX_WRITER="$CODEX_AGENTS_DIR/tribunal-writer.toml"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

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

if ! grep -q '.codex/agents/\$agent_name.toml' "$HELPERS"; then
  fail "Codex tribunal helper does not prefer .codex/agents custom agents"
fi
if ! grep -q 'Ignore YAML' "$HELPERS" || ! grep -q 'frontmatter runtime fields' "$HELPERS"; then
  fail "Codex tribunal helper does not ignore Claude Code frontmatter runtime"
fi
pass "Codex agent specs are separated from Claude Code frontmatter"

if ! grep -Fq -- '--model "${GP_CODEX_MODEL:-gpt-5.5}"' "$HELPERS"; then
  fail "Codex tribunal helper does not preserve GPT-5.5 as the default model"
fi
if ! grep -q 'MIN_CODEX_VERSION="0.128.0"' "$TRIBUNAL"; then
  fail "Tribunal does not reject known-broken old Codex CLI versions"
fi
if ! grep -Fq 'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"' "$WRAPPER"; then
  fail "Tribunal systemd wrapper does not prefer the current ~/.local/bin Codex before stale ~/bin"
fi
# model_id is provider-resolved now: codex defaults to GPT-5.5 while allowing
# an explicit run-scoped override; claude is the CCC sandbox fallback. Guard
# both halves so a refactor cannot drop the default or provenance resolver.
if ! grep -q 'model_id="$(tribunal_llm_model_id' "$TRIBUNAL"; then
  fail "Tribunal model_id is not resolved through the provider-aware tribunal_llm_model_id"
fi
if ! grep -Fq '"${GP_CODEX_MODEL:-gpt-5.5}"' "$HELPERS"; then
  fail "Codex provider path no longer records the selected run-scoped model"
fi
unpinned_agents=$(grep -L '^model = "gpt-5.5"' "$CODEX_AGENTS_DIR"/*.toml || true)
if [ -n "$unpinned_agents" ]; then
  fail "One or more Codex tribunal agent specs are not pinned to GPT-5.5: $unpinned_agents"
fi
pass "Tribunal model selection: GPT-5.5 default + explicit run-scoped override, claude fallback unchanged"

# The internal progress ledger runner_label must be provider-aware too, sharing
# the same resolver as the frontmatter model_id. A refactor must not regress it
# back to a static codex-gpt-5.5-medium string (that would mislabel CCC Claude
# runs as codex in calibration/audit data).
if ! grep -q 'tribunal_runner_label()' "$HELPERS"; then
  fail "tribunal_runner_label provider-aware helper is missing"
fi
if ! grep -q 'codex-%s-medium' "$HELPERS"; then
  fail "tribunal_runner_label codex path no longer includes the resolved model"
fi
if ! grep -q 'runner_label="$(tribunal_runner_label' "$TRIBUNAL"; then
  fail "Tribunal progress runner_label is not resolved through tribunal_runner_label"
fi
if grep -Eq 'codex-[^:[:space:]]+-medium:(factCheck|librarian|freshEyes|vibe)' "$TRIBUNAL"; then
  fail "STAGES still hardcodes a static Codex runner_label column"
fi
pass "Progress ledger runner_label is provider-aware (codex/claude), not a static codex string"

# Per-judge provider resolver: VibeScorer prefers Claude while the three
# objective judges stay Codex. Guard the resolver's existence, its vibe
# special-case, and that model_id / runner_label / exec_raw / watchdog all
# route through it.
if ! grep -q 'tribunal_judge_provider()' "$HELPERS"; then
  fail "tribunal_judge_provider agent-aware resolver is missing"
fi
if ! grep -qF 'vibe-opus-scorer" ] && tribunal_claude_cmd' "$HELPERS"; then
  fail "tribunal_judge_provider does not special-case vibe-opus-scorer to Claude"
fi
if [ "$(grep -cF 'tribunal_judge_provider "$agent_name"' "$HELPERS")" -lt 4 ]; then
  fail "model_id/runner_label/exec_raw/watchdog do not all route through tribunal_judge_provider"
fi
pass "per-judge provider resolver present and wired (vibe=Claude, others=Codex)"

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

# Behavioral check — only when BOTH codex and claude binaries are present (mac/
# VPS). vibe=Claude is guaranteed only in that case; a box missing claude
# degrades to the global provider by design, so skip rather than fail there.
if command -v codex >/dev/null 2>&1 && command -v claude >/dev/null 2>&1; then
  (
    # shellcheck disable=SC1090
    source "$HELPERS"
    got_vibe="$(tribunal_judge_provider vibe-opus-scorer)"
    [ "$got_vibe" = "claude" ] || { echo "x tribunal_judge_provider vibe-opus-scorer = '$got_vibe', want claude" >&2; exit 1; }
    got_fact="$(tribunal_judge_provider fact-checker)"
    [ "$got_fact" = "codex" ] || { echo "x tribunal_judge_provider fact-checker = '$got_fact', want codex" >&2; exit 1; }
    got_forced="$(TRIBUNAL_FORCE_PROVIDER=codex tribunal_judge_provider vibe-opus-scorer)"
    [ "$got_forced" = "codex" ] || { echo "x TRIBUNAL_FORCE_PROVIDER=codex vibe = '$got_forced', want codex" >&2; exit 1; }
  ) || fail "per-judge provider behavioral check failed"
  pass "per-judge provider behavior: vibe=claude, fact-checker=codex, force-override wins"
else
  pass "per-judge provider behavioral check skipped (codex+claude not both on PATH)"
fi

if ! grep -q 'temporary directory' "$CODEX_WRITER" || ! grep -q 'surgical editor' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt lacks GPT-5.5 temp-dir/surgical-edit guardrails"
fi
if ! grep -q 'Do not run the full tribunal' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt does not prohibit nested tribunal/quota-burning calls"
fi
if ! grep -q 'Use absolute paths under the Repo root' "$TRIBUNAL"; then
  fail "Tribunal writer task prompt does not force absolute repo paths"
fi
if grep -q 'WRITING_GUIDELINES.md' "$TRIBUNAL" "$CODEX_WRITER"; then
  fail "Tribunal writer prompt references removed WRITING_GUIDELINES.md"
fi
pass "Codex tribunal writer prompt is tuned for GPT-5.5 isolated execution"

if ! grep -q 'tribunal-assert-pass-artifacts.sh' "$TRIBUNAL"; then
  fail "PASS artifact guard is not wired into commit_progress"
fi
pass "PASS artifact guard remains wired"
