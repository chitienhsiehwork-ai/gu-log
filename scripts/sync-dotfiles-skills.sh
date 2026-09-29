#!/usr/bin/env bash
# sync-dotfiles-skills.sh — 把 dotfiles 的共用 skill 鏡像到 .claude/skills/<name>/
#
# 正本在公開 repo ChiTienHsieh/dotfiles 的 skills/shared/<name>/。gu-log 只放鏡像，
# 因為雲端 session 不一定掛得到 dotfiles。要改 skill 就改 dotfiles，再跑這支同步；
# 直接改鏡像會被 CI 的 --check 擋。
#
# 用法：
#   bash scripts/sync-dotfiles-skills.sh              # 同步到 dotfiles main 最新版
#   bash scripts/sync-dotfiles-skills.sh --ref <sha>  # 同步到指定 commit
#   bash scripts/sync-dotfiles-skills.sh --check      # 鏡像要和釘住的 commit 完全一致（CI 用）
#   bash scripts/sync-dotfiles-skills.sh --check-latest  # 只提醒：dotfiles main 是否有新內容

set -euo pipefail

SKILLS=(level-up trim)
UPSTREAM_URL="${DOTFILES_UPSTREAM_URL:-https://github.com/ChiTienHsieh/dotfiles.git}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="sync"
REF="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --check-latest) MODE="check-latest" ;;
    --ref) REF="${2:?--ref 需要 commit 或 branch}"; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知參數：$1" >&2; exit 2 ;;
  esac
  shift
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

upstream_path() { echo "skills/shared/$1"; }
mirror() { echo "$ROOT/.claude/skills/$1"; }
pin_file() { echo "$ROOT/.claude/skills/$1.upstream"; }

# fetch_upstream <dir> <ref> — 只抓各 skill 目錄，印出實際 commit sha
fetch_upstream() {
  local dir="$TMP/$1" ref="$2" paths=() s
  for s in "${SKILLS[@]}"; do paths+=("$(upstream_path "$s")"); done
  git init -q "$dir"
  git -C "$dir" remote add origin "$UPSTREAM_URL"
  git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$ref"
  git -C "$dir" sparse-checkout set "${paths[@]}"
  git -C "$dir" checkout -q FETCH_HEAD
  git -C "$dir" rev-parse HEAD
}

pinned_sha() {
  local f
  f="$(pin_file "$1")"
  [ -f "$f" ] || { echo "找不到 $f，先跑一次同步" >&2; exit 1; }
  sed -n 's/^commit: //p' "$f"
}

status=0
case "$MODE" in
  sync)
    sha="$(fetch_upstream up "$REF")"
    for s in "${SKILLS[@]}"; do
      rm -rf "$(mirror "$s")"
      cp -R "$TMP/up/$(upstream_path "$s")" "$(mirror "$s")"
      printf '%s\n' \
        "# .claude/skills/$s/ 是 dotfiles 的鏡像，不要直接改；改 dotfiles 後跑 scripts/sync-dotfiles-skills.sh" \
        "repo: $UPSTREAM_URL" \
        "path: $(upstream_path "$s")" \
        "commit: $sha" >"$(pin_file "$s")"
      echo "已同步 $s skill → dotfiles@${sha:0:7}"
    done
    ;;
  check)
    for s in "${SKILLS[@]}"; do
      sha="$(pinned_sha "$s")"
      fetch_upstream "pin-$s" "$sha" >/dev/null
      if diff -r "$TMP/pin-$s/$(upstream_path "$s")" "$(mirror "$s")"; then
        echo "✓ $s 鏡像與 dotfiles@${sha:0:7} 一致"
      else
        echo "✗ .claude/skills/$s/ 和 dotfiles@${sha:0:7} 不一致。" >&2
        echo "  改 skill 請改 dotfiles，再跑 bash scripts/sync-dotfiles-skills.sh" >&2
        status=1
      fi
    done
    ;;
  check-latest)
    latest="$(fetch_upstream latest main)"
    for s in "${SKILLS[@]}"; do
      if diff -rq "$TMP/latest/$(upstream_path "$s")" "$(mirror "$s")" >/dev/null; then
        echo "✓ $s 鏡像已是 dotfiles main 最新內容"
      else
        echo "! $s 鏡像落後 dotfiles main（${latest:0:7}），跑 bash scripts/sync-dotfiles-skills.sh 更新" >&2
        status=1
      fi
    done
    ;;
esac
exit "$status"
