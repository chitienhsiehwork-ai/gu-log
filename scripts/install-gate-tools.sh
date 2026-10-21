#!/usr/bin/env bash
# install-gate-tools.sh — 安裝品質 gate 要用的 CLI：gitleaks、shellcheck（釘版本 + sha256 驗證）
#
# 為什麼存在：
#   CCC sandbox 不預裝這兩個工具。缺 gitleaks，pre-commit 會跳過 secret scan（只剩 push 後的
#   CI 擋）；缺 shellcheck，tests/hooks-integration.test.ts 的 ShellCheck case 在本機必 fail。
#   ccc-smoke-test.sh --fix 在 CCC 會自動呼叫這支；本機 Linux 也能手動跑，macOS 請用 brew。
#
# 版本對齊 CI：
#   - gitleaks：.github/workflows/ci.yml 的 GITLEAKS_VERSION（tests/install-gate-tools.test.ts 守一致）
#   - ShellCheck：CI runner（ubuntu-24.04 apt）的版本，unit-tests job 的 `shellcheck --version` 印得到
#   升版：改下面的版本號 + 各架構 sha256。gitleaks 用官方 checksums.txt；shellcheck release
#   沒附 checksum，自己下載後用 sha256sum 算。
#
# 用法：
#   bash scripts/install-gate-tools.sh                # 缺的或版本不對的才下載安裝（idempotent）
#   bash scripts/install-gate-tools.sh --check [TOOL]  # 只檢查 PATH 上的工具是不是釘選版，不安裝
#
# 安裝位置：$GATE_TOOLS_BIN_DIR（預設 /usr/local/bin）。
# Exit：0 = 全部就緒；1 = 有工具缺、版本不對或安裝失敗；2 = 參數錯誤。

set -euo pipefail

GITLEAKS_VERSION=8.30.1
SHELLCHECK_VERSION=0.9.0
TOOLS=(gitleaks shellcheck)
BIN_DIR="${GATE_TOOLS_BIN_DIR:-/usr/local/bin}"

pinned() {
  case "$1" in
    gitleaks) echo "$GITLEAKS_VERSION" ;;
    shellcheck) echo "$SHELLCHECK_VERSION" ;;
    *) return 1 ;;
  esac
}

# release <tool> <uname -m> → "下載網址 sha256 壓縮檔內的執行檔路徑"
release() {
  local gl="https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION/gitleaks_${GITLEAKS_VERSION}_linux"
  local sc="https://github.com/koalaman/shellcheck/releases/download/v$SHELLCHECK_VERSION/shellcheck-v$SHELLCHECK_VERSION.linux"
  case "$1:$2" in
    gitleaks:x86_64) echo "${gl}_x64.tar.gz 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb gitleaks" ;;
    gitleaks:aarch64) echo "${gl}_arm64.tar.gz e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 gitleaks" ;;
    shellcheck:x86_64) echo "$sc.x86_64.tar.xz 700324c6dd0ebea0117591c6cc9d7350d9c7c5c287acbad7630fa17b1d4d9e2f shellcheck-v$SHELLCHECK_VERSION/shellcheck" ;;
    shellcheck:aarch64) echo "$sc.aarch64.tar.xz 179c579ef3481317d130adebede74a34dbbc2df961a70916dd4039ebf0735fae shellcheck-v$SHELLCHECK_VERSION/shellcheck" ;;
    *) return 1 ;;
  esac
}

# version_of <執行檔> <tool> → 印出版本號；跑不起來就印空字串
version_of() {
  case "$2" in
    gitleaks) { "$1" version 2>/dev/null || true; } | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true ;;
    shellcheck) { "$1" --version 2>/dev/null || true; } | sed -n 's/^version: //p' | head -1 ;;
  esac
}

hint() { echo "Linux 跑 'bash scripts/install-gate-tools.sh'；macOS 用 'brew install $1'"; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# check <tool>：PATH 上的 <tool> 是不是釘選版。印一行結果給 smoke test 當 pass / warn 訊息。
check() {
  local tool="$1" want path ver
  want="$(pinned "$tool")"
  if ! path="$(command -v "$tool" 2>/dev/null)"; then
    echo "$tool 不在 PATH — $(hint "$tool")"
    return 1
  fi
  ver="$(version_of "$path" "$tool")"
  if [ "$ver" = "$want" ]; then
    echo "$tool $ver ($path)"
    return 0
  fi
  echo "$tool ${ver:-版本不明} ($path) 不是釘選的 $want — 結果可能跟 CI 不同；$(hint "$tool")"
  return 1
}

# install_tool <tool> <工作目錄>：$BIN_DIR 裡已是釘選版就跳過；否則下載、驗 sha256、裝進 $BIN_DIR。
install_tool() {
  local tool="$1" work="$2/$1" want spec url sum member actual
  want="$(pinned "$tool")"
  if [ -x "$BIN_DIR/$tool" ] && [ "$(version_of "$BIN_DIR/$tool" "$tool")" = "$want" ]; then
    echo "✓ $tool $want 已在 $BIN_DIR，跳過"
    return 0
  fi
  if [ "$(uname -s)" != "Linux" ] || ! spec="$(release "$tool" "$(uname -m)")"; then
    echo "✗ $tool：沒有 $(uname -s)/$(uname -m) 的釘選 release — $(hint "$tool")" >&2
    return 1
  fi
  read -r url sum member <<<"$spec"
  # 每個壓縮檔放自己的空目錄，只解出需要的那一個執行檔。
  mkdir -p "$work"
  if ! curl -fsSL --retry 2 --connect-timeout 10 --max-time 60 -o "$work/archive" "$url"; then
    echo "✗ $tool：下載失敗 ($url)" >&2
    return 1
  fi
  actual="$(sha256_of "$work/archive")"
  if [ "$actual" != "$sum" ]; then
    echo "✗ $tool：sha256 不符，拒絕安裝（預期 $sum，實際 $actual）" >&2
    return 1
  fi
  if ! tar -xf "$work/archive" -C "$work" "$member"; then
    echo "✗ $tool：解壓縮失敗" >&2
    return 1
  fi
  if ! mkdir -p "$BIN_DIR" || ! install -m 0755 "$work/$member" "$BIN_DIR/$tool"; then
    echo "✗ $tool：無法寫入 $BIN_DIR（可設 GATE_TOOLS_BIN_DIR 換位置）" >&2
    return 1
  fi
  echo "✓ $tool $(version_of "$BIN_DIR/$tool" "$tool") 安裝到 $BIN_DIR"
}

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  -h | --help)
    usage
    ;;
  --check)
    shift
    [ "$#" -gt 0 ] || set -- "${TOOLS[@]}"
    rc=0
    for tool in "$@"; do
      if ! pinned "$tool" >/dev/null; then
        echo "unknown tool: $tool（可用：${TOOLS[*]}）" >&2
        exit 2
      fi
      check "$tool" || rc=1
    done
    exit "$rc"
    ;;
  "")
    WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gu-log-gate-tools.XXXXXX")"
    trap 'rm -rf "$WORK_DIR"' EXIT
    rc=0
    for tool in "${TOOLS[@]}"; do
      install_tool "$tool" "$WORK_DIR" || rc=1
    done
    exit "$rc"
    ;;
  *)
    echo "unknown arg: $1 (try --help)" >&2
    exit 2
    ;;
esac
