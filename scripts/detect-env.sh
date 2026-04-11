#!/usr/bin/env bash
# detect-env.sh — 判斷這個 Claude Code instance 是 CC 還是 CCC
#
# CC  (Local Claude Code):  Mac 本地端，user 在旁邊互動式 iterate
# CCC (Cloud Claude Code):  Claude Code 網頁版，Linux 沙箱，auto-branch
#
# 用法：
#   ./scripts/detect-env.sh             # 印 mode (stdout) + 提示 (stderr)
#   mode=$(./scripts/detect-env.sh)     # 只拿 mode 字串
#
# 第一件事：任何 Claude session 開場就跑一下這個，確認自己是誰、
# 哪套 playbook 要套。完整 playbook 見 CLAUDE.md 的
# "CC vs CCC: Who am I, and what can I do?" section。

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

You are Cloud Claude Code (CCC). Playbook:
  - Move fast, merge fast, fix fast — this branch is disposable
  - PR scope can be wide; commits inside stay atomic (revert-friendly)
  - Self-merge ONLY when all CI is green
  - Forward fix first; after 3 failed tries (spawn opus subagents), revert
  - Scope: touch related paths only, EXCEPT prod/CI emergencies (always fix)
  - Quality gates (pre-commit, pre-push, Ralph Loop) are non-negotiable
  - Full playbook: CLAUDE.md "CC vs CCC" section
TIPS
  else
    cat <<'TIPS'

You are Local Claude Code (CC). Playbook:
  - Observe env first: git worktree list, current branch, git status
  - User often uses worktrees — do NOT assume you're on main
  - User is nearby; ask before major refactors or risky operations
  - Full playbook: CLAUDE.md "CC vs CCC" section
TIPS
  fi
} >&2
