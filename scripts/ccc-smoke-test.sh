#!/usr/bin/env bash
# ccc-smoke-test.sh — CCC (Cloud Claude Code) 環境就緒度 smoke test
#
# 為什麼存在：
#   CCC 每次被叫醒都是一個全新的 sandbox container——repo 是 fresh clone，
#   node_modules 沒裝、git hooks 沒掛、sp-pipeline binary 還沒 compile。
#   開工前如果不確認這些，會踩到「hook 沒跑就 commit」「doctor 缺工具才發現」
#   這類本來開場就該擋掉的問題。這支 script 把 CCC-playbook「開場 SOP」要
#   驗的東西全部固化成一條指令，順便守住 hook source-of-truth drift（見 check 5/6）。
#
# 用法：
#   ./scripts/ccc-smoke-test.sh           # 跑所有 check，回報 PASS/FAIL，有 required 沒過則 exit 1
#   ./scripts/ccc-smoke-test.sh --fix     # 跑之前先補環境（pnpm install + setup-hooks）
#   ./scripts/ccc-smoke-test.sh --full    # 多跑慢的 gate（lint + astro check）
#   ./scripts/ccc-smoke-test.sh --fix --full
#
# Exit code：0 = 所有 required check 過；1 = 至少一個 required check 失敗。
# optional check 失敗只 warn，不影響 exit code。

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FIX=false
FULL=false
for arg in "$@"; do
  case "$arg" in
    --fix) FIX=true ;;
    --full) FULL=true ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# ── 顏色（非 tty 時關掉，CI log 不要色碼）──────────────────────────
if [ -t 1 ]; then
  G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'
else
  G=''; R=''; Y=''; B=''; N=''
fi

PASS=0
FAIL=0
WARN=0

# pass <label>
pass() { printf "  ${G}✓${N} %s\n" "$1"; PASS=$((PASS + 1)); }
# fail <label> [detail] — detail 拼進完整字串再用單一 %s 印（避免 detail 含 % 炸 printf）
fail() {
  local msg="$1"; [ -n "${2:-}" ] && msg="$msg — $2"
  printf "  ${R}✗${N} %s\n" "$msg"; FAIL=$((FAIL + 1))
}
# warn <label> [detail]  (optional check，不影響 exit code)
warn() {
  local msg="$1"; [ -n "${2:-}" ] && msg="$msg — $2"
  printf "  ${Y}!${N} %s\n" "$msg"; WARN=$((WARN + 1))
}
section() { printf "\n${B}== %s ==${N}\n" "$1"; }

# ── --fix：開工前自動補環境 ───────────────────────────────────────
if $FIX; then
  section "FIX: 補環境"
  if [ ! -d node_modules ]; then
    echo "  installing deps (pnpm install --frozen-lockfile)..."
    pnpm install --frozen-lockfile >/tmp/ccc-smoke-install.log 2>&1 \
      && pass "pnpm install" || fail "pnpm install" "see /tmp/ccc-smoke-install.log"
  else
    pass "node_modules 已存在，跳過 install"
  fi
  bash scripts/setup-hooks.sh >/tmp/ccc-smoke-hooks.log 2>&1 \
    && pass "setup-hooks" || fail "setup-hooks" "see /tmp/ccc-smoke-hooks.log"
fi

# ── 1. 身份 ───────────────────────────────────────────────────────
section "1. 身份 (detect-env)"
MODE="$(./scripts/detect-env.sh 2>/dev/null || echo unknown)"
if [ "$MODE" = "CCC" ]; then
  pass "detect-env = CCC"
else
  warn "detect-env = $MODE（非 CCC；smoke test 仍可跑，但這支主要給 CCC 用）"
fi

# ── 2. 必備工具 ───────────────────────────────────────────────────
section "2. 必備工具"
for tool in node pnpm git python3 curl go; do
  if command -v "$tool" >/dev/null 2>&1; then
    pass "$tool ($(command -v "$tool"))"
  else
    fail "$tool 不在 PATH"
  fi
done

# ── 3. 外網 (command-line HTTPS 應該通，見 CCC-playbook) ───────────
section "3. 外網"
STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://gu-log.vercel.app 2>/dev/null || echo 000)"
if [ "$STATUS" = "200" ]; then
  pass "curl https://gu-log.vercel.app → 200"
else
  fail "curl https://gu-log.vercel.app → $STATUS" "outbound HTTPS 可能被擋"
fi

# ── 4. 依賴 ───────────────────────────────────────────────────────
section "4. 依賴"
if [ -d node_modules ]; then
  pass "node_modules 存在"
