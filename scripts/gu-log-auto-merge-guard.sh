#!/usr/bin/env bash
# gu-log-auto-merge-guard.sh — conservative PR auto-merge gate.
#
# This script is intentionally boring: inspect PR state, required checks, and
# changed paths; only then merge the exact verified head. It does not bypass
# branch protection and it denies sensitive paths by default.

set -euo pipefail

REPO="${GU_LOG_GITHUB_REPO:-chitienhsiehwork-ai/gu-log}"
PR_NUMBER=""
DRY_RUN=0
ALLOW_LOW_RISK_CODE=0
PR_JSON_FILE=""
RECHECK_PR_JSON_FILE=""
CHECKS_JSON_FILE=""
FILES_JSON_FILE=""
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
  --recheck-pr-json-file <path> Test hook: read final gh pr view JSON from file
  --checks-json-file <path>     Test hook: read gh pr checks JSON from file
  --files-json-file <path>      Test hook: read structured PR files JSON from file
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
    --recheck-pr-json-file)
      RECHECK_PR_JSON_FILE="${2:-}"
      shift 2
      ;;
    --checks-json-file)
      CHECKS_JSON_FILE="${2:-}"
      shift 2
      ;;
    --files-json-file)
      FILES_JSON_FILE="${2:-}"
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
  PR_JSON="$("$GH_BIN" pr view "$PR_NUMBER" --repo "$REPO" --json number,state,isDraft,mergeable,baseRefName,headRefName,headRefOid,changedFiles)"
fi

if [ -n "$CHECKS_JSON_FILE" ]; then
  CHECKS_JSON="$(cat "$CHECKS_JSON_FILE")"
else
  CHECKS_JSON="$("$GH_BIN" pr checks "$PR_NUMBER" --repo "$REPO" --required --json name,state,bucket 2>/dev/null || printf '[]')"
fi

if [ -n "$FILES_JSON_FILE" ]; then
  FILES_JSON="$(cat "$FILES_JSON_FILE")"
else
  FILES_JSON="$("$GH_BIN" api --paginate --slurp "repos/$REPO/pulls/$PR_NUMBER/files?per_page=100")"
  FILES_JSON="$(jq -c 'add | map({filename, status, previous_filename})' <<<"$FILES_JSON")"
fi

if ! jq -e '
  type == "array"
  and all(.[ ];
    (.filename | type) == "string"
    and (.filename | length) > 0
    and (.status | type) == "string"
    and (if .status == "renamed"
      then ((.previous_filename | type) == "string" and (.previous_filename | length) > 0)
      else true
    end)
  )
' <<<"$FILES_JSON" >/dev/null; then
  die "invalid PR files JSON"
fi

CURRENT_PATHS_JSON="$(jq -c '[.[] | .filename]' <<<"$FILES_JSON")"
POLICY_PATHS_JSON="$(jq -c '[.[] | .filename, (if .status == "renamed" then .previous_filename else empty end)]' <<<"$FILES_JSON")"
expected_changed_files="$(jq -r '.changedFiles // ""' <<<"$PR_JSON")"
actual_changed_files="$(jq 'length' <<<"$FILES_JSON")"
files_input_deny_reason=""
if ! [[ "$expected_changed_files" =~ ^[0-9]+$ ]]; then
  files_input_deny_reason="invalid-changed-files-count"
elif [ "$actual_changed_files" -ne "$expected_changed_files" ]; then
  files_input_deny_reason="incomplete-files-list:$expected_changed_files:$actual_changed_files"
fi

is_flat_post_path() {
  local path="$1" relative
  case "$path" in
    src/content/posts/*.mdx)
      relative="${path#src/content/posts/}"
      case "$relative" in
        ""|*/*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

HAS_POST_CHANGE=0
while IFS= read -r -d '' path; do
  if is_flat_post_path "$path"; then
    HAS_POST_CHANGE=1
    break
  fi
done < <(jq -j '.[] | ., "\u0000"' <<<"$CURRENT_PATHS_JSON")

deny_reason="$files_input_deny_reason"

state="$(jq -r '.state // ""' <<<"$PR_JSON")"
is_draft="$(jq -r '.isDraft // false' <<<"$PR_JSON")"
mergeable="$(jq -r '.mergeable // ""' <<<"$PR_JSON")"
base_ref="$(jq -r '.baseRefName // ""' <<<"$PR_JSON")"
head_oid="$(jq -r '.headRefOid // ""' <<<"$PR_JSON")"

if [ "$state" != "OPEN" ]; then
  deny_reason="pr-state-not-open:$state"
elif [ "$is_draft" = "true" ]; then
  deny_reason="draft-pr"
elif [ "$base_ref" != "main" ]; then
  deny_reason="base-is-not-main:$base_ref"
elif [ "$mergeable" != "MERGEABLE" ]; then
  deny_reason="not-mergeable:$mergeable"
elif ! [[ "$head_oid" =~ ^[0-9a-f]{40}$ ]]; then
  deny_reason="invalid-head-oid"
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
  if is_flat_post_path "$path"; then
    return 0
  fi
  case "$path" in
    src/data/glossary.json|src/config/glossary.ts)
      return 0
      ;;
    src/data/post-versions.json|src/data/post-reader-revisions.json)
      [ "$HAS_POST_CHANGE" -eq 1 ] && return 0
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
  if [ "$(jq 'length' <<<"$FILES_JSON")" -eq 0 ]; then
    deny_reason="no-changed-files"
  else
    while IFS= read -r -d '' path; do
      if is_denied_path "$path"; then
        deny_reason="denied-path:$path"
        break
      fi
      if ! is_allowed_path "$path"; then
        deny_reason="not-allowlisted:$path"
        break
      fi
    done < <(jq -j '.[] | ., "\u0000"' <<<"$POLICY_PATHS_JSON")
  fi
fi

if [ -z "$deny_reason" ]; then
  if [ -n "$RECHECK_PR_JSON_FILE" ]; then
    RECHECK_PR_JSON="$(cat "$RECHECK_PR_JSON_FILE")"
  elif [ -n "$PR_JSON_FILE" ]; then
    RECHECK_PR_JSON="$PR_JSON"
  else
    RECHECK_PR_JSON="$("$GH_BIN" pr view "$PR_NUMBER" --repo "$REPO" --json state,headRefOid)"
  fi
  recheck_state="$(jq -r '.state // ""' <<<"$RECHECK_PR_JSON")"
  recheck_head_oid="$(jq -r '.headRefOid // ""' <<<"$RECHECK_PR_JSON")"
  if [ "$recheck_state" != "OPEN" ]; then
    deny_reason="pr-state-changed:$recheck_state"
  elif [ "$recheck_head_oid" != "$head_oid" ]; then
    deny_reason="head-changed:$head_oid:$recheck_head_oid"
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
  --arg headOid "$head_oid" \
  --argjson paths "$POLICY_PATHS_JSON" \
  --argjson files "$FILES_JSON" \
  --arg checks "$CHECKS_JSON" \
  '{
    timestamp: $ts,
    repo: $repo,
    pr: ($pr | tonumber),
    decision: $decision,
    reason: $reason,
    dryRun: ($dryRun == "1"),
    headOid: $headOid,
    paths: $paths,
    files: $files,
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

exec "$GH_BIN" pr merge "$PR_NUMBER" --repo "$REPO" --squash --delete-branch --match-head-commit "$head_oid"
