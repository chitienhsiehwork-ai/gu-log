#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/gh" <<'EOF'
#!/bin/bash
scenario="${GH_SCENARIO:-plain-success}"
if [ -n "${GH_CALL_LOG:-}" ]; then
  printf '%s\n' "$*" >> "$GH_CALL_LOG"
fi
payload_for_command() {
  local source="$1"
  shift
  local arg
  for arg in "$@"; do
    case "$arg" in
      repos/*/pulls\?state=open\&per_page=100)
        return 0
        ;;
    esac
  done
  printf '{"source":"%s"}\n' "$source"
}
case "$scenario" in
  files-failure)
    for arg in "$@"; do
      case "$arg" in
        repos/*/pulls\?state=open\&per_page=100)
          printf '{"number":17,"title":"Editorial PR","headRefName":"editorial/test","labels":[]}\n'
          exit 0
          ;;
      esac
    done
    echo "files request unavailable" >&2
    exit 1
    ;;
  plain-success)
    if [ -n "${GH_TOKEN:-}" ]; then
      echo "HTTP 401: Bad credentials" >&2
      exit 1
    fi
    payload_for_command plain "$@"
    ;;
  token-success)
    if [ -n "${GH_TOKEN:-}" ]; then
      payload_for_command token "$@"
      exit 0
    fi
    echo "Resource not accessible by personal access token" >&2
    exit 1
    ;;
  *)
    echo "unknown scenario: $scenario" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$TMPDIR/gh"
printf 'bad-token\n' > "$TMPDIR/token.txt"

extract_publisher_gh() {
  python3 - "$1" <<'PY'
import sys
path = sys.argv[1]
capture = False
depth = 0
with open(path, 'r', encoding='utf-8') as fh:
    for line in fh:
        if not capture and line.startswith('publisher_gh() {'):
            capture = True
        if capture:
            sys.stdout.write(line)
            depth += line.count('{')
            depth -= line.count('}')
            if depth == 0:
                break
PY
}

run_case() {
  local script="$1" scenario="$2" expected="$3"
  unset -f publisher_gh || true
  eval "$(extract_publisher_gh "$script")"
  local output
  output="$(GH_BIN="$TMPDIR/gh" GU_LOG_GH_TOKEN_FILE="$TMPDIR/token.txt" GH_SCENARIO="$scenario" publisher_gh api /rate_limit)"
  [ "$output" = "$expected" ] || {
    echo "expected $expected from $script scenario=$scenario, got: $output" >&2
    exit 1
  }
}

run_preflight_case() {
  local scenario="$1"
  local case_dir="$TMPDIR/preflight-$scenario"
  mkdir -p "$case_dir"
  printf '{}\n' > "$case_dir/progress.json"
  local output
  output="$(
    GH_BIN="$TMPDIR/gh" \
    GU_LOG_GH_TOKEN_FILE="$TMPDIR/token.txt" \
    GH_SCENARIO="$scenario" \
    PROGRESS_FILE="$case_dir/progress.json" \
    PUBLISHER_STATE_FILE="$case_dir/publisher.json" \
    TRIAGE_EVENTS_FILE="$case_dir/triage.json" \
    bash "$ROOT_DIR/scripts/tribunal-publisher.sh" --status
  )"
  grep -q 'publishable PASS: 0' <<<"$output" || {
    echo "expected successful live GitHub preflight for scenario=$scenario" >&2
    exit 1
  }
}

run_failed_snapshot_case() {
  local case_dir="$TMPDIR/files-failure"
  mkdir -p "$case_dir"
  printf '{}\n' > "$case_dir/progress.json"
  if output="$(
    GH_BIN="$TMPDIR/gh" \
    GH_CALL_LOG="$case_dir/gh.log" \
    GU_LOG_GH_TOKEN_FILE="$TMPDIR/token.txt" \
    GH_SCENARIO=files-failure \
    PROGRESS_FILE="$case_dir/progress.json" \
    PUBLISHER_STATE_FILE="$case_dir/publisher.json" \
    TRIAGE_EVENTS_FILE="$case_dir/triage.json" \
    bash "$ROOT_DIR/scripts/tribunal-publisher.sh" --status 2>&1
  )"; then
    echo "expected PR files failure to reject the GitHub conflict snapshot" >&2
    exit 1
  fi
  [ ! -e "$case_dir/publisher.json" ] || {
    echo "failed PR files request must not initialize publisher state" >&2
    exit 1
  }
  [ ! -e "$case_dir/triage.json" ] || {
    echo "failed PR files request must not initialize triage state" >&2
    exit 1
  }
  grep -q 'pulls?state=open&per_page=100' "$case_dir/gh.log"
  grep -q 'pulls/17/files?per_page=100' "$case_dir/gh.log"
  grep -q 'files request failed for PR #17' <<<"$output"
}

