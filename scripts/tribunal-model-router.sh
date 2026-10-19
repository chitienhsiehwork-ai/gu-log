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
    claude)
      # Ask the CLI in the clean environment every VM Claude call gets, so only
      # its own `claude auth login` state counts (tribunal_claude_clean_env).
      command -v claude >/dev/null 2>&1 || return 1
      model_router_load_helpers || return 1
      tribunal_claude_clean_env || return 1
      "${TRIBUNAL_CLAUDE_CLEAN_ENV[@]}" timeout 15 claude auth status --json 2>/dev/null |
        jq -e '.loggedIn == true' >/dev/null 2>&1
      ;;
    *) return 1 ;;
  esac
}

# Mogu writes and rewrites gu-log articles only with the Claude model
# (openspec claude-prose-writing-runtime). These role keys produce or rewrite
# reader-visible article text. This is the single list of article-writing
# steps: model_router_resolve enforces "provider is claude <=> the step writes
# article text or aligns sources" and gp-pipeline relies on that instead of
# keeping a copy.
model_router_is_prose_role() {
  case "$1" in
    writer) return 0 ;;
    *) return 1 ;;
  esac
}

# The source-distance aligner only pairs sentences, but it is a Claude call too
# (openspec source-distance-stamp): its pin lives in
# .claude/agents/source-aligner.md. gp-pipeline (llm.AlignerPin) refuses a pin
# equal to the writer pin before any aligner call.
model_router_is_claude_role() {
  model_router_is_prose_role "$1" || [ "$1" = aligner ]
}

# Claude article-writing steps never declare a model in config: they use the
# owner-pinned model from .claude/agents/tribunal-writer.md, the same SSOT
# gp-pipeline's ClaudeOpusPinned mirrors. Reuse the helpers' strict
# frontmatter parser so there is exactly one implementation.
model_router_claude_writer_model() {
  model_router_load_helpers || return 2
  REPO_ROOT="${REPO_ROOT:-$MODEL_ROUTER_ROOT}" \
    tribunal_claude_agent_model tribunal-writer
}

# The aligner pin never falls back to another agent's pin: a missing or broken
# .claude/agents/source-aligner.md fails closed.
model_router_claude_aligner_model() {
  model_router_load_helpers || return 2
  tribunal_claude_frontmatter_model \
    "${REPO_ROOT:-$MODEL_ROUTER_ROOT}/.claude/agents/source-aligner.md"
}

# The Claude pin parser and the credential policy live in the helpers; load
# them on demand when the router runs standalone.
model_router_load_helpers() {
  declare -F tribunal_claude_agent_model >/dev/null 2>&1 && return 0
  # shellcheck source=scripts/tribunal-helpers.sh
  source "$MODEL_ROUTER_DIR/tribunal-helpers.sh"
}

model_router_role_key() {
  case "$1" in
    writer|tribunal-writer|refiner) printf 'writer\n' ;;
    aligner) printf 'aligner\n' ;;
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
    return 0
  fi

  [ -r "$MODEL_ROUTER_CONFIG" ] || {
    printf 'model config not found: %s\n' "$MODEL_ROUTER_CONFIG" >&2
    return 2
  }

  local provider model effort tier remaining threshold unknown_policy value
  provider="$(jq -er --arg role "$role" \
    '.profiles["vm-codex"][$role].provider' "$MODEL_ROUTER_CONFIG")" || {
    printf 'runtime profile %s does not route role %s\n' "$profile" "$role" >&2
    return 2
  }
  if model_router_is_prose_role "$role" && [ "$provider" != claude ]; then
    printf 'role %s writes gu-log article text and must use the Claude model (config routes it to %s)\n' \
      "$role" "$provider" >&2
    return 2
  elif [ "$role" = aligner ] && [ "$provider" != claude ]; then
    printf 'role %s aligns source-distance sentences and must use the Claude model (config routes it to %s)\n' \
      "$role" "$provider" >&2
    return 2
  elif ! model_router_is_claude_role "$role" && [ "$provider" = claude ]; then
    printf 'role %s only judges or reviews; on this profile only article-writing steps and the source aligner use the Claude model\n' \
      "$role" >&2
    return 2
  fi
  # Preflight only the provider this step routes to: resolving a Codex judge
  # never runs the Claude CLI, and a provider no step uses is never queried.
  model_router_provider_compatible "$provider" || {
    printf 'runtime profile %s requires a compatible, logged-in %s CLI for role %s\n' \
      "$profile" "$provider" "$role" >&2
    return 2
  }
  tier=fixed
  remaining=unknown
  if [ "$provider" = claude ]; then
    local pin_file=.claude/agents/tribunal-writer.md
    [ "$role" = aligner ] && pin_file=.claude/agents/source-aligner.md
    if jq -e --arg role "$role" \
      '.profiles["vm-codex"][$role] | has("model") or has("reasoningEffort")' \
      "$MODEL_ROUTER_CONFIG" >/dev/null; then
      printf 'role %s uses the Claude model pin from %s; remove model/reasoningEffort from %s\n' \
        "$role" "$pin_file" "$MODEL_ROUTER_CONFIG" >&2
      return 2
    fi
    if [ "$role" = aligner ]; then
      model="$(model_router_claude_aligner_model)"
    else
      model="$(model_router_claude_writer_model)"
    fi || {
      printf 'runtime profile %s requires a valid Claude model pin in %s\n' \
        "$profile" "$pin_file" >&2
      return 2
    }
    effort=""
    tier=normal
  elif [ "$role" = reviewer ]; then
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
  fi

  MODEL_ROUTER_PROFILE="$profile"
  MODEL_ROUTER_ROLE="$role"
  MODEL_ROUTER_PROVIDER="$provider"
  MODEL_ROUTER_MODEL="$model"
  MODEL_ROUTER_REASONING="$effort"
  MODEL_ROUTER_TIER="$tier"
  MODEL_ROUTER_REMAINING="$remaining"
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
    '{runtimeProfile: $runtimeProfile, role: $role, provider: $provider,
      model: $model, reasoningEffort: $reasoningEffort,
      quotaTier: $quotaTier, remainingPercent: $remainingPercent}'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  role="${1:-}"
  format="${2:---text}"
  [ -n "$role" ] || {
    printf 'Usage: %s <reviewer|writer|vibeScorer|aligner> [--json]\n' "$0" >&2
    exit 2
  }
  model_router_resolve "$role"
  if [ "$format" = --json ]; then
    model_router_print_json
  else
    printf '%s|%s|%s|%s|%s|%s|%s\n' \
      "$MODEL_ROUTER_PROFILE" "$MODEL_ROUTER_ROLE" "$MODEL_ROUTER_PROVIDER" \
      "$MODEL_ROUTER_MODEL" "$MODEL_ROUTER_REASONING" \
      "$MODEL_ROUTER_TIER" "$MODEL_ROUTER_REMAINING"
  fi
fi
