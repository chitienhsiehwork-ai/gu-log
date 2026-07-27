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
  cat > "$repo/src/content/posts/mp-999-test.mdx" <<'POST'
---
ticketId: MP-999
title: Test
lang: zh-tw
translatedDate: 2026-04-29
scores:
  tribunalVersion: 8
  librarian:
    glossary: 8
    crossRef: 8
    sourceAlign: 8
    attribution: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  factCheck:
    accuracy: 8
    fidelity: 8
    consistency: 8
    sourceBoundary: 8
    commentarySeparation: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  freshEyes:
    readability: 8
    firstImpression: 8
    payoffDensity: 8
    lengthFit: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  vibe:
    persona: 8
    moguNote: 8
    vibe: 8
    clarity: 8
    narrative: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
---

Original body.
POST
  cat > "$repo/src/content/posts/en-mp-999-test.mdx" <<'POST'
---
ticketId: MP-999
title: Test EN
lang: en
translatedDate: 2026-04-29
scores:
  tribunalVersion: 8
  librarian:
    glossary: 8
    crossRef: 8
    sourceAlign: 8
    attribution: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  factCheck:
    accuracy: 8
    fidelity: 8
    consistency: 8
    sourceBoundary: 8
    commentarySeparation: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  freshEyes:
    readability: 8
    firstImpression: 8
    payoffDensity: 8
    lengthFit: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
  vibe:
    persona: 8
    moguNote: 8
    vibe: 8
    clarity: 8
    narrative: 8
    score: 8
    date: "2026-05-30"
    model: "gpt-5.5"
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
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo1" add scores/tribunal-progress.json
if bash "$ASSERT" "$repo1" mp-999-test.mdx --staged >"$TMP/guard-out" 2>&1; then
  cat "$TMP/guard-out" >&2
  fail "postcondition allowed a progress-only staged PASS"
fi
if ! grep -q 'missing staged target post artifact' "$TMP/guard-out"; then
  cat "$TMP/guard-out" >&2
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
(repo/'src/content/posts/mp-999-test.mdx').write_text((repo/'src/content/posts/mp-999-test.mdx').read_text().replace('Original body.', 'Rewritten body.'))
(repo/'src/content/posts/en-mp-999-test.mdx').write_text((repo/'src/content/posts/en-mp-999-test.mdx').read_text().replace('Original EN body.', 'Rewritten EN body.'))
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo2" add scores/tribunal-progress.json src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
bash "$ASSERT" "$repo2" mp-999-test.mdx --staged
pass "postcondition accepts staged PASS with target artifacts"

# 3. Staged validation must read the index only. An incomplete staged artifact
# must not borrow complete score frontmatter from the unstaged working tree.
repo2a="$TMP/postcondition-index-isolation"
setup_repo "$repo2a"
python3 - <<PY
from pathlib import Path
repo=Path('$repo2a')
for name in ['mp-999-test.mdx', 'en-mp-999-test.mdx']:
    p = repo/'src/content/posts'/name
    before, rest = p.read_text().split('scores:\n', 1)
    _, after = rest.split('---\n', 1)
    p.write_text((before + '---\n' + after).replace('Original', 'Staged incomplete'))
PY
git -C "$repo2a" add src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
for rel in src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx; do
  git -C "$repo2a" show "HEAD:$rel" >"$repo2a/$rel"
done
if git -C "$repo2a" show :src/content/posts/mp-999-test.mdx | grep -q '^scores:'; then
  fail "index-isolation fixture unexpectedly staged scores"
fi
if ! grep -q '^scores:' "$repo2a/src/content/posts/mp-999-test.mdx"; then
  fail "index-isolation fixture lacks complete unstaged scores"
fi
if bash "$ASSERT" "$repo2a" mp-999-test.mdx --staged >"$TMP/guard-index-out" 2>&1; then
  cat "$TMP/guard-index-out" >&2
  fail "postcondition accepted incomplete staged scores from the unstaged worktree"
