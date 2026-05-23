## Why

Tribunal runtime already has the two critical building blocks:

- tribunal-publisher.sh can materialize PASS artifacts from the ignored runtime ledger into a clean origin/main batch PR.
- gu-log-auto-merge-guard.sh can conservatively auto-merge low-risk PRs after required checks are green.

What is still missing is the wiring between them. Today, the publisher path exists, but an operator still has to notice stranded PASS artifacts, run publisher apply, watch CI, and merge manually. That means the failure mode changed from "no publish machinery" to "publish machinery exists but nobody pulled the lever."

This change closes that last gap.

## What Changes

- Add a tribunal-publisher-autopilot capability.
- Define a runtime autopilot that:
  - periodically runs publisher apply from the ignored runtime ledger,
  - opens or recovers publisher PRs,
  - transitions draft publisher PRs to ready-for-review,
  - invokes the existing auto-merge guard for safe content-only publisher PRs,
  - reconciles merged publisher batches back into terminal published state.
- Wire the autopilot into the long-running quota supervisor so publishing keeps progressing even while scoring is parked by quota debt.

## Impact

### Affected specs

- New capability: tribunal-publisher-autopilot
- Complements tribunal-safe-parallelism, because worker artifacts now need an automated lane from runtime ledger to main.
- Complements github-ai-automerge-guard, because autopilot relies on the existing conservative merge guard instead of bypassing branch protection.

### Affected code

- scripts/tribunal-publisher-autopilot.sh new
- scripts/tribunal-quota-loop.sh
- scripts/tests/test-tribunal-publisher-autopilot.sh new
- scripts/tests/test-tribunal-publisher.sh may need small fixture updates if state transitions change

## Non-Goals

- This change does not bypass CI or branch protection.
- This change does not auto-resolve editorial conflict events.
- This change does not publish FAILED, EXHAUSTED, or RUNNER_ERROR articles.