run_hermetic_bypass_cases() {
  local case_dir="$TMPDIR/hermetic-bypasses"
  mkdir -p "$case_dir/files"
  printf '{}\n' > "$case_dir/progress.json"
  cat > "$case_dir/prs.json" <<'JSON'
[{"number":23,"title":"Editorial PR","headRefName":"editorial/test","labels":[]}]
JSON

  if fixture_output="$(
    GH_BIN="$TMPDIR/gh" \
    GH_CALL_LOG="$case_dir/fixture-gh.log" \
    GH_SCENARIO=files-failure \
    TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE="$case_dir/prs.json" \
    TRIBUNAL_PUBLISHER_PR_FILES_DIR="$case_dir/files" \
    PROGRESS_FILE="$case_dir/progress.json" \
    PUBLISHER_STATE_FILE="$case_dir/fixture-publisher.json" \
    TRIAGE_EVENTS_FILE="$case_dir/fixture-triage.json" \
    bash "$ROOT_DIR/scripts/tribunal-publisher.sh" --status 2>&1
  )"; then
    echo "expected incomplete fixture snapshot to fail" >&2
    exit 1
  fi
  [ ! -e "$case_dir/fixture-gh.log" ] || {
    echo "fixture mode must not fall back to live GitHub requests" >&2
    exit 1
  }
  [ ! -e "$case_dir/fixture-publisher.json" ] || {
    echo "incomplete fixture must not initialize publisher state" >&2
    exit 1
  }
  grep -q 'missing files fixture for PR #23' <<<"$fixture_output"

  printf '[]\n' > "$case_dir/empty-prs.json"
  GH_BIN="$TMPDIR/gh" \
  GH_CALL_LOG="$case_dir/empty-fixture-gh.log" \
  GH_SCENARIO=files-failure \
  TRIBUNAL_PUBLISHER_PR_LIST_JSON_FILE="$case_dir/empty-prs.json" \
  PROGRESS_FILE="$case_dir/progress.json" \
  PUBLISHER_STATE_FILE="$case_dir/empty-fixture-publisher.json" \
  TRIAGE_EVENTS_FILE="$case_dir/empty-fixture-triage.json" \
  bash "$ROOT_DIR/scripts/tribunal-publisher.sh" --status >/dev/null
  [ ! -e "$case_dir/empty-fixture-gh.log" ] || {
    echo "empty list-only fixture must not call gh" >&2
    exit 1
  }

  GH_BIN="$TMPDIR/gh" \
  GH_CALL_LOG="$case_dir/disabled-gh.log" \
  GH_SCENARIO=files-failure \
  TRIBUNAL_PUBLISHER_DISABLE_GH_SCAN=1 \
  PROGRESS_FILE="$case_dir/progress.json" \
  PUBLISHER_STATE_FILE="$case_dir/disabled-publisher.json" \
  TRIAGE_EVENTS_FILE="$case_dir/disabled-triage.json" \
  bash "$ROOT_DIR/scripts/tribunal-publisher.sh" --status >/dev/null
  [ ! -e "$case_dir/disabled-gh.log" ] || {
    echo "explicit GitHub scan disable must not call gh" >&2
    exit 1
  }
}

for script in \
  "$ROOT_DIR/scripts/tribunal-publisher.sh" \
  "$ROOT_DIR/scripts/tribunal-publisher-autopilot.sh"
do
  run_case "$script" plain-success '{"source":"plain"}'
  run_case "$script" token-success '{"source":"token"}'
done

run_preflight_case plain-success
run_preflight_case token-success
run_failed_snapshot_case
run_hermetic_bypass_cases

echo "publisher gh auth fallback tests passed"
