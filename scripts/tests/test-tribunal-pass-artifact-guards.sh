#!/usr/bin/env bash
# test-tribunal-pass-artifact-guards.sh — regression tests for preventing
# progress-only Tribunal PASS commits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSERT="$ROOT_DIR/scripts/tribunal-assert-pass-artifacts.sh"
AUDIT="$ROOT_DIR/scripts/tribunal-audit-pass-commits.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "✓ $*"; }

setup_repo() {
  local repo="$1"
  mkdir -p "$repo/src/content/posts" "$repo/scores"
  git -C "$repo" init -q
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name "Tribunal Guard Test"
  cat > "$repo/src/content/posts/cp-999-test.mdx" <<'POST'
---
ticketId: CP-999
title: Test
lang: zh-tw
translatedDate: 2026-04-29
scores:
  tribunalVersion: 3
---

Original body.
POST
  cat > "$repo/src/content/posts/en-cp-999-test.mdx" <<'POST'
---
ticketId: CP-999
title: Test EN
lang: en
translatedDate: 2026-04-29
scores:
  tribunalVersion: 3
---

Original EN body.
POST
  printf '{}\n' > "$repo/scores/tribunal-progress.json"
  git -C "$repo" add .
  git -C "$repo" commit -q -m initial
}

# 1. PASS postcondition must fail loudly if only progress JSON is staged.
repo1="$TMP/postcondition"
setup_repo "$repo1"
python3 - <<PY
from pathlib import Path
import json
p=Path('$repo1/scores/tribunal-progress.json')
p.write_text(json.dumps({'cp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo1" add scores/tribunal-progress.json
if bash "$ASSERT" "$repo1" cp-999-test.mdx --staged >/tmp/guard-out 2>&1; then
  cat /tmp/guard-out >&2
  fail "postcondition allowed a progress-only staged PASS"
fi
if ! grep -q 'missing staged target post artifact' /tmp/guard-out; then
  cat /tmp/guard-out >&2
  fail "postcondition failure did not explain missing target artifact"
fi
pass "postcondition rejects progress-only staged PASS"

# 2. PASS postcondition must pass when staged diff includes progress + zh/en post artifacts.
repo2="$TMP/postcondition-ok"
setup_repo "$repo2"
python3 - <<PY
from pathlib import Path
import json
repo=Path('$repo2')
(repo/'src/content/posts/cp-999-test.mdx').write_text((repo/'src/content/posts/cp-999-test.mdx').read_text().replace('Original body.', 'Rewritten body.'))
(repo/'src/content/posts/en-cp-999-test.mdx').write_text((repo/'src/content/posts/en-cp-999-test.mdx').read_text().replace('Original EN body.', 'Rewritten EN body.'))
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'cp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo2" add scores/tribunal-progress.json src/content/posts/cp-999-test.mdx src/content/posts/en-cp-999-test.mdx
bash "$ASSERT" "$repo2" cp-999-test.mdx --staged
pass "postcondition accepts staged PASS with target artifacts"

# 3. Audit must fail on historical progress-only Tribunal PASS commits.
repo3="$TMP/audit"
setup_repo "$repo3"
python3 - <<PY
from pathlib import Path
import json
p=Path('$repo3/scores/tribunal-progress.json')
p.write_text(json.dumps({'cp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo3" add scores/tribunal-progress.json
git -C "$repo3" commit -q -m 'tribunal(cp-999-test): all 4 stages PASS + final build'
if bash "$AUDIT" --repo "$repo3" --limit 10 >/tmp/audit-out 2>&1; then
  cat /tmp/audit-out >&2
  fail "audit allowed a progress-only historical PASS commit"
fi
if ! grep -q 'progress-only Tribunal PASS commit' /tmp/audit-out; then
  cat /tmp/audit-out >&2
  fail "audit failure did not name progress-only PASS problem"
fi
pass "audit rejects historical progress-only PASS commits"

# 4. Audit must pass when PASS commit includes target posts.
repo4="$TMP/audit-ok"
setup_repo "$repo4"
python3 - <<PY
from pathlib import Path
import json
repo=Path('$repo4')
(repo/'src/content/posts/cp-999-test.mdx').write_text((repo/'src/content/posts/cp-999-test.mdx').read_text().replace('Original body.', 'Rewritten body.'))
(repo/'src/content/posts/en-cp-999-test.mdx').write_text((repo/'src/content/posts/en-cp-999-test.mdx').read_text().replace('Original EN body.', 'Rewritten EN body.'))
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'cp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo4" add scores/tribunal-progress.json src/content/posts/cp-999-test.mdx src/content/posts/en-cp-999-test.mdx
git -C "$repo4" commit -q -m 'tribunal(cp-999-test): all 4 stages PASS + final build'
bash "$AUDIT" --repo "$repo4" --limit 10
pass "audit accepts PASS commits with target post artifacts"