fi
if ! grep -q 'target post artifact lacks scores' "$TMP/guard-index-out"; then
  cat "$TMP/guard-index-out" >&2
  fail "index-isolation rejection did not explain incomplete staged scores"
fi
pass "postcondition rejects incomplete index artifacts despite complete worktree files"

# 4. The inverse split must validate the complete index even if an unstaged
# edit removes score frontmatter from the working tree.
repo2aa="$TMP/postcondition-worktree-isolation"
setup_repo "$repo2aa"
python3 - <<PY
from pathlib import Path
repo=Path('$repo2aa')
for name in ['mp-999-test.mdx', 'en-mp-999-test.mdx']:
    p = repo/'src/content/posts'/name
    p.write_text(p.read_text().replace('Original', 'Staged complete'))
PY
git -C "$repo2aa" add src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
python3 - <<PY
from pathlib import Path
repo=Path('$repo2aa')
for name in ['mp-999-test.mdx', 'en-mp-999-test.mdx']:
    p = repo/'src/content/posts'/name
    before, rest = p.read_text().split('scores:\n', 1)
    _, after = rest.split('---\n', 1)
    p.write_text(before + '---\n' + after)
PY
if ! git -C "$repo2aa" show :src/content/posts/mp-999-test.mdx | grep -q '^scores:'; then
  fail "worktree-isolation fixture lacks complete staged scores"
fi
if grep -q '^scores:' "$repo2aa/src/content/posts/mp-999-test.mdx"; then
  fail "worktree-isolation fixture unexpectedly retained unstaged scores"
fi
bash "$ASSERT" "$repo2aa" mp-999-test.mdx --staged
pass "postcondition accepts complete index artifacts despite incomplete worktree files"

# 5. A PASS must not delete the staged EN counterpart while modifying zh-tw.
repo2ab="$TMP/postcondition-staged-en-delete"
setup_repo "$repo2ab"
python3 - <<PY
from pathlib import Path
p=Path('$repo2ab/src/content/posts/mp-999-test.mdx')
p.write_text(p.read_text().replace('Original body.', 'Rewritten body.'))
PY
git -C "$repo2ab" add src/content/posts/mp-999-test.mdx
git -C "$repo2ab" rm -q src/content/posts/en-mp-999-test.mdx
if bash "$ASSERT" "$repo2ab" mp-999-test.mdx --staged >"$TMP/guard-staged-en-delete-out" 2>&1; then
  cat "$TMP/guard-staged-en-delete-out" >&2
  fail "postcondition accepted a staged EN counterpart deletion"
fi
if ! grep -q 'unable to read staged target post artifact from index' "$TMP/guard-staged-en-delete-out"; then
  cat "$TMP/guard-staged-en-delete-out" >&2
  fail "staged EN deletion rejection did not explain the missing index artifact"
fi
pass "postcondition rejects staged EN counterpart deletion"

# 6. Commit-mode validation must reject the same EN counterpart deletion.
repo2ac="$TMP/postcondition-committed-en-delete"
setup_repo "$repo2ac"
python3 - <<PY
from pathlib import Path
p=Path('$repo2ac/src/content/posts/mp-999-test.mdx')
p.write_text(p.read_text().replace('Original body.', 'Rewritten body.'))
PY
git -C "$repo2ac" add src/content/posts/mp-999-test.mdx
git -C "$repo2ac" rm -q src/content/posts/en-mp-999-test.mdx
git -C "$repo2ac" commit -q -m 'tribunal(mp-999-test): all 4 stages PASS + final build'
if bash "$ASSERT" "$repo2ac" mp-999-test.mdx --commit HEAD >"$TMP/guard-committed-en-delete-out" 2>&1; then
  cat "$TMP/guard-committed-en-delete-out" >&2
  fail "postcondition accepted a committed EN counterpart deletion"
