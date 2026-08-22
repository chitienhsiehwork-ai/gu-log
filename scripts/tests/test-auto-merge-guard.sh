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
  "headRefName": "content/gp-test"
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
src/content/posts/gp-test.mdx
src/data/glossary.json
EOF_FILES
run_guard >"$TMP_DIR/allow.out"
grep -q "ALLOW" "$TMP_DIR/allow.out"

write_common_json
jq '.headRefName = "publisher/tribunal-batch-test"' "$TMP_DIR/pr.json" >"$TMP_DIR/pr.next.json"
mv "$TMP_DIR/pr.next.json" "$TMP_DIR/pr.json"
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/gp-test.mdx
src/data/post-versions.json
EOF_FILES
run_guard >"$TMP_DIR/publisher-manifest-allow.out"
grep -q "ALLOW" "$TMP_DIR/publisher-manifest-allow.out"

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/gp-test.mdx
src/data/post-versions.json
EOF_FILES
if run_guard >"$TMP_DIR/content-manifest-deny.out" 2>&1; then
  echo "expected non-publisher manifest path to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/data/post-versions.json" "$TMP_DIR/content-manifest-deny.out"

write_common_json
jq '.headRefName = "publisher/tribunal-batch-test"' "$TMP_DIR/pr.json" >"$TMP_DIR/pr.next.json"
mv "$TMP_DIR/pr.next.json" "$TMP_DIR/pr.json"
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/data/post-versions.json
EOF_FILES
if run_guard >"$TMP_DIR/manifest-only-deny.out" 2>&1; then
  echo "expected publisher manifest without a post change to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/data/post-versions.json" "$TMP_DIR/manifest-only-deny.out"

write_common_json
jq '.headRefName = "publisher/tribunal-batch-test"' "$TMP_DIR/pr.json" >"$TMP_DIR/pr.next.json"
mv "$TMP_DIR/pr.next.json" "$TMP_DIR/pr.json"
cat >"$TMP_DIR/checks.json" <<'JSON'
[
  {"name": "Vercel", "state": "PASS", "bucket": "pass"}
]
JSON
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/gp-test.mdx
src/data/post-versions.json
EOF_FILES
if run_guard >"$TMP_DIR/publisher-manifest-ci-deny.out" 2>&1; then
  echo "expected publisher manifest without ci-passed to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/data/post-versions.json" "$TMP_DIR/publisher-manifest-ci-deny.out"

write_common_json
jq '.headRefName = "publisher/tribunal-batch-test"' "$TMP_DIR/pr.json" >"$TMP_DIR/pr.next.json"
mv "$TMP_DIR/pr.next.json" "$TMP_DIR/pr.json"
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/gp-test.mdx
src/data/post-versions.json
pnpm-lock.yaml
EOF_FILES
if run_guard >"$TMP_DIR/publisher-sensitive-deny.out" 2>&1; then
  echo "expected publisher manifest batch with a sensitive path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:pnpm-lock.yaml" "$TMP_DIR/publisher-sensitive-deny.out"

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
.github/workflows/ci.yml
EOF_FILES
if run_guard >"$TMP_DIR/github-deny.out" 2>&1; then
  echo "expected denied .github path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:.github/workflows/ci.yml" "$TMP_DIR/github-deny.out"

write_common_json
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
pnpm-lock.yaml
EOF_FILES
if run_guard >"$TMP_DIR/lock-deny.out" 2>&1; then
  echo "expected lockfile path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:pnpm-lock.yaml" "$TMP_DIR/lock-deny.out"

write_common_json
cat >"$TMP_DIR/checks.json" <<'JSON'
[
  {"name": "ci-passed", "state": "FAIL", "bucket": "fail"}
]
JSON
cat >"$TMP_DIR/files.txt" <<'EOF_FILES'
src/content/posts/gp-test.mdx
EOF_FILES
if run_guard >"$TMP_DIR/ci-deny.out" 2>&1; then
  echo "expected failing required check to fail" >&2
  exit 1
fi
grep -q "DENY: required-checks-not-green" "$TMP_DIR/ci-deny.out"

jq -e 'select(.decision == "allow")' "$TMP_DIR/decisions.jsonl" >/dev/null
jq -e 'select(.decision == "deny")' "$TMP_DIR/decisions.jsonl" >/dev/null

echo "auto-merge guard smoke tests passed"
