#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROUTER="$ROOT_DIR/scripts/tribunal-model-router.sh"
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
fi
exit 0
SCRIPT
cat > "$BIN_DIR/codexbar" <<'SCRIPT'
#!/usr/bin/env bash
printf '[{"provider":"codex","usage":{"primary":{"usedPercent":-1}}}]\n'
SCRIPT
cat > "$BIN_DIR/usage-monitor" <<'SCRIPT'
#!/usr/bin/env bash
printf '[{"provider":"openai","status":"ok","session_remaining_pct":101,"weekly_remaining_pct":101}]\n'
SCRIPT
chmod +x "$BIN_DIR/codex" "$BIN_DIR/grok" "$BIN_DIR/codexbar" \
  "$BIN_DIR/usage-monitor"
export PATH="$BIN_DIR:$PATH"

assert_route() {
  local payload="$1" model="$2" effort="$3" tier="$4" action="${5:-run}"
  jq -e --arg model "$model" --arg effort "$effort" --arg tier "$tier" \
    --arg action "$action" '
    .runtimeProfile == "vm-codex"
    and .model == $model
    and .reasoningEffort == $effort
    and .quotaTier == $tier
    and .quotaAction == $action
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
  TRIBUNAL_GROK_REMAINING_PCT=20 bash "$ROUTER" writer --json
})" grok-4.5 low normal
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_GROK_REMAINING_PCT=19 bash "$ROUTER" vibeScorer --json
})" grok-4.5 low lowQuota defer
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_GROK_REMAINING_PCT=19 bash "$ROUTER" writer --json
})" grok-4.5 low lowQuota reserve
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_GROK_REMAINING_PCT=9.99 bash "$ROUTER" writer --json
})" grok-4.5 low criticalQuota pause
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=101 bash "$ROUTER" reviewer --json
})" gpt-5.6-luna max lowQuota
assert_route "$({
  TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_GROK_REMAINING_PCT=101 bash "$ROUTER" writer --json
})" grok-4.5 low normal
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

legacy="$(TRIBUNAL_RUNTIME_PROFILE=legacy PATH=/usr/bin:/bin \
  bash "$ROUTER" reviewer --json)"
jq -e '
  .runtimeProfile == "legacy"
  and .provider == ""
  and .model == ""
  and .quotaTier == "legacy"
  and .quotaAction == "run"
' <<<"$legacy" >/dev/null

CODEX_ONLY="$TMP_DIR/codex-only"
mkdir -p "$CODEX_ONLY"
cp "$BIN_DIR/codex" "$CODEX_ONLY/codex"
if PATH="$CODEX_ONLY:/usr/bin:/bin" TRIBUNAL_RUNTIME_PROFILE=vm-codex \
  TRIBUNAL_REVIEWER_REMAINING_PCT=50 bash "$ROUTER" reviewer --json \
  >/dev/null 2>&1; then
  echo "vm-codex profile should fail when Grok is unavailable" >&2
  exit 1
fi

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
  echo "vm-codex profile should fail when Codex is logged out" >&2
  exit 1
fi

# Sourced callers resolve multiple roles in one shell; a deferred Vibe action
# must never leak into the following reviewer route.
cat > "$BIN_DIR/codex" <<'SCRIPT'
#!/usr/bin/env bash
exit 0
SCRIPT
chmod +x "$BIN_DIR/codex"
source "$ROUTER"
TRIBUNAL_RUNTIME_PROFILE=vm-codex
TRIBUNAL_GROK_REMAINING_PCT=19
TRIBUNAL_REVIEWER_REMAINING_PCT=50
export TRIBUNAL_RUNTIME_PROFILE TRIBUNAL_GROK_REMAINING_PCT \
  TRIBUNAL_REVIEWER_REMAINING_PCT
model_router_resolve vibeScorer
[ "$MODEL_ROUTER_QUOTA_ACTION" = defer ]
model_router_resolve reviewer
[ "$MODEL_ROUTER_QUOTA_ACTION" = run ]

if TRIBUNAL_RUNTIME_PROFILE=bogus TRIBUNAL_STRICT_ROLE_PROVIDERS=1 \
  REPO_ROOT="$ROOT_DIR" bash -c '
    source "$1/scripts/tribunal-helpers.sh"
    tribunal_judge_provider fact-checker
  ' _ "$ROOT_DIR" >/dev/null 2>&1; then
  echo "invalid runtime profile must not fall through to legacy Codex" >&2
  exit 1
fi

isolated_helpers="$TMP_DIR/isolated-tribunal-helpers.sh"
cp "$ROOT_DIR/scripts/tribunal-helpers.sh" "$isolated_helpers"
if TRIBUNAL_RUNTIME_PROFILE=bogus bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers" >/dev/null 2>&1; then
  echo "isolated helper must reject an unknown explicit runtime profile" >&2
  exit 1
fi
[ "$(TRIBUNAL_RUNTIME_PROFILE=legacy bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers")" = legacy ]
if TRIBUNAL_RUNTIME_PROFILE=vm-codex bash -c '
  source "$1"
  model_router_profile
' _ "$isolated_helpers" >/dev/null 2>&1; then
  echo "isolated helper must reject vm-codex without its model router" >&2
  exit 1
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

echo "ok vm-codex routing, compatibility gate, thresholds, and legacy isolation"
