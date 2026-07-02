## 1. Spec

- [x] 1.1 Add tribunal-publisher-autopilot spec requirements
- [x] 1.2 Define runtime apply / PR recovery / auto-merge / published reconciliation semantics

## 2. Implementation

- [x] 2.1 Add scripts/tribunal-publisher-autopilot.sh
- [x] 2.2 Reconcile merged publisher PRs back into published state
- [x] 2.3 Recover pushed publisher branches into PRs when PR creation failed earlier
- [x] 2.4 Convert draft publisher PRs to ready-for-review before merge attempts
- [x] 2.5 Invoke gu-log-auto-merge-guard.sh for eligible publisher PRs
- [x] 2.6 Wire autopilot into tribunal-quota-loop.sh

## 3. Verification

- [x] 3.1 bash scripts/tests/test-tribunal-publisher.sh
- [x] 3.2 bash scripts/tests/test-tribunal-publisher-autopilot.sh
- [x] 3.3 bash scripts/tests/test-auto-merge-guard.sh
- [x] 3.4 openspec validate wire-tribunal-publisher-autopilot --strict