fi
if ! grep -q 'unable to read committed target post artifact' "$TMP/guard-committed-en-delete-out"; then
  cat "$TMP/guard-committed-en-delete-out" >&2
  fail "committed EN deletion rejection did not explain the missing commit artifact"
fi
pass "postcondition rejects committed EN counterpart deletion"

# 7. Renaming the canonical EN counterpart away is a deletion from the target
# tree and must not bypass pairing validation via Git rename detection.
repo2ad="$TMP/postcondition-staged-en-rename-away"
setup_repo "$repo2ad"
python3 - <<PY
from pathlib import Path
p=Path('$repo2ad/src/content/posts/mp-999-test.mdx')
p.write_text(p.read_text().replace('Original body.', 'Rewritten body.'))
PY
git -C "$repo2ad" add src/content/posts/mp-999-test.mdx
git -C "$repo2ad" mv \
  src/content/posts/en-mp-999-test.mdx \
  src/content/posts/en-mp-999-renamed.mdx
if bash "$ASSERT" "$repo2ad" mp-999-test.mdx --staged >"$TMP/guard-staged-en-rename-out" 2>&1; then
  cat "$TMP/guard-staged-en-rename-out" >&2
  fail "postcondition accepted renaming away the staged EN counterpart"
fi
if ! grep -q 'unable to read staged target post artifact from index' "$TMP/guard-staged-en-rename-out"; then
  cat "$TMP/guard-staged-en-rename-out" >&2
  fail "staged EN rename rejection did not explain the missing canonical artifact"
fi
pass "postcondition rejects renaming away the staged EN counterpart"

# 8. An EN file that exists only as an untracked worktree file is not part of
# the staged target tree and must not create a false pairing requirement.
repo2ae="$TMP/postcondition-untracked-en"
setup_repo "$repo2ae"
cp "$repo2ae/src/content/posts/en-mp-999-test.mdx" "$TMP/untracked-en-source.mdx"
git -C "$repo2ae" rm -q src/content/posts/en-mp-999-test.mdx
git -C "$repo2ae" commit -q -m 'establish zh-only target tree'
python3 - <<PY
from pathlib import Path
p=Path('$repo2ae/src/content/posts/mp-999-test.mdx')
p.write_text(p.read_text().replace('Original body.', 'Rewritten body.'))
PY
git -C "$repo2ae" add src/content/posts/mp-999-test.mdx
cp "$TMP/untracked-en-source.mdx" "$repo2ae/src/content/posts/en-mp-999-test.mdx"
if git -C "$repo2ae" cat-file -e :src/content/posts/en-mp-999-test.mdx 2>/dev/null; then
  fail "untracked-EN fixture unexpectedly includes EN in the index"
fi
[ -f "$repo2ae/src/content/posts/en-mp-999-test.mdx" ] ||
  fail "untracked-EN fixture lacks its worktree-only EN file"
bash "$ASSERT" "$repo2ae" mp-999-test.mdx --staged
pass "postcondition ignores an untracked EN file outside the staged target tree"

# 9. New staged PASS postcondition must reject pre-v8 score frontmatter.
repo2b="$TMP/postcondition-v6-reject"
setup_repo "$repo2b"
python3 - <<PY
from pathlib import Path
import json
repo=Path('$repo2b')
for name in ['mp-999-test.mdx', 'en-mp-999-test.mdx']:
    p = repo/'src/content/posts'/name
    p.write_text(p.read_text().replace('tribunalVersion: 8', 'tribunalVersion: 6').replace('Original', 'Rewritten'))
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS', 'tribunalVersion': 6}}, indent=2) + '\n')
PY
git -C "$repo2b" add scores/tribunal-progress.json src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
if bash "$ASSERT" "$repo2b" mp-999-test.mdx --staged >"$TMP/guard-v6-out" 2>&1; then
  cat "$TMP/guard-v6-out" >&2
  fail "postcondition accepted pre-v8 score frontmatter for a new PASS"
