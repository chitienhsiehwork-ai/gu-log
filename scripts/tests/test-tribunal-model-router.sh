#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTER="$ROOT_DIR/scripts/tribunal-model-router.sh"
CONFIG="$ROOT_DIR/config/llm-pipeline.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BIN_DIR="$TMP_DIR/bin"
mkdir -p "$BIN_DIR"

fail() { echo "x $*" >&2; exit 1; }

cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
cat > "$BIN_DIR/claude" <<'SCRIPT'
#!/usr/bin/env bash
if [ -n "${FAKE_CLAUDE_CALLS:-}" ]; then
  printf '%s\n' "$*" >> "$FAKE_CLAUDE_CALLS"
fi
if [ "${1:-}" = auth ] && [ "${2:-}" = status ]; then
  if [ -n "${FAKE_CLAUDE_ENV:-}" ]; then
    env > "$FAKE_CLAUDE_ENV"
  fi
  printf '{"loggedIn":%s}\n' "${FAKE_CLAUDE_LOGGED_IN:-true}"
  exit 0
fi
exit 1
SCRIPT
cat > "$BIN_DIR/codexbar" <<'SCRIPT'
#!/usr/bin/env bash
printf '[{"provider":"codex","usage":{"primary":{"usedPercent":-1}}}]\n'
SCRIPT
cat > "$BIN_DIR/usage-monitor" <<'SCRIPT'
#!/usr/bin/env bash
printf '[{"provider":"openai","status":"ok","session_remaining_pct":101,"weekly_remaining_pct":101}]\n'
SCRIPT
chmod +x "$BIN_DIR/codex" "$BIN_DIR/claude" "$BIN_DIR/codexbar" \
  "$BIN_DIR/usage-monitor"
export PATH="$BIN_DIR:/usr/bin:/bin"
export REPO_ROOT=""

writer_pin="$(bash -c '
  source "$1/scripts/tribunal-helpers.sh"
  tribunal_claude_agent_model tribunal-writer
' _ "$ROOT_DIR")"
[ -n "$writer_pin" ] || fail "cannot read the Claude model pin from tribunal-writer frontmatter"

assert_route() {
  local payload="$1" model="$2" effort="$3" tier="$4"
  jq -e --arg model "$model" --arg effort "$effort" --arg tier "$tier" '
    .runtimeProfile == "vm-codex"
    and .model == $model
    and .reasoningEffort == $effort
    and .quotaTier == $tier
  ' <<<"$payload" >/dev/null
}

assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=20 bash "$ROUTER" reviewer --json
})" gpt-5.6-sol xhigh primary
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=19.99 bash "$ROUTER" reviewer --json
})" gpt-5.6-luna max lowQuota
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" vibeScorer --json
})" gpt-5.5 high normal
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" sourceReviewer --json
})" gpt-5.6-sol xhigh normal
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=101 bash "$ROUTER" reviewer --json
})" gpt-5.6-luna max lowQuota
assert_route "$({
  env -u TRIBUNAL_REVIEWER_REMAINING_PCT \
    TRIBUNAL_RUNTIME_PROFILE=vm-codex \
    USAGE_MONITOR="$BIN_DIR/usage-monitor" \
    bash "$ROUTER" reviewer --json
})" gpt-5.6-luna max lowQuota
assert_route "$({
  env -u TRIBUNAL_REVIEWER_REMAINING_PCT -u USAGE_MONITOR \
    TRIBUNAL_RUNTIME_PROFILE=vm-codex \
    bash "$ROUTER" reviewer --json
})" gpt-5.6-luna max lowQuota

# Every article-writing role uses the Claude model pin from the tribunal-writer
# frontmatter; config never carries a copy of it.
for role in writer tribunal-writer refiner translator corrector commentary; do
  payload="$(TRIBUNAL_RUNTIME_PROFILE=vm-codex bash "$ROUTER" "$role" --json)"
  jq -e '.provider == "claude"' <<<"$payload" >/dev/null ||
    fail "$role must route to Claude: $payload"
  assert_route "$payload" "$writer_pin" "" normal ||
    fail "$role must use the Claude model pin without an effort: $payload"
done
for role in writer translator corrector commentary; do
  if jq -e --arg role "$role" \
    '.profiles["vm-codex"][$role] | has("model") or has("reasoningEffort")' \
    "$CONFIG" >/dev/null; then
    fail "config must not copy the Claude model pin into $role"
  fi
done

# The login check sees only the CLI's own login state: API-key and token
# variables are dropped exactly as for the VM's Claude calls.
ANTHROPIC_API_KEY=sk-ant-fixture ANTHROPIC_AUTH_TOKEN=bearer-fixture \
CLAUDE_CODE_OAUTH_TOKEN=oauth-fixture FAKE_CLAUDE_ENV="$TMP_DIR/claude-auth.env" \
TRIBUNAL_RUNTIME_PROFILE=vm-codex bash "$ROUTER" writer --json >/dev/null
for variable in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN; do
  if grep -q "^$variable=" "$TMP_DIR/claude-auth.env"; then
    fail "Claude login check saw $variable"
  fi
done

# Judge routes never run the Claude CLI; a logged-out Claude blocks only the
# article-writing roles.
rm -f "$TMP_DIR/claude-calls"
FAKE_CLAUDE_CALLS="$TMP_DIR/claude-calls" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" reviewer --json >/dev/null
FAKE_CLAUDE_CALLS="$TMP_DIR/claude-calls" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" vibeScorer --json >/dev/null
[ ! -e "$TMP_DIR/claude-calls" ] || fail "judge routing invoked the Claude CLI"
FAKE_CLAUDE_LOGGED_IN=false TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" reviewer --json >/dev/null ||
  fail "a logged-out Claude CLI must not block judge routing"
