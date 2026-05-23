#!/usr/bin/env bash
# Static/no-token regressions for Tribunal v6 safety hardening.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIBUNAL="$ROOT_DIR/scripts/tribunal.sh"
VIBE="$ROOT_DIR/scripts/vibe-scorer.sh"
HELPERS="$ROOT_DIR/scripts/tribunal-helpers.sh"
WRAPPER="$ROOT_DIR/scripts/cc-tribunal-loop-wrapper.sh"
CODEX_AGENTS_DIR="$ROOT_DIR/.codex/agents"
CODEX_WRITER="$CODEX_AGENTS_DIR/tribunal-writer.toml"

fail() { echo "x $*" >&2; exit 1; }
pass() { echo "ok $*"; }

if grep -Eq -- '--no-verify|--no-gpg-sign' "$TRIBUNAL" "$VIBE" "$HELPERS"; then
  fail "Tribunal runtime contains hook-bypass flags"
fi
pass "no hook-bypass flags in Tribunal runtime"

if ! grep -q 'TRIBUNAL_NO_COMMIT=1; skipping commit_progress' "$TRIBUNAL"; then
  fail "commit_progress does not honor TRIBUNAL_NO_COMMIT"
fi
if ! grep -q 'TRIBUNAL_ALLOW_PUSH is not set' "$TRIBUNAL"; then
  fail "commit_progress does not default to no-push"
fi
if ! grep -q 'refusing to direct-push main' "$TRIBUNAL"; then
  fail "commit_progress does not refuse direct main pushes"
fi
pass "commit/push safety defaults are explicit"

if ! grep -q 'if \[ -n "\$ONLY_STAGE" \]' "$TRIBUNAL"; then
  fail "--only-stage default rewrite guard is missing"
fi
if ! grep -q 'Rewrite disabled for this run' "$TRIBUNAL"; then
  fail "judge-only failure path could invoke writer rewrite"
fi
if ! bash "$TRIBUNAL" --help 2>&1 | grep -q -- '--allow-rewrite'; then
  fail "--allow-rewrite is not documented in help"
fi
pass "judge-only/--only-stage requires explicit --allow-rewrite"

if ! grep -q -- '--score-only --only-stage vibe' "$VIBE"; then
  fail "vibe-scorer does not delegate through non-mutating score-only mode"
fi
if ! grep -q 'WRITE_FRONTMATTER=0' "$TRIBUNAL"; then
  fail "score-only does not disable frontmatter writes"
fi
if ! grep -q 'TRIBUNAL_SCORE_ONLY_PROGRESS_FILE' "$TRIBUNAL"; then
  fail "score-only does not move progress writes out of repo"
fi
pass "vibe-scorer remains score-only/non-mutating"

if ! grep -q 'Invalid/missing .* score JSON schema' "$TRIBUNAL"; then
  fail "invalid judge JSON schema does not fail loudly"
fi
pass "invalid judge JSON fails loudly"

if ! grep -q 'TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC:-900' "$HELPERS"; then
  fail "Codex idle watchdog default is not 15 minutes"
fi
if ! grep -q 'no output/score-file progress' "$HELPERS"; then
  fail "Codex idle watchdog does not track output + score progress"
fi
pass "Codex idle watchdog semantics are present"

if ! grep -q '.codex/agents/\$agent_name.toml' "$HELPERS"; then
  fail "Codex tribunal helper does not prefer .codex/agents custom agents"
fi
if ! grep -q 'Ignore YAML' "$HELPERS" || ! grep -q 'frontmatter runtime fields' "$HELPERS"; then
  fail "Codex tribunal helper does not ignore Claude Code frontmatter runtime"
fi
pass "Codex agent specs are separated from Claude Code frontmatter"

if ! grep -q -- '--model gpt-5.5' "$HELPERS"; then
  fail "Codex tribunal helper is not pinned to GPT-5.5"
fi
if ! grep -q 'MIN_CODEX_VERSION="0.128.0"' "$TRIBUNAL"; then
  fail "Tribunal does not reject known-broken old Codex CLI versions"
fi
if ! grep -Fq 'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"' "$WRAPPER"; then
  fail "Tribunal systemd wrapper does not prefer the current ~/.local/bin Codex before stale ~/bin"
fi
if ! grep -q 'local model_id="gpt-5.5"' "$TRIBUNAL"; then
  fail "Tribunal frontmatter/logging model_id is not pinned to GPT-5.5"
fi
unpinned_agents=$(grep -L '^model = "gpt-5.5"' "$CODEX_AGENTS_DIR"/*.toml || true)
if [ -n "$unpinned_agents" ]; then
  fail "One or more Codex tribunal agent specs are not pinned to GPT-5.5: $unpinned_agents"
fi
pass "Tribunal v6 Codex model pinning remains GPT-5.5 end-to-end"

if ! grep -q 'temporary directory' "$CODEX_WRITER" || ! grep -q 'surgical editor' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt lacks GPT-5.5 temp-dir/surgical-edit guardrails"
fi
if ! grep -q 'Do not run the full tribunal' "$CODEX_WRITER"; then
  fail "Codex tribunal writer prompt does not prohibit nested tribunal/quota-burning calls"
fi
if ! grep -q 'Use absolute paths under the Repo root' "$TRIBUNAL"; then
  fail "Tribunal writer task prompt does not force absolute repo paths"
fi
if grep -q 'WRITING_GUIDELINES.md' "$TRIBUNAL" "$CODEX_WRITER"; then
  fail "Tribunal writer prompt references removed WRITING_GUIDELINES.md"
fi
pass "Codex tribunal writer prompt is tuned for GPT-5.5 isolated execution"

if ! grep -q 'tribunal-assert-pass-artifacts.sh' "$TRIBUNAL"; then
  fail "PASS artifact guard is not wired into commit_progress"
fi
pass "PASS artifact guard remains wired"
