## Why

Tribunal quota-loop is useful as a quality gate, but it is also capable of drifting from "quality enforcement" into prolonged autonomous rewrite behavior. When that happens, the failure mode is not just token burn — it is corpus drift, review fatigue, and loss of trust in the pipeline.

Today gu-log has tribunal scripts and loop mechanics, but it does not have a written operational policy for when to:

- pause the loop immediately
- treat current rewrites as suspect
- roll back to a known-safe baseline
- decide whether restart is allowed

That gap means operational decisions are currently ad-hoc. This change records the policy as an OpenSpec artifact so future automation work has a human-reviewed operating boundary.

## What Changes

### New capability: `tribunal-ops-policy`

This change defines an operational policy for tribunal automation covering three phases:

- `pause`
- `rollback-review`
- `restart`

The policy specifies:

- when a running tribunal loop MUST be stopped
- what state counts as a drift / suspect state
- what files and outputs are considered untrusted until reviewed
- what evidence is required before tribunal may be resumed

### Pause policy

The system MUST support a manual stop decision when any of the following is observed:

- rewrites are broad and multi-post rather than local and targeted
- repeated rewrites are improving scores but degrading reading quality
- the loop is optimizing for pass-bar compliance over article quality
- the operator no longer trusts the rewrite direction

The policy treats operator trust loss as a valid stop condition, not a soft preference.

### Rollback / review policy

After a pause, the system MUST treat in-flight tribunal rewrites as review-required rather than implicitly accepted. The policy defines a rollback-review phase where changed posts are inspected before any automated continuation is allowed.

### Restart policy

Tribunal restart is not automatic. Restart requires explicit confirmation that:

- the root cause of drift has been identified
- a narrower rewrite mode or guardrail has been added
- the restart scope is bounded
- there is a visible kill-switch / pause path

### Out of scope

- implementing the guardrails in code right now
- changing current tribunal scores or prompt wording directly
- auto-reverting content changes automatically

This change is policy-first: it defines the operating rules before implementation.

## Impact

### Affected specs

- `tribunal-ops-policy`（new capability）

### Affected code / scripts

No code changes are required by this proposal alone. Future changes MAY update:

- `scripts/tribunal-quota-loop.sh`
- `scripts/tribunal-all-claude.sh`
- tribunal orchestrator prompts
- operational docs or runbooks

### Relationship to other OpenSpec changes

- complements `add-editorial-spine-rebuild`
- this change governs when automation must stop
- `add-editorial-spine-rebuild` governs how editorial rewrites should be shaped once automation is trusted again
