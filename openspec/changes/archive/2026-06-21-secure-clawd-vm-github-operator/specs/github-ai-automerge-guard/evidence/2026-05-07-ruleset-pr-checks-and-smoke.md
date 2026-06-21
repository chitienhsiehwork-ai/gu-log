# Evidence: ruleset、PR checks、auto-merge guard smoke

Date: 2026-05-07  
Scope: `secure-clawd-vm-github-operator` / `github-ai-automerge-guard`

## Branch Rulesets

`protect-main-pr-ci` ruleset 目前為 active，target 是 default branch：

```text
id=16036958
name=protect-main-pr-ci
enforcement=active
target=branch
conditions.ref_name.include=["~DEFAULT_BRANCH"]
bypass_actors=[]
rules:
- deletion
- non_fast_forward
- pull_request
- required_status_checks: ci-passed, strict_required_status_checks_policy=true
```

另一個 active ruleset `protect main` 也套在 default branch，包含：

```text
id=15204077
name=protect main
enforcement=active
bypass_actors=[]
rules:
- deletion
- non_fast_forward
```

## PR #187 Checks

PR #187 `Codex migration: tribunal, pipeline, and GitHub guardrails` 目前：

- state: `OPEN`
- draft: `false`
- mergeable: `MERGEABLE`
- base: `main`
- head: `codex-openspec-codex-migration`
- checks: `ci-passed`、build、lint、type-check、security-gate、unit-tests、validate-content、internal-links、bundle-budget、CodeQL、Vercel 全部 success
- `smoke-test` 為 workflow condition 下的 skipped，不是 failure

## Smoke PR Cleanup

real GitHub PR smoke test 使用兩個短命 draft PR：

- `#189` safe path：`smoke/guard-safe-20260507003541`
- `#190` sensitive path：`smoke/guard-sensitive-20260507003541`

目前 GitHub PR 狀態：

```text
#189 state=CLOSED isDraft=true base=main head=smoke/guard-safe-20260507003541
#190 state=CLOSED isDraft=true base=main head=smoke/guard-sensitive-20260507003541
```

remote branches 已確認刪除：

```text
smoke/guard-safe-20260507003541=deleted
smoke/guard-sensitive-20260507003541=deleted
```

## Local Guard Test

`bash scripts/tests/test-auto-merge-guard.sh`：

```text
auto-merge guard smoke tests passed
```

## Review Notes

- Auto-merge guard evidence 同時需要 GitHub-side ruleset 與 local guard tests；只看 CI green 不夠。
- `.github/**`、lockfile、guard script 自身仍應維持 human-review path。
