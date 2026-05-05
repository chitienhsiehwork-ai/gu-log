#!/usr/bin/env bash
# Deprecated compatibility wrapper.
# Canonical quality gate is scripts/tribunal.sh.

set -euo pipefail
cd "$(dirname "$0")/.."

exec bash scripts/tribunal.sh "$@"
