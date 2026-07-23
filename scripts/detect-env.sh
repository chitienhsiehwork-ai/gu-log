#!/usr/bin/env bash
# detect-env.sh — 判斷這個 coding-agent instance 的可路由 actor identity
#
# m1-cdx (example): M1 Mac 上的 Codex Desktop / Codex CLI
# m1-cc  (example): M1 Mac 上的 Claude Code-compatible local harness
# CCC              Cloud sandbox，auto-branch
#
# 用法：
#   ./scripts/detect-env.sh             # 印 mode (stdout) + 提示 (stderr)
#   mode=$(./scripts/detect-env.sh)     # 只拿 mode 字串
#   ./scripts/detect-env.sh --runtime codex --context
#   ./scripts/detect-env.sh --runtime claude-code --identity
#
# 第一件事：任何 agent session 開場就跑一下這個，確認自己是誰，
# 然後去讀對應的 playbook：
#   - local machine actor → playbooks/local-agent-playbook.md
#   - CCC              → playbooks/CCC-playbook.md
#
# （mode 字串維持 CC / CCC 的 legacy 輸出，避免破壞舊 script。）

set -euo pipefail

output_kind=mode
explicit_runtime=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --context) output_kind=context ;;
    --identity) output_kind=identity ;;
    --runtime)
      shift
      if [[ $# -eq 0 ]]; then
        echo "usage: $0 [--context|--identity] [--runtime codex|claude-code]" >&2
        exit 2
      fi
      explicit_runtime="$1"
      ;;
    *)
      echo "usage: $0 [--context|--identity] [--runtime codex|claude-code]" >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$output_kind" != "mode" && -z "$explicit_runtime" ]]; then
  echo "--context and --identity require --runtime codex|claude-code" >&2
  exit 2
fi

branch="$(git branch --show-current 2>/dev/null || echo 'unknown')"
uname_s="$(uname -s)"
cwd="$(pwd)"

detect_machine_id() {
  local configured_id="${GU_LOG_MACHINE_ID:-}"
  local chip=""

  if [[ -n "$configured_id" ]]; then
    if [[ ! "$configured_id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
      echo "invalid GU_LOG_MACHINE_ID: $configured_id" >&2
      return 2
    fi
    echo "$configured_id"
    return
  fi

  if [[ "$uname_s" == "Darwin" ]]; then
    chip="$(system_profiler SPHardwareDataType 2>/dev/null | awk -F ': ' '/Chip:/{print $2; exit}')"
    if [[ "$chip" =~ Apple[[:space:]]+M([0-9]+) ]]; then
      echo "m${BASH_REMATCH[1]}"
      return
    fi
    echo "mac"
    return
  fi

  echo "local"
}

machine_id="$(detect_machine_id)"

codex_runtime=false
case "$explicit_runtime" in
  codex) codex_runtime=true ;;
  claude-code) codex_runtime=false ;;
  "") ;;
  *)
    echo "invalid runtime: $explicit_runtime" >&2
    exit 2
    ;;
esac

# Claude Code on the web 以官方 CLAUDE_CODE_REMOTE=true 為第一訊號。三條
# branch/OS/cwd heuristic 保留給沒有該旗標的舊 harness：
#   1. branch 開頭是 claude/（harness 自動建的 branch）
#   2. 在 Linux 上（Mac 是 Darwin）
#   3. cwd 在 /home/user/ 底下（Claude Code web 的 sandbox 路徑）
claude_remote=false
[[ "$explicit_runtime" == "claude-code" && "${CLAUDE_CODE_REMOTE:-}" == "true" ]] && \
  claude_remote=true
ccc_branch=false
ccc_os=false
ccc_cwd=false
[[ "$branch" == claude/* ]] && ccc_branch=true
[[ "$uname_s" == "Linux" ]] && ccc_os=true
[[ "$cwd" == /home/user/* ]] && ccc_cwd=true

if $claude_remote || { $ccc_branch && $ccc_os && $ccc_cwd; }; then
  mode=CCC
  human_mode=CCC
  machine_id=cloud
elif $codex_runtime; then
  mode=CC
  human_mode="${machine_id}-cdx"
else
  mode=CC
  human_mode="${machine_id}-cc"
fi

if $codex_runtime; then
  runtime_id=codex
else
  runtime_id=claude-code
fi

if [[ "$mode" == "CCC" ]]; then
  environment_id=cloud
else
  environment_id=local
fi

emit_context() {
  echo
  echo "env: agent_id=$human_mode machine_id=$machine_id runtime=$runtime_id environment=$environment_id branch=$branch os=$uname_s cwd=$cwd"
  if [[ "$mode" == "CCC" ]]; then
    cat <<'TIPS'

You are Cloud Codex/Claude Code (CCC).
  - Move fast, merge fast, fix fast — this branch is disposable
  - Self-merge after CI green; forward fix before revert
  - Quality gates (pre-commit, pre-push, tribunal) are non-negotiable
  - FULL PLAYBOOK: playbooks/CCC-playbook.md ← read this next
TIPS
  elif $codex_runtime; then
    cat <<'TIPS'

You are a machine-addressable Local Codex Desktop / Codex CLI actor.
  - Observe env first: git worktree list, current branch, git status
  - User often uses worktrees — do NOT assume you're on main
  - Use Codex-native tools when available; do not assume Claude Code-only tooling
  - FULL PLAYBOOK: playbooks/local-agent-playbook.md
TIPS
  else
    cat <<'TIPS'

You are a machine-addressable Local Claude Code actor.
  - Observe env first: git worktree list, current branch, git status
  - User often uses worktrees — do NOT assume you're on main
  - Same yolo spirit as CCC; be independent, don't be a 伸手牌
  - FULL PLAYBOOK: playbooks/local-agent-playbook.md
TIPS
  fi
}

case "$output_kind" in
  context) emit_context ;;
  identity) echo "$human_mode" ;;
  mode)
    echo "$mode"
    if [[ -n "$explicit_runtime" ]]; then
      # 提示訊息走 stderr，這樣 `mode=$(...)` 仍只會拿到純 legacy mode。
      emit_context >&2
    else
      echo "runtime not specified; mode-only result. Re-run with --runtime codex|claude-code for authoritative actor context." >&2
    fi
    ;;
esac
