#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

write_common_json() {
  cat >"$TMP_DIR/pr.json" <<'JSON'
{
  "number": 123,
  "state": "OPEN",
  "isDraft": false,
  "mergeable": "MERGEABLE",
  "baseRefName": "main",
  "headRefName": "content/sp-test"
}
JSON
  cat >"$TMP_DIR/checks.json" <<'JSON'
[
  {"name": "ci-passed", "state": "PASS", "bucket": "pass"}
]
JSON
}

run_guard() {
  scripts/gu-log-auto-merge-guard.sh \
    --dry-run \
    --pr 123 \
    --pr-json-file "$TMP_DIR/pr.json" \
    --checks-json-file "$TMP_DIR/checks.json" \
    --changed-files-file "$TMP_DIR/files.txt" \
    --audit-log "$TMP_DIR/decisions.jsonl"
}

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/sp-test.mdx
src/data/glossary.json
EOF_FILES
run_guard >/tmp/gu-log-auto-merge-allow.out
grep -q "ALLOW" /tmp/gu-log-auto-merge-allow.out

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
.github/workflows/ci.yml
EOF_FILES
if run_guard >/tmp/gu-log-auto-merge-deny.out 2>&1; then
  echo "expected denied .github path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:.github/workflows/ci.yml" /tmp/gu-log-auto-merge-deny.out

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
pnpm-lock.yaml
EOF_FILES
if run_guard >/tmp/gu-log-auto-merge-lock-deny.out 2>&1; then
  echo "expected lockfile path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:pnpm-lock.yaml" /tmp/gu-log-auto-merge-lock-deny.out

write_common_json
cat >"$TMP_DIR/checks.json" <<'JSON'
[
  {"name": "ci-passed", "state": "FAIL", "bucket": "fail"}
]
JSON
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/sp-test.mdx
EOF_FILES
if run_guard >/tmp/gu-log-auto-merge-ci-deny.out 2>&1; then
  echo "expected failing required check to fail" >&2
  exit 1
fi
grep -q "DENY: required-checks-not-green" /tmp/gu-log-auto-merge-ci-deny.out

jq -e 'select(.decision == "allow")' "$TMP_DIR/decisions.jsonl" >/dev/null
jq -e 'select(.decision == "deny")' "$TMP_DIR/decisions.jsonl" >/dev/null

echo "auto-merge guard smoke tests passed"
