#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/gh" <<'EOF'
#!/bin/bash
scenario="${GH_SCENARIO:-plain-success}"
case "$scenario" in
  plain-success)
    if [ -n "${GH_TOKEN:-}" ]; then
      echo "HTTP 401: Bad credentials" >&2
      exit 1
    fi
    printf '{"source":"plain"}\n'
    ;;
  token-success)
    if [ -n "${GH_TOKEN:-}" ]; then
      printf '{"source":"token"}\n'
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

for script in \
  "$ROOT_DIR/scripts/tribunal-publisher.sh" \
  "$ROOT_DIR/scripts/tribunal-publisher-autopilot.sh"
do
  run_case "$script" plain-success '{"source":"plain"}'
  run_case "$script" token-success '{"source":"token"}'
done

echo "publisher gh auth fallback tests passed"
