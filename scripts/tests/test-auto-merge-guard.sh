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
  "headRefName": "content/gp-test",
  "headRefOid": "1111111111111111111111111111111111111111",
  "changedFiles": 0
}
JSON
  cp "$TMP_DIR/pr.json" "$TMP_DIR/recheck-pr.json"
  cat >"$TMP_DIR/checks.json" <<'JSON'
[
  {"name": "ci-passed", "state": "PASS", "bucket": "pass"}
]
JSON
}

run_guard() {
  local count
  if [ "${KEEP_CHANGED_FILES_COUNT:-0}" != "1" ]; then
    count="$(jq 'length' "$TMP_DIR/files.json")"
    jq --argjson count "$count" '.changedFiles = $count' \
      "$TMP_DIR/pr.json" >"$TMP_DIR/pr-with-count.json"
    mv "$TMP_DIR/pr-with-count.json" "$TMP_DIR/pr.json"
  fi
  scripts/gu-log-auto-merge-guard.sh \
    --dry-run \
    --pr 123 \
    --pr-json-file "$TMP_DIR/pr.json" \
    --recheck-pr-json-file "$TMP_DIR/recheck-pr.json" \
    --checks-json-file "$TMP_DIR/checks.json" \
    --files-json-file "$TMP_DIR/files.json" \
    --audit-log "$TMP_DIR/decisions.jsonl"
}

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {"filename":"src/content/posts/gp-test.mdx","status":"modified"},
  {"filename":"src/content/posts/en-gp-test.mdx","status":"modified"},
  {"filename":"src/data/post-versions.json","status":"modified"},
  {"filename":"src/data/post-reader-revisions.json","status":"modified"},
  {"filename":"src/data/glossary.json","status":"modified"}
]
JSON
run_guard >"$TMP_DIR/allow.out"
grep -q "ALLOW" "$TMP_DIR/allow.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {"filename":"src/data/post-versions.json","status":"modified"},
  {"filename":"src/data/post-reader-revisions.json","status":"modified"}
]
JSON
if run_guard >"$TMP_DIR/manifest-only-deny.out" 2>&1; then
  echo "expected manifest-only PR to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/data/post-versions.json" "$TMP_DIR/manifest-only-deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {"filename":"src/content/posts/gp-test.mdx","status":"modified"},
  {"filename":"src/data/unrelated.json","status":"modified"}
]
JSON
if run_guard >"$TMP_DIR/unrelated-data-deny.out" 2>&1; then
  echo "expected unrelated src/data path to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/data/unrelated.json" "$TMP_DIR/unrelated-data-deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[{"filename":".github/workflows/ci.yml","status":"modified"}]
JSON
if run_guard >"$TMP_DIR/deny.out" 2>&1; then
  echo "expected denied .github path to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:.github/workflows/ci.yml" "$TMP_DIR/deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[{"filename":"pnpm-lock.yaml","status":"modified"}]
JSON
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
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {"filename":"src/content/posts/gp-test.mdx","status":"modified"},
  {"filename":"src/data/post-versions.json","status":"modified"}
]
JSON
if run_guard >"$TMP_DIR/ci-deny.out" 2>&1; then
  echo "expected failing required check to fail" >&2
  exit 1
fi
grep -q "DENY: required-checks-not-green" "$TMP_DIR/ci-deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {
    "filename":"src/content/posts/gp-test.mdx",
    "status":"renamed",
    "previous_filename":".github/workflows/ci.yml"
  }
]
JSON
if run_guard >"$TMP_DIR/rename-from-denied.out" 2>&1; then
  echo "expected denied-to-allowed rename to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:.github/workflows/ci.yml" "$TMP_DIR/rename-from-denied.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[
  {
    "filename":".github/workflows/ci.yml",
    "status":"renamed",
    "previous_filename":"src/content/posts/gp-test.mdx"
  }
]
JSON
if run_guard >"$TMP_DIR/rename-to-denied.out" 2>&1; then
  echo "expected allowed-to-denied rename to fail" >&2
  exit 1
fi
grep -q "DENY: denied-path:.github/workflows/ci.yml" "$TMP_DIR/rename-to-denied.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[{"filename":"src/content/posts/nested/gp-test.mdx","status":"added"}]
JSON
if run_guard >"$TMP_DIR/nested-post-deny.out" 2>&1; then
  echo "expected nested post path to fail" >&2
  exit 1
fi
grep -q "DENY: not-allowlisted:src/content/posts/nested/gp-test.mdx" "$TMP_DIR/nested-post-deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[{"filename":"src/content/posts/gp-test.mdx","status":"modified"}]
JSON
jq '.changedFiles = 2' "$TMP_DIR/pr.json" >"$TMP_DIR/pr-incomplete.json"
mv "$TMP_DIR/pr-incomplete.json" "$TMP_DIR/pr.json"
if KEEP_CHANGED_FILES_COUNT=1 run_guard >"$TMP_DIR/incomplete-files-deny.out" 2>&1; then
  echo "expected incomplete PR files list to fail" >&2
  exit 1
fi
grep -q "DENY: incomplete-files-list:2:1" "$TMP_DIR/incomplete-files-deny.out"

write_common_json
cat >"$TMP_DIR/files.json" <<'JSON'
[{"filename":"src/content/posts/gp-test.mdx","status":"modified"}]
JSON
jq '.headRefOid = "2222222222222222222222222222222222222222"' \
  "$TMP_DIR/recheck-pr.json" >"$TMP_DIR/recheck-pr-new-head.json"
mv "$TMP_DIR/recheck-pr-new-head.json" "$TMP_DIR/recheck-pr.json"
if run_guard >"$TMP_DIR/head-changed-deny.out" 2>&1; then
  echo "expected changed PR head to fail" >&2
  exit 1
fi
grep -q "DENY: head-changed:1111111111111111111111111111111111111111:2222222222222222222222222222222222222222" "$TMP_DIR/head-changed-deny.out"

grep -q -- '--match-head-commit' scripts/gu-log-auto-merge-guard.sh
if grep -q -- '--auto' scripts/gu-log-auto-merge-guard.sh; then
  echo "guard must not leave auto-merge enabled across future heads" >&2
  exit 1
fi

jq -e 'select(.decision == "allow")' "$TMP_DIR/decisions.jsonl" >/dev/null
jq -e 'select(.decision == "deny")' "$TMP_DIR/decisions.jsonl" >/dev/null

echo "auto-merge guard smoke tests passed"