if FAKE_CLAUDE_LOGGED_IN=false TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  bash "$ROUTER" writer --json >/dev/null 2>&1; then
  fail "writer routing must fail when the Claude CLI is logged out"
fi

legacy="$(TRIBUNAL_RUNTIME_PROFILE=legacy PATH=/usr/bin:/bin \
  bash "$ROUTER" reviewer --json)"
jq -e '
  .runtimeProfile == "legacy"
  and .provider == ""
  and .model == ""
  and .quotaTier == "legacy"
' <<<"$legacy" >/dev/null

CODEX_ONLY="$TMP_DIR/codex-only"
mkdir -p "$CODEX_ONLY"
cp "$BIN_DIR/codex" "$CODEX_ONLY/codex"
if PATH="$CODEX_ONLY:/usr/bin:/bin" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  bash "$ROUTER" translator --json >/dev/null 2>&1; then
  fail "article-writing routes must fail when the Claude CLI is unavailable"
fi
PATH="$CODEX_ONLY:/usr/bin:/bin" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" reviewer --json >/dev/null ||
  fail "judge routing must not require the Claude CLI"

cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
if [ "${1:-}" = login ] && [ "${2:-}" = status ]; then
  exit 1
fi
exit 0
SCRIPT
chmod +x "$BIN_DIR/codex"
if TRIBUNAL_RUNTIME_PROFILE=vm-codex TRIBUNAL_REVIEWER_REMAINING_PCT=50 \
  bash "$ROUTER" reviewer --json >/dev/null 2>&1; then
  fail "vm-codex judge routing should fail when Codex is logged out"
fi
cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
chmod +x "$BIN_DIR/codex"

# Config guards: an article-writing role on another provider, a judge on the
# Claude model and a copied Claude pin fail closed before any dispatch.
assert_config_rejected() {
  local label="$1" filter="$2" role="$3" expected="$4"
  local fixture="$TMP_DIR/config-$label.json"
  jq "$filter" "$CONFIG" > "$fixture"
  if TRIBUNAL_MODEL_CONFIG="$fixture" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
    TRIBUNAL_REVIEWER_REMAINING_PCT=50 \
    bash "$ROUTER" "$role" --json >"$TMP_DIR/$label.out" 2>&1; then
    fail "router accepted config drift: $label"
  fi
  grep -q -- "$expected" "$TMP_DIR/$label.out" ||
    fail "config drift $label lacked diagnostic '$expected': $(cat "$TMP_DIR/$label.out")"
}
assert_config_rejected codex-writer \
  '.profiles["vm-codex"].writer = {"provider":"codex","model":"gpt-5.6-sol","reasoningEffort":"xhigh"}' \
  writer 'must use the Claude model'
assert_config_rejected codex-corrector \
  '.profiles["vm-codex"].corrector = {"provider":"codex","model":"gpt-5.6-sol","reasoningEffort":"xhigh","promptContract":"bounded-correct-v1","outputContract":"bounded-patch-v1"}' \
  corrector 'must use the Claude model'
assert_config_rejected claude-judge \
  '.profiles["vm-codex"].vibeScorer = {"provider":"claude","promptContract":"vibe-gate-v1","outputContract":"gate-envelope-v1"}' \
  vibeScorer 'only article-writing steps use the Claude model'
assert_config_rejected copied-pin \
  '.profiles["vm-codex"].translator.model = "claude-opus-copy"' \
  translator 'remove model/reasoningEffort'

# Sourced callers resolve several roles in one shell; a Claude writer route
# must not leak its empty effort into the following Codex vibe route.
source "$ROUTER"
TRIBUNAL_RUNTIME_PROFILE=vm-codex
TRIBUNAL_REVIEWER_REMAINING_PCT=50
export TRIBUNAL_RUNTIME_PROFILE TRIBUNAL_REVIEWER_REMAINING_PCT
model_router_resolve writer
[ "$MODEL_ROUTER_PROVIDER" = claude ] || fail "sourced writer route is not Claude"
model_router_resolve vibeScorer
[ "$MODEL_ROUTER_PROVIDER" = codex ] || fail "sourced vibe route is not Codex"
[ "$MODEL_ROUTER_REASONING" = high ] || fail "sourced vibe route lost its effort"

if TRIBUNAL_RUNTIME_PROFILE=bogus TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
  REPO_ROOT="$ROOT_DIR" bash -c '
    source "$1/scripts/tribunal-helpers.sh"
    tribunal_judge_provider fact-checker
  ' _ "$ROOT_DIR" >/dev/null 2>&1; then
  fail "invalid runtime profile must not fall through to legacy Codex"
fi

isolated_helpers="$TMP_DIR/isolated-tribunal-helpers.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$isolated_helpers"
if TRIBUNAL_RUNTIME_PROFILE=bogus bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers" >/dev/null 2>&1; then
  fail "isolated helper must reject an unknown explicit runtime profile"
fi
[ "$(TRIBUNAL_RUNTIME_PROFILE=legacy bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers")" = legacy ]
if TRIBUNAL_RUNTIME_PROFILE=vm-codex bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers" >/dev/null 2>&1; then
  fail "isolated helper must reject vm-codex without its model router"
fi

# A sourced router is a function library and must not mutate a legacy caller's
# shell error/undefined-variable/pipefail policy.
bash -c '
  set +e +u +o pipefail
  before="$-:$(set -o | awk '\''$1 == "pipefail" { print $2 }'\'')"
  source "$1"
  after="$-:$(set -o | awk '\''$1 == "pipefail" { print $2 }'\'')"
  [ "$before" = "$after" ]
' _ "$ROUTER"

echo "ok vm-codex routing: Claude article-writing pin, Codex judges, per-provider preflight, config guards, legacy isolation"
