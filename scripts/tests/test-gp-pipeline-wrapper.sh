#!/usr/bin/env bash
# Regression test: the self-compiling wrapper must rebuild when Go sources are
# newer than the cached binary, even with `set -o pipefail` enabled.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/gp-pipeline-wrapper.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

PIPELINE_DIR="$TEST_ROOT/tools/gp-pipeline"
FAKE_BIN_DIR="$TEST_ROOT/fake-bin"
mkdir -p "$PIPELINE_DIR/bin" "$PIPELINE_DIR/cmd/gp-pipeline" "$FAKE_BIN_DIR"
cp "$ROOT_DIR/tools/gp-pipeline/gp-pipeline" "$PIPELINE_DIR/gp-pipeline"
touch "$PIPELINE_DIR/go.mod" "$PIPELINE_DIR/go.sum"
touch "$PIPELINE_DIR/cmd/gp-pipeline/main.go"

cat > "$PIPELINE_DIR/bin/gp-pipeline" <<'OLD_BINARY'
#!/usr/bin/env bash
printf 'OLD\n'
OLD_BINARY
chmod +x "$PIPELINE_DIR/bin/gp-pipeline"

# Model the GNU/BSD find + grep -q failure under pipefail: grep accepts the
# first match and closes its input, so find can exit with SIGPIPE. The fixed
# wrapper asks find to stop itself after the first match instead.
cat > "$FAKE_BIN_DIR/find" <<'FAKE_FIND'
#!/usr/bin/env bash
for argument in "$@"; do
  if [ "$argument" = "-quit" ]; then
    printf '%s\n' './cmd/gp-pipeline/main.go'
    exit 0
  fi
done
printf '%s\n' './cmd/gp-pipeline/main.go'
exit 141
FAKE_FIND
chmod +x "$FAKE_BIN_DIR/find"

cat > "$FAKE_BIN_DIR/go" <<'FAKE_GO'
#!/usr/bin/env bash
set -euo pipefail
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then
    shift
    output="$1"
  fi
  shift
done
[ -n "$output" ]
cat > "$output" <<'NEW_BINARY'
#!/usr/bin/env bash
printf 'NEW\n'
NEW_BINARY
chmod +x "$output"
printf 'built\n' > "$FAKE_GO_MARKER"
FAKE_GO
chmod +x "$FAKE_BIN_DIR/go"

output="$({
  PATH="$FAKE_BIN_DIR:$PATH" \
    FAKE_GO_MARKER="$TEST_ROOT/go-called" \
    TRIBUNAL_RUNTIME_PROFILE=legacy \
    bash "$PIPELINE_DIR/gp-pipeline" run --help
} 2>&1)"

if [ "$output" != 'NEW' ]; then
  printf 'expected rebuilt binary output NEW, got: %s\n' "$output" >&2
  exit 1
fi
if [ ! -f "$TEST_ROOT/go-called" ]; then
  printf 'expected wrapper to invoke go build\n' >&2
  exit 1
fi

printf 'gp-pipeline wrapper regression test passed\n'
