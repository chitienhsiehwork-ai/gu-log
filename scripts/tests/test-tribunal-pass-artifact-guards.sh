#!/usr/bin/env bash
# test-tribunal-pass-artifact-guards.sh — regression tests for preventing
# progress-only Tribunal PASS commits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ASSERT="$ROOT_DIR/scripts/tribunal-assert-pass-artifacts.sh"
AUDIT="$ROOT_DIR/scripts/tribunal-audit-pass-commits.sh"
AUDIT_SERVICE="$ROOT_DIR/scripts/tribunal-pass-audit.service"
AUDIT_TIMER="$ROOT_DIR/scripts/tribunal-pass-audit.timer"
RUNBOOK="$ROOT_DIR/docs/tribunal-runbook.md"
GITIGNORE="$ROOT_DIR/.gitignore"

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

# 13. Audit scratch output must use a unique mktemp file and clean it up.
# A predictable shared /tmp path permits symlink truncation and lets concurrent
# audits overwrite or delete each other's diagnostics.
fake_bin="$TMP/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/mktemp" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$MKTEMP_LOG"
: >"$MKTEMP_OUTPUT"
printf '%s\n' "$MKTEMP_OUTPUT"
SH
chmod +x "$fake_bin/mktemp"
mktemp_log="$TMP/mktemp-argv"
mktemp_output="$TMP/audit-scratch"
if ! PATH="$fake_bin:$PATH" \
  MKTEMP_LOG="$mktemp_log" \
  MKTEMP_OUTPUT="$mktemp_output" \
  bash "$AUDIT" --repo "$repo4" --limit 10 >"$TMP/audit-mktemp-out" 2>&1; then
  cat "$TMP/audit-mktemp-out" >&2
  fail "audit failed while exercising secure scratch-file handling"
fi
if [ ! -f "$mktemp_log" ]; then
  fail "audit did not allocate scratch output with mktemp"
fi
if ! grep -q 'gu-log-tribunal-audit\.XXXXXX' "$mktemp_log"; then
  cat "$mktemp_log" >&2
  fail "audit did not request a unique gu-log scratch-file template"
fi
if [ -e "$mktemp_output" ]; then
  fail "audit did not remove its unique scratch output on exit"
fi
pass "audit uses unique, cleaned scratch output"

# 14. The scheduled production audit must not trust a cached origin/main when
# its refresh fails. Exercise the systemd unit's inner shell command in both
# directions so a textual refactor cannot accidentally restore stale auditing.
service_command="$(
  sed -n "s|^ExecStart=/bin/bash -lc '\\(.*\\)'$|\\1|p" "$AUDIT_SERVICE"
)"
[ -n "$service_command" ] || fail "unable to extract daily PASS audit service command"
service_command="${service_command//\$\$/\$}"

service_section="$(
  awk '
    /^\[Service\]$/ { in_service = 1; next }
    /^\[/ { in_service = 0 }
    in_service { print }
  ' "$AUDIT_SERVICE"
)"
timeout_directive_count="$(
  grep -Ec '^Timeout(StartSec|Sec)=' <<<"$service_section" || true
)"
if [ "$timeout_directive_count" -ne 1 ] ||
   ! grep -qx 'TimeoutStartSec=10min' <<<"$service_section"; then
  fail "daily PASS audit service does not bound its oneshot start time"
fi
pass "daily PASS audit service bounds stalled fetches and audits"

service_fixture="$TMP/daily-audit-service"
service_fake_bin="$service_fixture/bin"
service_repo="$service_fixture/repo"
service_audit_sentinel="$service_fixture/audit-argv"
mkdir -p "$service_fake_bin" "$service_repo/scripts"
cat >"$service_fake_bin/git" <<'SH'
#!/usr/bin/env bash
if [ "$#" -eq 3 ] && [ "$1" = "fetch" ] && [ "$2" = "origin" ] && [ "$3" = "main" ]; then
  exit "${FAKE_GIT_FETCH_RC:?}"
fi
exit 99
SH
cat >"$service_repo/scripts/tribunal-audit-pass-commits.sh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >"${AUDIT_SENTINEL:?}"
SH
chmod +x "$service_fake_bin/git" "$service_repo/scripts/tribunal-audit-pass-commits.sh"

if PATH="$service_fake_bin:/usr/bin:/bin" \
  GU_LOG_DIR="$service_repo" \
  FAKE_GIT_FETCH_RC=42 \
  AUDIT_SENTINEL="$service_audit_sentinel" \
  bash -c "$service_command" >"$TMP/daily-audit-fetch-failure.out" 2>&1; then
  fail "daily PASS audit service accepted a failed origin/main refresh"