else
  fail "node_modules 缺" "跑 './scripts/ccc-smoke-test.sh --fix' 或 'pnpm install'"
fi

# ── 5. Git hooks 已掛上且是 canonical 版 ─────────────────────────
# CCC 開場若沒跑 setup-hooks，commit 會繞過所有品質 gate。這裡確認：
#   (a) core.hooksPath 指到 .git/hooks
#   (b) 實際 active 的 hook == tracked canonical (.githooks/)
section "5. Git hooks"
HOOKS_PATH="$(git config core.hooksPath || echo '')"
if [ -n "$HOOKS_PATH" ]; then
  pass "core.hooksPath = $HOOKS_PATH"
else
  fail "core.hooksPath 未設" "跑 'bash scripts/setup-hooks.sh' 或 --fix"
fi
for h in pre-commit pre-push; do
  active=".git/hooks/$h"
  canon=".githooks/$h"
  if [ ! -x "$active" ]; then
    fail "$h 未安裝到 .git/hooks/" "跑 setup-hooks 或 --fix"
  elif diff -q "$active" "$canon" >/dev/null 2>&1; then
    pass "$h active == canonical (.githooks/$h)"
  else
    fail "$h active 與 .githooks/$h 不一致" "active hook 過時，重跑 setup-hooks"
  fi
done

# ── 6. Hook source-of-truth drift guard ───────────────────────────
# setup-hooks.sh 從 scripts/hooks/ 安裝、同步到 .githooks/。如果有人只改
# 其中一邊（歷史上 b300dab 就只改了 .githooks/ 忘了 scripts/hooks/），CCC
# 會裝到過時的 hook。這個 check 確保兩份 tracked 副本永遠一致。
section "6. Hook source drift guard"
for h in pre-commit pre-push; do
  if diff -q "scripts/hooks/$h" ".githooks/$h" >/dev/null 2>&1; then
    pass "scripts/hooks/$h == .githooks/$h"
  else
    fail "scripts/hooks/$h 與 .githooks/$h drift" "兩份 tracked hook 不同步——setup-hooks 會裝到舊版"
  fi
done

# ── 7. 內容驗證 ───────────────────────────────────────────────────
section "7. validate-posts"
if [ -d node_modules ]; then
  if node scripts/validate-posts.mjs >/tmp/ccc-smoke-validate.log 2>&1; then
    pass "$(grep -oE 'PASSED: [0-9]+ file' /tmp/ccc-smoke-validate.log | head -1 || echo 'validate-posts 通過')"
  else
    fail "validate-posts 失敗" "see /tmp/ccc-smoke-validate.log"
  fi
else
  warn "跳過 validate-posts（node_modules 缺）"
fi

# ── 8. sp-pipeline 自編譯 + doctor ────────────────────────────────
section "8. sp-pipeline doctor"
if tools/sp-pipeline/sp-pipeline doctor >/tmp/ccc-smoke-doctor.log 2>&1; then
  pass "sp-pipeline 自編譯 + doctor healthy"
else
  fail "sp-pipeline doctor 失敗 (exit $?)" "see /tmp/ccc-smoke-doctor.log"
fi

# ── 9. 慢 gate（--full 才跑）─────────────────────────────────────
if $FULL; then
  section "9. 慢 gate (--full)"
  if [ -d node_modules ]; then
    pnpm run lint >/tmp/ccc-smoke-lint.log 2>&1 \
      && pass "eslint" || fail "eslint" "see /tmp/ccc-smoke-lint.log"
    pnpm run check:contrast >/tmp/ccc-smoke-contrast.log 2>&1 \
      && pass "WCAG contrast" || fail "WCAG contrast" "see /tmp/ccc-smoke-contrast.log"
    pnpm exec astro check >/tmp/ccc-smoke-astro.log 2>&1 \
      && pass "astro check (type)" || fail "astro check" "see /tmp/ccc-smoke-astro.log"
  else
    warn "跳過 --full gate（node_modules 缺）"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────
section "Summary"
printf "  ${G}%d passed${N}, ${R}%d failed${N}, ${Y}%d warn${N}\n" "$PASS" "$FAIL" "$WARN"
if [ "$FAIL" -gt 0 ]; then
  printf "  ${R}CCC env NOT ready.${N} 修上面 ✗ 的項目（多數可用 --fix 自動補）。\n"
  exit 1
fi
printf "  ${G}CCC env ready. 可以開工。${N}\n"
exit 0
