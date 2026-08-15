#!/usr/bin/env bash
# VM-only model router shared by Bash Tribunal and the Go gp-pipeline.
# Non-VM actors return the legacy profile so their existing routing is untouched.

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
fi

MODEL_ROUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_ROUTER_ROOT="$(cd "$MODEL_ROUTER_DIR/.." && pwd)"
MODEL_ROUTER_CONFIG="${TRIBUNAL_MODEL_CONFIG:-$MODEL_ROUTER_ROOT/config/llm-pipeline.json}"

model_router_profile() {
  local profile="${TRIBUNAL_RUNTIME_PROFILE:-}"
  if [ -z "$profile" ]; then
    if [ "${TRIBUNAL_AUTO_PROFILE:-0}" = 1 ]; then
      local identity=""
      identity="$(
        bash "$MODEL_ROUTER_ROOT/scripts/detect-env.sh" \
          --runtime codex --identity 2>/dev/null || true
      )"
      if [ "$identity" = "vm-codex" ]; then
        profile="vm-codex"
      else
        profile="legacy"
      fi
    else
      profile="legacy"
    fi
  fi
  case "$profile" in
    legacy) ;;
    vm-codex)
      jq -e '.profiles["vm-codex"] | type == "object"' \
        "$MODEL_ROUTER_CONFIG" >/dev/null 2>&1 || {
        printf 'invalid vm-codex model config: %s\n' "$MODEL_ROUTER_CONFIG" >&2
        return 2
      }
      ;;
    *)
      printf 'unknown runtime profile: %s\n' "$profile" >&2
      return 2
      ;;
  esac
  printf '%s\n' "$profile"
}

model_router_provider_compatible() {
  case "$1" in
    codex)
      command -v codex >/dev/null 2>&1 &&
        codex exec --help >/dev/null 2>&1 &&
        codex login status >/dev/null 2>&1
      ;;
    grok)
      command -v grok >/dev/null 2>&1 && grok --help >/dev/null 2>&1
      ;;
    *) return 1 ;;
  esac
}

model_router_assert_profile_compatible() {
  local profile="$1" provider
  [ "$profile" = "legacy" ] && return 0
  while IFS= read -r provider; do
    [ -n "$provider" ] || continue
    model_router_provider_compatible "$provider" || {
      printf 'runtime profile %s requires a compatible, logged-in %s CLI\n' \
        "$profile" "$provider" >&2
      return 2
    }
  done < <(
    jq -r --arg profile "$profile" \
      '.profiles[$profile].requiredProviders[]' "$MODEL_ROUTER_CONFIG"
  )

  local available_models configured_model
  available_models="$(
    env -u XAI_API_KEY -u GROK_API_KEY timeout 15 grok models 2>/dev/null
  )" || {
    printf 'runtime profile %s requires an authenticated Grok Build session\n' \
      "$profile" >&2
    return 2
  }
  while IFS= read -r configured_model; do
    [ -n "$configured_model" ] || continue
    awk -v model="$configured_model" \
      '$1 == "*" && $2 == model { found = 1 } END { exit !found }' \
      <<<"$available_models" || {
      printf 'runtime profile %s requires unavailable Grok model %s\n' \
        "$profile" "$configured_model" >&2
      return 2
    }
  done < <(
    jq -r --arg profile "$profile" '
      [.profiles[$profile].writer, .profiles[$profile].translator,
       .profiles[$profile].commentary, .profiles[$profile].vibeScorer]
      | map(select(.provider == "grok") | .model)
      | unique[]
    ' "$MODEL_ROUTER_CONFIG"
  )
}

model_router_role_key() {
  case "$1" in
    writer|tribunal-writer|refiner) printf 'writer\n' ;;
    translator|source-translator) printf 'translator\n' ;;
    sourceReviewer|source-reviewer) printf 'sourceReviewer\n' ;;
    corrector|bounded-corrector) printf 'corrector\n' ;;
    commentary|commentary-writer) printf 'commentary\n' ;;
    vibe|vibeScorer|vibe-opus-scorer) printf 'vibeScorer\n' ;;
    reviewer|evaluator|librarian|fact-checker|fresh-eyes) printf 'reviewer\n' ;;
    *) return 1 ;;
  esac
}

model_router_validate_remaining() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 1
  awk -v value="$value" '
    BEGIN {
      if (value < 0 || value > 100) exit 1
      printf "%.10g\n", value
    }
  '
}