fi
[ ! -e "$service_audit_sentinel" ] ||
  fail "daily PASS audit ran after origin/main refresh failed"
grep -Fq 'unable to refresh origin/main; refusing to audit a cached ref' "$TMP/daily-audit-fetch-failure.out" ||
  fail "daily PASS audit did not explain its stale-ref refusal"

PATH="$service_fake_bin:/usr/bin:/bin" \
  GU_LOG_DIR="$service_repo" \
  FAKE_GIT_FETCH_RC=0 \
  AUDIT_SENTINEL="$service_audit_sentinel" \
  bash -c "$service_command"
[ "$(cat "$service_audit_sentinel")" = "--range 2b1bc361..origin/main" ] ||
  fail "daily PASS audit did not scan the exact remote-main range after a successful refresh"
pass "daily PASS audit fails closed when origin/main cannot be refreshed"

grep -qx 'Persistent=true' "$AUDIT_TIMER" ||
  fail "daily PASS audit timer must catch up after VM downtime"
grep -qx 'Unit=tribunal-pass-audit.service' "$AUDIT_TIMER" ||
  fail "daily PASS audit timer does not target the audit oneshot"
grep -Eq '^OnCalendar=.+Asia/Taipei$' "$AUDIT_TIMER" ||
  fail "daily PASS audit timer does not pin its production schedule timezone"
pass "daily PASS audit timer targets the oneshot with persistent local-time scheduling"

deploy_section="$(
  sed -n '/^## Deploy$/,/^## Worker worktree gotcha$/p' "$RUNBOOK"
)"
for unit in \
  tribunal-runtime.slice \
  tribunal-loop.service \
  tribunal-pass-audit.service \
  tribunal-pass-audit.timer; do
  grep -Fq "install -m 0644 scripts/$unit" <<<"$deploy_section" ||
    fail "runbook deploy block does not install $unit"
  grep -Fq "cmp -s scripts/$unit" <<<"$deploy_section" ||
    fail "runbook checklist does not verify installed $unit source"
done
grep -Fq 'systemctl --user enable tribunal-pass-audit.timer' <<<"$deploy_section" ||
  fail "runbook deploy block does not enable the PASS audit timer"
grep -Fq 'systemctl --user restart tribunal-pass-audit.timer' <<<"$deploy_section" ||
  fail "runbook deploy block does not re-arm the PASS audit timer after unit updates"
grep -Fq 'systemctl --user restart tribunal-pass-audit.service' <<<"$deploy_section" ||
  fail "runbook deploy block does not restart a fresh fail-closed PASS audit smoke"
grep -Fq 'systemctl --user is-enabled tribunal-pass-audit.timer' <<<"$deploy_section" ||
  fail "runbook checklist does not verify the PASS audit timer is enabled"
grep -Fq 'systemctl --user is-active tribunal-pass-audit.timer' <<<"$deploy_section" ||
  fail "runbook checklist does not verify the PASS audit timer is active"
grep -Fq 'NextElapseUSecRealtime' <<<"$deploy_section" ||
  fail "runbook checklist does not verify the PASS audit timer has a next trigger"
grep -Fq 'ExecMainExitTimestamp' <<<"$deploy_section" ||
  fail "runbook checklist does not verify the PASS audit smoke completed"
grep -Fq 'DropInPaths' <<<"$deploy_section" ||
  fail "runbook checklist does not expose effective unit overrides"
grep -Fq 'FragmentPath' <<<"$deploy_section" ||
  fail "runbook checklist does not verify the loaded unit fragments"
grep -Fq 'NeedDaemonReload' <<<"$deploy_section" ||
  fail "runbook checklist does not verify daemon-reload took effect"

reload_line="$(
  grep -nF 'systemctl --user daemon-reload' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
smoke_line="$(
  grep -nF 'systemctl --user restart tribunal-pass-audit.service' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
timer_line="$(
  grep -nF 'systemctl --user enable tribunal-pass-audit.timer' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
if [ "$reload_line" -ge "$smoke_line" ] || [ "$smoke_line" -ge "$timer_line" ]; then
  fail "runbook must reload, run a fresh smoke, then enable the daily timer"
fi
pass "runbook deploys and verifies the tracked PASS audit service and timer"

drain_line="$(
  grep -nF 'touch .score-loop/control/stop-graceful' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
recovery_line="$(
  grep -nF 'recover-pending src/content/posts' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
