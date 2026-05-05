## 1. Verify current access and scopes

- [ ] 1.1 Confirm browser session is logged into GitHub account `chitienhsiehwork-ai`
- [ ] 1.2 Confirm current `gh` auth status on mac-cdx and clawd-vm
- [ ] 1.3 Record current gu-log remote owner and branch protection state without changing settings

## 2. Define and create safe token lanes

- [ ] 2.1 Create or refresh gu-log selected-repo token with no Administration permission
- [ ] 2.2 Confirm gu-log token cannot delete repo, transfer repo, alter visibility, change branch protection, or edit rulesets
- [ ] 2.3 Create or refresh separate AI lab token for sandbox/open-source experiments if needed
- [ ] 2.4 Store token values only in the approved secret store or environment, never in repo or machine notes

## 3. Protect gu-log repository

- [ ] 3.1 Configure gu-log main branch protection/ruleset to require PR and required checks
- [ ] 3.2 Ensure force push and branch deletion are blocked
- [ ] 3.3 Ensure the clawd-vm automation token cannot bypass branch protection
- [ ] 3.4 Document required check names for auto-merge guard

## 4. Implement auto-merge guard

- [ ] 4.1 Define low-risk path allowlist for content/glossary lane
- [ ] 4.2 Deny auto-merge for workflow, secret, deployment, branch protection, and guard-code paths
- [ ] 4.3 Require CI green and mergeable PR state before merge
- [ ] 4.4 Log auto-merge decisions with PR number, checks, paths, decision, and actor
- [ ] 4.5 Smoke test with a safe draft PR and a denied sensitive-path PR

## 5. Record machine-specific knowledge

- [ ] 5.1 Add local-only machine note for mac-cdx and clawd-vm context
- [ ] 5.2 Record that clawd-vm hosts Clawd (OpenClaw) and Iris (Hermes agent)
- [ ] 5.3 Record that this Mac holds the private SSH path/context needed for clawd-vm
- [ ] 5.4 Add a global Codex instruction pointer to the local-only machine note
- [ ] 5.5 Verify no token values or private keys were written