fi
if ! grep -q 'tribunalVersion >= 8' "$TMP/guard-v6-out"; then
  cat "$TMP/guard-v6-out" >&2
  fail "pre-v8 rejection did not explain required tribunal version"
fi
pass "postcondition rejects pre-v8 staged PASS score frontmatter"

# 10. New staged PASS postcondition must reject v8 frontmatter missing a required judge.
repo2c="$TMP/postcondition-missing-judge-reject"
setup_repo "$repo2c"
python3 - <<PY
from pathlib import Path
import json, re
repo=Path('$repo2c')
for name in ['mp-999-test.mdx', 'en-mp-999-test.mdx']:
    p = repo/'src/content/posts'/name
    text = p.read_text().replace('Original', 'Rewritten')
    text = re.sub(r'\n  librarian:\n    glossary: 8\n    crossRef: 8\n    sourceAlign: 8\n    attribution: 8\n    score: 8\n    date: "2026-05-30"\n    model: "gpt-5.5"', '', text)
    p.write_text(text)
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS', 'tribunalVersion': 8}}, indent=2) + '\n')
PY
git -C "$repo2c" add scores/tribunal-progress.json src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
if bash "$ASSERT" "$repo2c" mp-999-test.mdx --staged >"$TMP/guard-missing-judge-out" 2>&1; then
  cat "$TMP/guard-missing-judge-out" >&2
  fail "postcondition accepted v8 score frontmatter missing Librarian"
fi
if ! grep -q 'Missing judge block(s): librarian' "$TMP/guard-missing-judge-out"; then
  cat "$TMP/guard-missing-judge-out" >&2
  fail "missing-judge rejection did not name Librarian"
fi
pass "postcondition rejects incomplete v8 staged PASS score frontmatter"

# 11. Audit must fail on historical progress-only Tribunal PASS commits.
repo3="$TMP/audit"
setup_repo "$repo3"
python3 - <<PY
from pathlib import Path
import json
p=Path('$repo3/scores/tribunal-progress.json')
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo3" add scores/tribunal-progress.json
git -C "$repo3" commit -q -m 'tribunal(mp-999-test): all 4 stages PASS + final build'
if bash "$AUDIT" --repo "$repo3" --limit 10 >"$TMP/audit-out" 2>&1; then
  cat "$TMP/audit-out" >&2
  fail "audit allowed a progress-only historical PASS commit"
fi
if ! grep -q 'progress-only Tribunal PASS commit' "$TMP/audit-out"; then
  cat "$TMP/audit-out" >&2
  fail "audit failure did not name progress-only PASS problem"
fi
pass "audit rejects historical progress-only PASS commits"

# 12. Audit must pass when PASS commit includes target posts.
repo4="$TMP/audit-ok"
setup_repo "$repo4"
python3 - <<PY
from pathlib import Path
import json
repo=Path('$repo4')
(repo/'src/content/posts/mp-999-test.mdx').write_text((repo/'src/content/posts/mp-999-test.mdx').read_text().replace('Original body.', 'Rewritten body.'))
(repo/'src/content/posts/en-mp-999-test.mdx').write_text((repo/'src/content/posts/en-mp-999-test.mdx').read_text().replace('Original EN body.', 'Rewritten EN body.'))
p=repo/'scores/tribunal-progress.json'
p.write_text(json.dumps({'mp-999-test.mdx': {'status': 'PASS'}}, indent=2) + '\n')
PY
git -C "$repo4" add scores/tribunal-progress.json src/content/posts/mp-999-test.mdx src/content/posts/en-mp-999-test.mdx
git -C "$repo4" commit -q -m 'tribunal(mp-999-test): all 4 stages PASS + final build'
bash "$AUDIT" --repo "$repo4" --limit 10
pass "audit accepts PASS commits with target post artifacts"
