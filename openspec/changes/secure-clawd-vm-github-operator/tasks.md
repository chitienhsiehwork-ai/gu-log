## 1. Verify current access and scopes

- [x] 1.1 Confirm browser session is logged into GitHub account `chitienhsiehwork-ai`
- [x] 1.2 Confirm current `gh` auth status on mac-cdx and clawd-vm
- [x] 1.3 Record current gu-log remote owner and branch protection state without changing settings

## 2. Define and create safe token lanes

- [ ] 2.1 Create or confirm new AI lab GitHub org, preferred name `shroomdog-ai-lab`
- [ ] 2.2 Create or refresh broad Iris / Clawd operator token scoped only to the AI lab org
- [ ] 2.3 Confirm broad AI lab token does not include `chitienhsiehwork-ai/gu-log`
- [ ] 2.4 Create or refresh gu-log selected-repo token with Contents write, Pull requests write, Issues write, Metadata read, and Actions/checks read as needed
- [ ] 2.5 Confirm gu-log token has no Administration, no Workflows write, and no Secrets/Variables write
- [ ] 2.6 Confirm gu-log token cannot delete repo, transfer repo, alter visibility, change branch protection, edit rulesets, or edit `.github/workflows/**`
- [ ] 2.7 Store token values only in the approved secret store or environment, never in repo or machine notes

## 3. Protect gu-log repository

- [ ] 3.1 Configure gu-log main branch protection/ruleset to require PR and required checks
- [ ] 3.2 Ensure force push and branch deletion are blocked
- [ ] 3.3 Ensure the clawd-vm automation token cannot bypass branch protection
- [ ] 3.4 Ensure branch must be up to date before merge
- [x] 3.5 Document required check names for auto-merge guard

## 4. Implement auto-merge guard

- [x] 4.1 Define low-risk path allowlist for content/glossary lane
- [x] 4.2 Deny auto-merge for `.github/**`, workflow, secret, deployment, branch protection, package manager config/lockfile, auth/env handling, and guard-code paths
- [x] 4.3 Require CI green, branch up to date, and mergeable PR state before merge
- [x] 4.4 Use GitHub auto-merge via squash merge and delete branch for allowed PRs
- [x] 4.5 Log auto-merge decisions with PR number, checks, paths, decision, and actor
- [ ] 4.6 Smoke test with a safe draft PR and a denied sensitive-path PR

## 5. Record machine-specific knowledge

- [x] 5.1 Add local-only machine note for mac-cdx and clawd-vm context
- [x] 5.2 Record that clawd-vm hosts Clawd (OpenClaw) and Iris (Hermes agent)
- [x] 5.3 Record that this Mac holds the private SSH path/context needed for clawd-vm
- [x] 5.4 Add a global Codex instruction pointer to the local-only machine note
- [x] 5.5 Verify no token values or private keys were written

Notes:
- Browser session was confirmed logged into GitHub as `chitienhsiehwork-ai`; the user also provided a screenshot of `https://github.com/chitienhsiehwork-ai/gu-log/settings/branches`.
- mac-cdx `gh auth status` and clawd-vm `gh auth status` both currently report invalid tokens for `chitienhsiehwork-ai`. A mac-cdx `gh auth login -h github.com -p https -w -s repo,workflow,admin:repo_hook` attempt reached GitHub device verification, but the browser required session verification; the flow was stopped without exposing any token.
- `origin` currently points at `https://github.com/chitienhsiehwork-ai/gu-log.git`.
- Branch settings screenshot on 2026-05-06 showed: "Classic branch protections have not been configured" for gu-log. Branch protection/ruleset mutation remains unchecked because the authenticated API token is invalid and browser automation cannot safely complete session verification autonomously.
- Required branch-protection check name should be `ci-passed` from workflow `PR Fast Gate` (`.github/workflows/ci.yml`). This aggregate job depends on lockfile, lint, type-check, contrast, validate-content, security-gate, unit-tests, build, internal-links, and bundle-budget.
- `scripts/gu-log-auto-merge-guard.sh` implements the local guard: PR must be open, non-draft, base `main`, GitHub-mergeable, required checks green, and changed paths allowlisted. It runs `gh pr merge --auto --squash --delete-branch` only after the guard passes.
- `scripts/tests/test-auto-merge-guard.sh` smoke-tests the local guard with an allowed content/glossary PR, a denied `.github/**` PR, a denied lockfile PR, and a denied failing-check PR. The remaining 4.6 task is specifically a real GitHub PR smoke once safe credentials/rulesets exist.
- AI lab org creation, token creation, token scope verification, branch protection changes, and real GitHub PR auto-merge guard smoke tests remain intentionally unchecked because they require session verification / one-time token handling that must not leak into repo, machine notes, or chat context.
