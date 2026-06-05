## Human Review Summary

This change asks whether gu-log should make captured human signals durable and agent-queryable after they leave the browser. Local-only signals are not enough for iPhone-first use: Iris/Tribunal can only review evidence that has synced to a remote ledger or backend-mediated storage path.

The important safety boundary is that transport makes evidence observable; it does not by itself make every signal automation-authoritative. Trust assignment remains server-side / owner-approved, and raw browser-held GitHub PATs are not part of the normal sync path.

## Review Decision Requested

Approve this change if ShroomDog agrees that:

- human signal events should have a durable remote ledger or backend-mediated storage path;
- Iris/Tribunal should be able to query deterministic per-post signal packets;
- sync success must require durable acknowledgement;
- guest/unknown signals remain reference evidence unless verified or owner-approved;
- private feedback/comment text needs explicit provenance and redaction/opt-in handling.

Not approved by this change:

- automatic Tribunal rewrite/requeue policy;
- exposing raw GitHub storage credentials to browsers;
- changing Reader Tracker sync semantics beyond keeping human-signal storage separate.

## Why

LocalStorage signals are useful only while the browser that captured them is available. ShroomDog wants to use iPhone normally and ask Iris to observe gu-log signals later, without opening a Mac or DevTools.

That requires an agent-observable transport: once a signal is captured and synced, Iris/Tribunal can query it from server-side storage or a GitHub-backed ledger.

## What Changes

- Define a durable, queryable human signal transport/ledger.
- Client batches pending human signal events to a first-party authenticated backend endpoint.
- Server/transport dedupes by `eventId` and exposes deterministic per-post packets.
- Server-side identity/trust assignment determines what is automation-authoritative.
- Browser-held PAT/raw GitHub token is not required for normal sync.

## Capabilities

### New Capabilities

- `human-signal-transport-ledger`: defines the durable remote ledger, upload acknowledgement, idempotent merge, per-post query packet, backend-mediated credential boundary, and privacy/trust transport rules for synced human signal events.

### Related Existing Capabilities

- `human-finishability-signals`: already requires human signal transport to be explicit and queryable; this change refines that requirement into a concrete ledger/query contract.
- `versioned-human-feedback`: remains the feedback/comment version-binding contract; this change only defines transport/query behavior for synced events.

## Impact

- Frontend: pending event batching, sync status updates, possible beacon/fetch on pagehide.
- Backend/ops: first-party sync/query contract with storage choice hidden behind the API boundary.
- Agent: Iris can query synced signals from iPhone-only usage.
- Out of scope: actual Tribunal rewrite/requeue policy; this change only makes evidence observable and queryable.
