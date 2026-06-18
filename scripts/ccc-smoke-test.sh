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

  # Playwright chromium：CCC sandbox 不預裝瀏覽器 binary（npm 的 playwright 套件
  # 有，但 ~/.cache/ms-playwright 是空的），uiux-auditor / playwright-cli / verify
  # 第一次要截圖就卡「Executable doesn't exist」。在背景非同步補下載（~100MB），
  # 不擋 session 開場；等真的要截圖時通常已經裝好。只在 CCC（remote）跑——mac-CC
  # 自己管 local Playwright，不要在 user 的 Mac 偷下載。
  #
  # ⚠️ 不要用 `ls chromium-*` 當「已裝就跳過」的判斷——那是版本盲的：playwright 套件
  # bump build 版號（例如 chromium-1194 → 1217）後，殘留的舊版目錄會讓這個粗略檢查
  # 誤判成「已裝」而跳過下載，結果 pre-commit 的 content-integrity 測試在 launch 時
  # 報「Executable doesn't exist at .../chrome-headless_shell-1217」。改成直接讓
  # `playwright install chromium` 自己做版本級 idempotency：它只下載缺的/過期的 build，
  # 版本對的時候 ~1s 內 no-op。所以背景無條件跑它（pgrep 防重複），不要自己猜版本。
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
    if pgrep -f "playwright install chromium" >/dev/null 2>&1; then
      pass "Playwright chromium 已有背景下載/驗證在跑，不重複觸發"
    elif [ -x node_modules/.bin/playwright ]; then
      nohup node_modules/.bin/playwright install chromium \
        >/tmp/ccc-playwright-install.log 2>&1 &
      disown 2>/dev/null || true
      pass "Playwright chromium 背景驗證/下載中 (pid $!; log: /tmp/ccc-playwright-install.log)"
    else
      warn "Playwright bin 不在 node_modules" "pnpm install 完成後重跑 --fix 會補"
    fi
  fi

  # OpenSpec CLI：CCC sandbox 不預裝。SDD 流程（openspec-propose / apply）要 `openspec`
  # binary（repo 已 init openspec/，但 binary 不在 fresh sandbox）。套件名是
  # @fission-ai/openspec —— npm 的裸名 `openspec` 是 0.0.0 空殼，別裝那個。小套件，
  # 同步裝即可；idempotent：已在 PATH 就跳過。只在 CCC 跑（mac-CC 自己管 local）。
  if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
    if command -v openspec >/dev/null 2>&1; then
      pass "openspec CLI 已存在，跳過安裝"
    else
      npm i -g @fission-ai/openspec@latest >/tmp/ccc-openspec-install.log 2>&1 \
        && pass "openspec CLI 安裝完成 ($(openspec --version 2>/dev/null | head -1))" \
        || warn "openspec CLI 安裝失敗" "見 /tmp/ccc-openspec-install.log"
    fi
  fi
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

# ── 9. Playwright browser（optional，給 UI 工作用）────────────────
# uiux-auditor / playwright-cli / verify 需要 chromium binary。CCC sandbox 不
# 預裝，--fix 會在背景補下載。這裡只回報狀態（warn 不擋 exit），讓 agent 開場
# 就知道現在能不能截圖、還是要再等一下背景下載。
section "9. Playwright browser"
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ls "$PW_CACHE"/chromium-* >/dev/null 2>&1; then
  pass "chromium 已裝 ($PW_CACHE)"
elif pgrep -f "playwright install chromium" >/dev/null 2>&1; then
  warn "chromium 背景下載中" "稍候再用 uiux-auditor / playwright-cli；log: /tmp/ccc-playwright-install.log"
else
  warn "chromium 未裝" "UI 工作前先跑 'node_modules/.bin/playwright install chromium'（或 --fix 在 CCC 會自動背景補）"
fi

# ── 10. 慢 gate（--full 才跑）────────────────────────────────────
if $FULL; then
  section "10. 慢 gate (--full)"
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
