#!/usr/bin/env bash
# Regression coverage for check-links.mjs's process-level error handlers:
# the exact known undici stray-socket race must be tolerated (script keeps
# going), and ANY other uncaught exception or unhandled rejection must fail
# closed (non-zero exit, no "it finished fine" marker) — not get silently
# swallowed like the known race is.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT_DIR/scripts/tests/fixtures/trigger-link-check-async-error.mjs"

run_case() {
  local shape="$1" via="$2"
  node "$FIXTURE" "$shape" "$via"
}

assert_tolerated() {
  local shape="$1" via="$2" out exit_code
  set +e
  out="$(run_case "$shape" "$via" 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -ne 0 ]; then
    echo "FAIL ($shape/$via): expected exit 0 (tolerated), got $exit_code. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -q "FIXTURE_SURVIVED"; then
    echo "FAIL ($shape/$via): expected the process to survive and reach the marker. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -qi "known undici stray socket race"; then
    echo "FAIL ($shape/$via): expected the tolerated-race log message. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "case ($shape/$via) tolerated as expected"
}

assert_fails_closed() {
  local shape="$1" via="$2" out exit_code
  set +e
  out="$(run_case "$shape" "$via" 2>&1)"
  exit_code=$?
  set -e
  if [ "$exit_code" -eq 0 ]; then
    echo "FAIL ($shape/$via): unknown error must NOT exit 0. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  if [ "$exit_code" -ne 3 ]; then
    echo "FAIL ($shape/$via): expected exit code 3 (fail-closed convention), got $exit_code. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  if echo "$out" | grep -q "FIXTURE_SURVIVED"; then
    echo "FAIL ($shape/$via): unknown error must not let the process reach the survived marker. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -qi "FATAL"; then
    echo "FAIL ($shape/$via): expected a FATAL log line. Output:" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "case ($shape/$via) failed closed as expected"
}

# Known undici stray-socket race — tolerated, both delivery mechanisms.
assert_tolerated known exception
assert_tolerated known rejection

# Anything else — must fail closed, both delivery mechanisms.
assert_fails_closed unknown exception
assert_fails_closed unknown rejection

echo "check-links.mjs error-handling regression tests passed"
