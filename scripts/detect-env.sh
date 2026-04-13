#!/usr/bin/env bash
# detect-env.sh — 判斷這個 Claude Code instance 是 mac-CC 還是 CCC
#
# mac-CC (Local Claude Code):  user 個人 Mac，互動式 iterate
# CCC    (Cloud Claude Code):  Claude Code 網頁版，Linux 沙箱，auto-branch
#
# 用法：
#   ./scripts/detect-env.sh             # 印 mode (stdout) + 提示 (stderr)
#   mode=$(./scripts/detect-env.sh)     # 只拿 mode 字串
#
# 第一件事：任何 Claude session 開場就跑一下這個，確認自己是誰，
# 然後去讀對應的 playbook：
#   - mac-CC → .claude/playbooks/mac-CC-playbook.md
#   - CCC    → .claude/playbooks/CCC-playbook.md
#
# （mode 字串維持 CC / CCC 的 legacy 輸出，避免破壞舊 script。）

set -euo pipefail

branch="$(git branch --show-current 2>/dev/null || echo 'unknown')"
uname_s="$(uname -s)"
cwd="$(pwd)"

# CCC 判斷條件（三個都要中才算 CCC）：
#   1. branch 開頭是 claude/（harness 自動建的 branch）
#   2. 在 Linux 上（Mac 是 Darwin）
#   3. cwd 在 /home/user/ 底下（Claude Code web 的 sandbox 路徑）
ccc_branch=false
ccc_os=false
ccc_cwd=false
[[ "$branch" == claude/* ]] && ccc_branch=true
[[ "$uname_s" == "Linux" ]] && ccc_os=true
[[ "$cwd" == /home/user/* ]] && ccc_cwd=true

if $ccc_branch && $ccc_os && $ccc_cwd; then
  mode=CCC
else
  mode=CC
fi

echo "$mode"

# 提示訊息走 stderr，這樣 `mode=$(./scripts/detect-env.sh)` 只會拿到純 mode
{
  echo
  echo "env: branch=$branch os=$uname_s cwd=$cwd"
  if [[ "$mode" == "CCC" ]]; then
    cat <<'TIPS'

You are Cloud Claude Code (CCC).
  - Move fast, merge fast, fix fast — this branch is disposable
  - Self-merge after CI green; forward fix before revert
  - Quality gates (pre-commit, pre-push, Ralph Loop) are non-negotiable
  - FULL PLAYBOOK: .claude/playbooks/CCC-playbook.md ← read this next
TIPS
  else
    cat <<'TIPS'

You are Local Claude Code (mac-CC).
  - Observe env first: git worktree list, current branch, git status
  - User often uses worktrees — do NOT assume you're on main
  - Same yolo spirit as CCC; be independent, don't be a 伸手牌
  - FULL PLAYBOOK: .claude/playbooks/mac-CC-playbook.md ← read this next
TIPS
  fi
} >&2
