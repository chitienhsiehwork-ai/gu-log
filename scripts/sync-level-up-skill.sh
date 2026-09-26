#!/usr/bin/env bash
# sync-level-up-skill.sh — 把 dotfiles 的 level-up skill 鏡像到 .claude/skills/level-up/
#
# 正本在公開 repo ChiTienHsieh/dotfiles 的 skills/shared/level-up/（含學習紀錄）。
# gu-log 只放鏡像，因為雲端 session 不一定掛得到 dotfiles。要改 skill 或學習紀錄就改
# dotfiles，再跑這支同步；不要直接改鏡像，CI 的 --check 會擋。
#
# 用法：
#   bash scripts/sync-level-up-skill.sh              # 同步到 dotfiles main 最新版
#   bash scripts/sync-level-up-skill.sh --ref <sha>  # 同步到指定 commit
#   bash scripts/sync-level-up-skill.sh --check      # 鏡像要和釘住的 commit 完全一致（CI 用）
#   bash scripts/sync-level-up-skill.sh --check-latest  # 只提醒：dotfiles main 是否有新內容

set -euo pipefail

UPSTREAM_URL="${LEVEL_UP_UPSTREAM_URL:-https://github.com/ChiTienHsieh/dotfiles.git}"
UPSTREAM_PATH="skills/shared/level-up"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRROR="$ROOT/.claude/skills/level-up"
PIN_FILE="$ROOT/.claude/skills/level-up.upstream"

MODE="sync"
REF="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check" ;;
    --check-latest) MODE="check-latest" ;;
    --ref) REF="${2:?--ref 需要 commit 或 branch}"; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "未知參數：$1" >&2; exit 2 ;;
  esac
  shift
done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# fetch_upstream <ref> — 只抓 level-up 目錄，印出實際 commit sha
fetch_upstream() {
  local ref="$1"
  git -C "$TMP" init -q upstream
  git -C "$TMP/upstream" remote add origin "$UPSTREAM_URL"
  git -C "$TMP/upstream" fetch -q --depth 1 --filter=blob:none origin "$ref"
  git -C "$TMP/upstream" sparse-checkout set "$UPSTREAM_PATH"
  git -C "$TMP/upstream" checkout -q FETCH_HEAD
  git -C "$TMP/upstream" rev-parse HEAD
}

pinned_sha() {
  [ -f "$PIN_FILE" ] || { echo "找不到 $PIN_FILE，先跑一次同步" >&2; exit 1; }
  sed -n 's/^commit: //p' "$PIN_FILE"
}

case "$MODE" in
  sync)
    sha="$(fetch_upstream "$REF")"
    rm -rf "$MIRROR"
    cp -R "$TMP/upstream/$UPSTREAM_PATH" "$MIRROR"
    printf '%s\n' \
      "# .claude/skills/level-up/ 是 dotfiles 的鏡像，不要直接改；改 dotfiles 後跑 scripts/sync-level-up-skill.sh" \
      "repo: $UPSTREAM_URL" \
      "path: $UPSTREAM_PATH" \
      "commit: $sha" >"$PIN_FILE"
    echo "已同步 level-up skill → dotfiles@${sha:0:7}"
    ;;
  check)
    sha="$(pinned_sha)"
    fetch_upstream "$sha" >/dev/null
    if ! diff -r "$TMP/upstream/$UPSTREAM_PATH" "$MIRROR"; then
      echo "✗ .claude/skills/level-up/ 和 dotfiles@${sha:0:7} 不一致。" >&2
      echo "  改 skill 請改 dotfiles，再跑 bash scripts/sync-level-up-skill.sh" >&2
      exit 1
    fi
    echo "✓ level-up 鏡像與 dotfiles@${sha:0:7} 一致"
    ;;
  check-latest)
    sha="$(pinned_sha)"
    latest="$(fetch_upstream main)"
    if [ "$latest" = "$sha" ] || diff -rq "$TMP/upstream/$UPSTREAM_PATH" "$MIRROR" >/dev/null; then
      echo "✓ level-up 鏡像已是 dotfiles main 最新內容"
    else
      echo "! level-up 鏡像落後 dotfiles main（${latest:0:7}），跑 bash scripts/sync-level-up-skill.sh 更新" >&2
      exit 1
    fi
    ;;
esac
