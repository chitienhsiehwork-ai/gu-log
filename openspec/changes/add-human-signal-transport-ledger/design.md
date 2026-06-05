## Design

### Data flow

```
Browser capture
  └─ gu-log-human-signals local queue
       └─ first-party authenticated sync
            └─ remote append-only ledger
                 ├─ agent query
                 └─ per-post signal packet
```

### Required frontend/backend contract

The frontend SHALL NOT write human-signal events directly to GitHub, Gist, or a raw storage URL. Normal sync SHALL call a first-party gu-log endpoint using the gu-log authenticated session.

Initial endpoint contract:

- `POST /api/human-signals/sync`
  - Auth: gu-log session cookie or `Authorization: Bearer <gu-log-session-jwt>`; not a GitHub PAT.
  - Request body:
    - `clientBatchId`
    - `events[]`
    - `clientStoreVersion`
  - Response body:
    - `ledgerSchemaVersion`
    - `acceptedEventIds[]`
    - `rejectedEvents[]` with stable machine-readable error codes
    - `serverAssignedTrustByEventId`
    - `durableWatermark` or storage revision/etag
    - optional `retryAfterSeconds`
  - The client SHALL mark an event `synced` only when its `eventId` appears in `acceptedEventIds`.

- `GET /api/human-signals/packet`
  - Auth: operator/agent-readable gu-log credential; public anonymous reads SHALL NOT expose private/editorial signals.
  - Query params:
    - `postId`
    - `pathname`
    - `postVersion`
    - optional `contentVersion`
    - optional `includePrivateBody=false`
  - Response body SHALL be deterministic and storage-backend-independent.

Storage MAY be private Gist, private repo JSONL, or DB, but that choice SHALL remain behind the first-party API boundary.

### Minimal storage options

1. Backend-mediated private Gist / GitHub file
   - Lowest infra jump from current reader tracker sync.
   - Needs conflict-safe merge and eventId dedupe.
2. Private repo JSONL
   - Better auditability; more commit noise.
3. First-party DB behind `api.shroomdog.dev`
   - Best long-term; more infra.

Recommendation: spec should allow backend-mediated GitHub-backed ledger first, but require the API contract to hide storage details from frontend/agents.

### Ledger event fields

Each persisted ledger event SHALL include at least:

- `ledgerSchemaVersion`
- original `eventSchemaVersion`
- `eventId`
- `kind`
- `postId`
- `lang`
- canonical `pathname`
- `postVersion`
- `postVersionKind`
- optional `contentVersion`
- optional `contentHash`
- `occurredAt`
- `receivedAt`
- `clientSyncSource`
- `sourceVisibility`: `public`, `private`, `operator_only`, or `source_managed`
- `source`: e.g. `giscus`, `first_party`, `reader_tracker`, `share_ui`
- `clientReaderTrustTier` when present
- `serverTrustTier`
- `automationAuthoritative`
- durable ledger status
- optional `resolutionState` for feedback capable of driving Tribunal
- raw body fields only when permitted by visibility/redaction policy

### Trust

Client-provided `readerTrustTier` is not enough for automation. Server must assign or confirm owner/guest tier from authenticated identity or explicit owner approval. Browser classification is advisory only; agent/Tribunal automation reads `serverTrustTier` and `automationAuthoritative` from the ledger packet.

### iPhone-only reality

Iris can observe only synced signals. If a browser captured an event but never synced it before closing, no agent can read it. The UI should show pending/failed clearly.

### Privacy

- Avoid raw private comment text unless explicitly opted in for that query/export.
- Keep public Giscus-derived data separate from private first-party/editorial signals.
- Store opaque reader IDs rather than raw emails where possible.
