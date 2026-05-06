#!/usr/bin/env bash
# gu-log-auto-merge-guard.sh — conservative PR auto-merge gate.
#
# This script is intentionally boring: inspect PR state, required checks, and
# changed paths; only then call GitHub auto-merge. It does not bypass branch
# protection and it denies sensitive paths by default.

set -euo pipefail

REPO="${GU_LOG_GITHUB_REPO:-chitienhsiehwork-ai/gu-log}"
PR_NUMBER=""
DRY_RUN=0
ALLOW_LOW_RISK_CODE=0
PR_JSON_FILE=""
CHECKS_JSON_FILE=""
CHANGED_FILES_FILE=""
AUDIT_LOG="${GU_LOG_AUTO_MERGE_AUDIT_LOG:-.auto-merge-guard/decisions.jsonl}"
GH_BIN="${GH_BIN:-gh}"

usage() {
  cat <<'EOF'
Usage: scripts/gu-log-auto-merge-guard.sh --pr <number> [options]

Options:
  --repo <owner/name>           GitHub repository (default: chitienhsiehwork-ai/gu-log)
  --dry-run                     Evaluate only; do not call gh pr merge
  --allow-low-risk-code         Allow ordinary src/ code in addition to content/glossary lane
  --audit-log <path>            JSONL audit log path
  --pr-json-file <path>         Test hook: read gh pr view JSON from file
  --checks-json-file <path>     Test hook: read gh pr checks JSON from file
  --changed-files-file <path>   Test hook: read changed paths from file
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pr)
      PR_NUMBER="${2:-}"
      shift 2
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --allow-low-risk-code)
      ALLOW_LOW_RISK_CODE=1
      shift
      ;;
    --audit-log)
      AUDIT_LOG="${2:-}"
      shift 2
      ;;
    --pr-json-file)
      PR_JSON_FILE="${2:-}"
      shift 2
      ;;
    --checks-json-file)
      CHECKS_JSON_FILE="${2:-}"
      shift 2
      ;;
    --changed-files-file)
      CHANGED_FILES_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[ -n "$PR_NUMBER" ] || die "--pr is required"

if [ -n "$PR_JSON_FILE" ]; then
  PR_JSON="$(cat "$PR_JSON_FILE")"
else
  PR_JSON="$("$GH_BIN" pr view "$PR_NUMBER" --repo "$REPO" --json number,state,isDraft,mergeable,baseRefName,headRefName)"
fi

if [ -n "$CHECKS_JSON_FILE" ]; then
  CHECKS_JSON="$(cat "$CHECKS_JSON_FILE")"
else
  CHECKS_JSON="$("$GH_BIN" pr checks "$PR_NUMBER" --repo "$REPO" --required --json name,state,bucket 2>/dev/null || printf '[]')"
fi

if [ -n "$CHANGED_FILES_FILE" ]; then
  CHANGED_FILES="$(cat "$CHANGED_FILES_FILE")"
else
  CHANGED_FILES="$("$GH_BIN" pr diff "$PR_NUMBER" --repo "$REPO" --name-only)"
fi

deny_reason=""

state="$(jq -r '.state // ""' <<<"$PR_JSON")"
is_draft="$(jq -r '.isDraft // false' <<<"$PR_JSON")"
mergeable="$(jq -r '.mergeable // ""' <<<"$PR_JSON")"
base_ref="$(jq -r '.baseRefName // ""' <<<"$PR_JSON")"

if [ "$state" != "OPEN" ]; then
  deny_reason="pr-state-not-open:$state"
elif [ "$is_draft" = "true" ]; then
  deny_reason="draft-pr"
elif [ "$base_ref" != "main" ]; then
  deny_reason="base-is-not-main:$base_ref"
elif [ "$mergeable" != "MERGEABLE" ]; then
  deny_reason="not-mergeable:$mergeable"
fi

if [ -z "$deny_reason" ]; then
  check_count="$(jq 'length' <<<"$CHECKS_JSON")"
  if [ "$check_count" -eq 0 ]; then
    deny_reason="no-required-checks"
  elif ! jq -e 'all(.[]; ((.state // .conclusion // "") | ascii_downcase) as $s | ($s == "pass" or $s == "success"))' <<<"$CHECKS_JSON" >/dev/null; then
    deny_reason="required-checks-not-green"
  fi
fi

is_denied_path() {
  local path="$1"
  case "$path" in
    .github/*|.vercel/*|vercel.json|netlify.toml)
      return 0
      ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|package-lock.json|yarn.lock|bun.lock|bun.lockb)
      return 0
      ;;
    .env|.env.*|*.pem|*.key|*secret*|*Secret*|*token*|*Token*)
      return 0
      ;;
    scripts/gu-log-auto-merge-guard.sh|scripts/*guard*|scripts/*security*|scripts/*deploy*|scripts/*push*|scripts/*delete*|scripts/*github*|scripts/hooks/*|scripts/pre-commit)
      return 0
      ;;
  esac
  return 1
}

is_allowed_path() {
  local path="$1"
  case "$path" in
    src/content/posts/*.mdx|src/data/glossary.json|src/config/glossary.ts)
      return 0
      ;;
    src/pages/glossary.astro|src/styles/global.css)
      return 0
      ;;
  esac
  if [ "$ALLOW_LOW_RISK_CODE" -eq 1 ]; then
    case "$path" in
      src/components/*|src/layouts/*|src/pages/*|src/styles/*|tests/*)
        return 0
        ;;
    esac
  fi
  return 1
}

if [ -z "$deny_reason" ]; then
  if [ -z "$CHANGED_FILES" ]; then
    deny_reason="no-changed-files"
  else
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      if is_denied_path "$path"; then
        deny_reason="denied-path:$path"
        break
      fi
      if ! is_allowed_path "$path"; then
        deny_reason="not-allowlisted:$path"
        break
      fi
    done <<<"$CHANGED_FILES"
  fi
fi

decision="allow"
if [ -n "$deny_reason" ]; then
  decision="deny"
fi

mkdir -p "$(dirname "$AUDIT_LOG")"
jq -nc \
  --arg ts "$(TZ=Asia/Taipei date -Iseconds)" \
  --arg repo "$REPO" \
  --arg pr "$PR_NUMBER" \
  --arg decision "$decision" \
  --arg reason "${deny_reason:-green-path-guard-passed}" \
  --arg dryRun "$DRY_RUN" \
  --arg paths "$CHANGED_FILES" \
  --arg checks "$CHECKS_JSON" \
  '{
    timestamp: $ts,
    repo: $repo,
    pr: ($pr | tonumber),
    decision: $decision,
    reason: $reason,
    dryRun: ($dryRun == "1"),
    paths: ($paths | split("\n") | map(select(length > 0))),
    checks: ($checks | fromjson)
  }' >>"$AUDIT_LOG"

if [ "$decision" = "deny" ]; then
  echo "DENY: $deny_reason"
  exit 2
fi

echo "ALLOW: CI green + path guard passed for PR #$PR_NUMBER"
if [ "$DRY_RUN" -eq 1 ]; then
  exit 0
fi

exec "$GH_BIN" pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash --delete-branch