model_router_usage_monitor_remaining() {
  local monitor="${USAGE_MONITOR:-}"
  [ -n "$monitor" ] && [ -x "$monitor" ] || return 1
  local payload remaining
  payload="$(timeout 15 "$monitor" --json 2>/dev/null)" || return 1
  remaining="$(jq -er '
    [ .[]
      | select(.provider == "openai" and .status == "ok")
      | [.session_remaining_pct, .weekly_remaining_pct][]
      | select(type == "number") ]
    | if length > 0 then min else empty end
  ' <<<"$payload" 2>/dev/null)" || return 1
  model_router_validate_remaining "$remaining"
}

model_router_codexbar_remaining() {
  command -v codexbar >/dev/null 2>&1 || return 1
  local payload remaining
  payload="$(
    timeout 15 codexbar usage --provider codex --source cli \
      --format json --no-color 2>/dev/null
  )" || return 1
  remaining="$(jq -er '
    [ .[]
      | select(.provider == "codex" and (.error? // null) == null)
      | .usage
      | [.primary, .secondary, .tertiary][]
      | select(type == "object" and (.usedPercent | type) == "number")
      | (100 - .usedPercent) ]
    | if length > 0 then min else empty end
  ' <<<"$payload" 2>/dev/null)" || return 1
  model_router_validate_remaining "$remaining"
}

model_router_reviewer_remaining() {
  if [ -n "${TRIBUNAL_REVIEWER_REMAINING_PCT:-}" ]; then
    model_router_validate_remaining "$TRIBUNAL_REVIEWER_REMAINING_PCT"
    return
  fi
  model_router_usage_monitor_remaining && return 0
  model_router_codexbar_remaining && return 0
  return 1
}

model_router_grok_remaining() {
  if [ -n "${TRIBUNAL_GROK_REMAINING_PCT:-}" ]; then
    model_router_validate_remaining "$TRIBUNAL_GROK_REMAINING_PCT"
    return
  fi
  local enabled
  enabled="$(jq -r '.profiles["vm-codex"].grokQuota.enabled // false' \
    "$MODEL_ROUTER_CONFIG")"
  [ "$enabled" = "true" ] || return 1
  command -v codexbar >/dev/null 2>&1 || return 1
  local payload remaining
  payload="$(
    timeout 15 codexbar usage --provider grok --source auto \
      --format json --no-color 2>/dev/null
  )" || return 1
  remaining="$(jq -er '
    [ .[]
      | select(.provider == "grok" and (.error? // null) == null)
      | .usage
      | [.primary, .secondary, .tertiary][]
      | select(type == "object" and (.usedPercent | type) == "number")
      | (100 - .usedPercent) ]
    | if length > 0 then min else empty end
  ' <<<"$payload" 2>/dev/null)" || return 1
  model_router_validate_remaining "$remaining"
}

model_router_resolve() {
  local requested_role="$1" role profile
  role="$(model_router_role_key "$requested_role")" || {
    printf 'unknown model role: %s\n' "$requested_role" >&2
    return 2
  }
  profile="$(model_router_profile)" || return
  if [ "$profile" = "legacy" ]; then
    MODEL_ROUTER_PROFILE=legacy
    MODEL_ROUTER_ROLE="$role"
    MODEL_ROUTER_PROVIDER=""
    MODEL_ROUTER_MODEL=""
    MODEL_ROUTER_REASONING=""
    MODEL_ROUTER_TIER=legacy
    MODEL_ROUTER_REMAINING=unknown
    MODEL_ROUTER_QUOTA_ACTION=run
    return 0
  fi

  [ -r "$MODEL_ROUTER_CONFIG" ] || {
    printf 'model config not found: %s\n' "$MODEL_ROUTER_CONFIG" >&2
    return 2
  }
  model_router_assert_profile_compatible "$profile" || return
  MODEL_ROUTER_QUOTA_ACTION=run

  local provider model effort tier remaining threshold unknown_policy value
  provider="$(jq -er --arg role "$role" \
    '.profiles["vm-codex"][$role].provider' "$MODEL_ROUTER_CONFIG")"
  tier=fixed
  remaining=unknown
  if [ "$role" = reviewer ]; then
    threshold="$(jq -er '.profiles["vm-codex"].reviewer.lowQuotaThresholdRemainingPercent' \
      "$MODEL_ROUTER_CONFIG")"
    unknown_policy="$(jq -er '.profiles["vm-codex"].reviewer.quotaUnknownPolicy' \
      "$MODEL_ROUTER_CONFIG")"
    if value="$(model_router_reviewer_remaining)"; then
      remaining="$value"
      if awk -v remaining="$remaining" -v threshold="$threshold" \
        'BEGIN { exit !(remaining < threshold) }'; then
        tier=lowQuota
      else
        tier=primary
      fi
    else
      tier="$unknown_policy"
    fi
    model="$(jq -er --arg tier "$tier" \
      '.profiles["vm-codex"].reviewer[$tier].model' "$MODEL_ROUTER_CONFIG")"
    effort="$(jq -er --arg tier "$tier" \
      '.profiles["vm-codex"].reviewer[$tier].reasoningEffort' "$MODEL_ROUTER_CONFIG")"
  else
    model="$(jq -er --arg role "$role" \
      '.profiles["vm-codex"][$role].model' "$MODEL_ROUTER_CONFIG")"
    effort="$(jq -er --arg role "$role" \
      '.profiles["vm-codex"][$role].reasoningEffort' "$MODEL_ROUTER_CONFIG")"
    tier=normal
    if [ "$provider" = grok ] && value="$(model_router_grok_remaining)"; then
      remaining="$value"
      if [ "$role" = writer ] || [ "$role" = translator ] || [ "$role" = commentary ]; then
        threshold="$(jq -er '.profiles["vm-codex"].grokQuota.pauseWriterBelowRemainingPercent' \
          "$MODEL_ROUTER_CONFIG")"
        if awk -v remaining="$remaining" -v threshold="$threshold" \
          'BEGIN { exit !(remaining < threshold) }'; then
          tier=criticalQuota
          MODEL_ROUTER_QUOTA_ACTION=pause
        else
          threshold="$(jq -er '.profiles["vm-codex"].grokQuota.reserveWriterBelowRemainingPercent' \
            "$MODEL_ROUTER_CONFIG")"
          if awk -v remaining="$remaining" -v threshold="$threshold" \
            'BEGIN { exit !(remaining < threshold) }'; then
            tier=lowQuota
            MODEL_ROUTER_QUOTA_ACTION=reserve
          fi
        fi
      else
        threshold="$(jq -er '.profiles["vm-codex"].grokQuota.deferVibeBelowRemainingPercent' \
          "$MODEL_ROUTER_CONFIG")"
        if awk -v remaining="$remaining" -v threshold="$threshold" \
          'BEGIN { exit !(remaining < threshold) }'; then
          tier=lowQuota
          MODEL_ROUTER_QUOTA_ACTION=defer
        fi
      fi
    fi
  fi

  MODEL_ROUTER_PROFILE="$profile"
  MODEL_ROUTER_ROLE="$role"
  MODEL_ROUTER_PROVIDER="$provider"
  MODEL_ROUTER_MODEL="$model"
  MODEL_ROUTER_REASONING="$effort"
  MODEL_ROUTER_TIER="$tier"
  MODEL_ROUTER_REMAINING="$remaining"
  MODEL_ROUTER_QUOTA_ACTION="${MODEL_ROUTER_QUOTA_ACTION:-run}"
}

model_router_print_json() {
  jq -nc \
    --arg runtimeProfile "$MODEL_ROUTER_PROFILE" \
    --arg role "$MODEL_ROUTER_ROLE" \
    --arg provider "$MODEL_ROUTER_PROVIDER" \
    --arg model "$MODEL_ROUTER_MODEL" \
    --arg reasoningEffort "$MODEL_ROUTER_REASONING" \
    --arg quotaTier "$MODEL_ROUTER_TIER" \
    --arg remainingPercent "$MODEL_ROUTER_REMAINING" \
    --arg quotaAction "$MODEL_ROUTER_QUOTA_ACTION" \
    '{runtimeProfile: $runtimeProfile, role: $role, provider: $provider,
      model: $model, reasoningEffort: $reasoningEffort,
      quotaTier: $quotaTier, remainingPercent: $remainingPercent,
      quotaAction: $quotaAction}'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  role="${1:-}"
  format="${2:---text}"
  [ -n "$role" ] || {
    printf 'Usage: %s <reviewer|writer|translator|sourceReviewer|corrector|commentary|vibeScorer> [--json]\n' "$0" >&2
    exit 2
  }
  model_router_resolve "$role"
  if [ "$format" = --json ]; then
    model_router_print_json
  else
    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
      "$MODEL_ROUTER_PROFILE" "$MODEL_ROUTER_ROLE" "$MODEL_ROUTER_PROVIDER" \
      "$MODEL_ROUTER_MODEL" "$MODEL_ROUTER_REASONING" \
      "$MODEL_ROUTER_TIER" "$MODEL_ROUTER_REMAINING" \
      "$MODEL_ROUTER_QUOTA_ACTION"
  fi
fi