materialize_line="$(
  grep -nF 'git show origin/main:scripts/tribunal-post-pair-snapshot.py' \
    <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
stash_line="$(
  grep -nF 'git stash push -m "wip" --include-untracked' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
fetch_line="$(
  grep -nF 'git fetch origin main' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
checkout_line="$(
  grep -nF 'git checkout main && git merge --ff-only origin/main' \
    <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
start_line="$(
  grep -nF 'systemctl --user start tribunal-loop' <<<"$deploy_section" |
    head -1 |
    cut -d: -f1
)"
if [ -z "$drain_line" ] || [ -z "$fetch_line" ] ||
   [ -z "$materialize_line" ] || [ -z "$recovery_line" ] ||
   [ -z "$stash_line" ] || [ -z "$checkout_line" ] || [ -z "$start_line" ] ||
   [ "$drain_line" -ge "$fetch_line" ] ||
   [ "$fetch_line" -ge "$materialize_line" ] ||
   [ "$materialize_line" -ge "$recovery_line" ] ||
   [ "$recovery_line" -ge "$stash_line" ] ||
   [ "$stash_line" -ge "$checkout_line" ] ||
   [ "$checkout_line" -ge "$start_line" ]; then
  fail "deploy must drain, fetch helper, recover, stash, sync, then restart in that order"
fi
grep -Fxq 'src/content/posts/.tribunal-pair-journal-*' "$GITIGNORE" ||
  fail "bilingual apply journals are not protected from stash/add"
grep -Fxq 'src/content/posts/.tribunal-restore-*' "$GITIGNORE" ||
  fail "bilingual restore evidence is not protected from stash/add"
if ! git -C "$ROOT_DIR" check-ignore -q \
     src/content/posts/.tribunal-pair-journal-fixture.json ||
   ! git -C "$ROOT_DIR" check-ignore -q \
     src/content/posts/.tribunal-restore-zh-fixture; then
  fail "bilingual crash evidence patterns are not effective git ignores"
fi

rollout_seed="$TMP/rollout-seed"
rollout_origin="$TMP/rollout-origin.git"
rollout_runtime="$TMP/rollout-runtime"
git init -q "$rollout_seed"
git -C "$rollout_seed" config user.email test@example.invalid
git -C "$rollout_seed" config user.name "Tribunal Rollout Test"
mkdir -p "$rollout_seed/scripts" "$rollout_seed/src/content/posts"
printf 'old release\n' > "$rollout_seed/README.md"
: > "$rollout_seed/src/content/posts/.gitkeep"
git -C "$rollout_seed" add README.md src/content/posts/.gitkeep
git -C "$rollout_seed" commit -qm "old release without recovery helper"
old_release="$(git -C "$rollout_seed" rev-parse HEAD)"
git init --bare -q "$rollout_origin"
git -C "$rollout_seed" branch -M main
git -C "$rollout_seed" remote add origin "$rollout_origin"
git -C "$rollout_seed" push -q -u origin main
git -C "$rollout_origin" symbolic-ref HEAD refs/heads/main
cp "$ROOT_DIR/scripts/tribunal-post-pair-snapshot.py" \
  "$rollout_seed/scripts/tribunal-post-pair-snapshot.py"
git -C "$rollout_seed" add scripts/tribunal-post-pair-snapshot.py
git -C "$rollout_seed" commit -qm "add recovery helper"
git -C "$rollout_seed" push -q origin main
git clone -q "$rollout_origin" "$rollout_runtime"
git -C "$rollout_runtime" checkout -q --detach "$old_release"
[ ! -e "$rollout_runtime/scripts/tribunal-post-pair-snapshot.py" ] ||
  fail "old rollout fixture unexpectedly contains the recovery helper"
git -C "$rollout_runtime" fetch -q origin main
rollout_helper="$(mktemp "$TMP/rollout-recovery.XXXXXX.py")"
git -C "$rollout_runtime" \
  show origin/main:scripts/tribunal-post-pair-snapshot.py > "$rollout_helper"
rollout_recovered="$(
  python3 "$rollout_helper" recover-pending \
    "$rollout_runtime/src/content/posts"
)"
[ "$rollout_recovered" = "0" ] ||
  fail "fetched first-rollout helper returned invalid recovery count"
[ ! -e "$rollout_runtime/scripts/tribunal-post-pair-snapshot.py" ] ||
  fail "first-rollout recovery mutated the old checkout before stash/sync"
pass "first rollout recovers from fetched main while the old checkout lacks the helper"
pass "deploy preserves bilingual crash evidence across stash and checkout sync"
