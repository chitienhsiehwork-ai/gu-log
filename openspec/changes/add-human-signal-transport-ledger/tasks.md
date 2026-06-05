## 1. Transport contract

- [ ] 1.1 Choose first storage backend and document why: backend-mediated GitHub storage or DB
- [ ] 1.2 Define first-party sync endpoint request/response schema
- [ ] 1.3 Define first-party agent packet endpoint query/response schema
- [ ] 1.4 Define remote event ledger schema, schema versioning, and migration rules
- [ ] 1.5 Define durable ack semantics: accepted/rejected event ids, retryability, watermark/etag
- [ ] 1.6 Define agent/operator auth model and CORS/session behavior
- [ ] 1.7 Confirm human-signal storage is separate from Reader Tracker Gist/store files

## 2. Client sync

- [ ] 2.1 Batch `local_only` and `sync_failed` events for upload
- [ ] 2.2 Mark events `synced` only after durable remote acknowledgement
- [ ] 2.3 Preserve event semantics when changing sync status
- [ ] 2.4 Add pagehide/best-effort sync strategy without blocking navigation

## 3. Backend / ledger

- [ ] 3.1 Implement backend-mediated writes; frontend SHALL NOT call GitHub/Gist directly
- [ ] 3.2 Implement append-only/deduped writes by `eventId`
- [ ] 3.3 Implement conflict-safe merge using storage revision/etag or DB transaction
- [ ] 3.4 Expose agent packet endpoint filtered by post identity and version/content version
- [ ] 3.5 Add private-body redaction/default exclusion for agent packets
- [ ] 3.6 Add integration test proving iPhone-created synced signals are queryable from agent context without browser/PAT

## 4. Trust and privacy

- [ ] 4.1 Assign owner/guest trust tier server-side
- [ ] 4.2 Prevent unknown/guest signals from becoming automation-authoritative
- [ ] 4.3 Separate public comment-derived signals from private first-party feedback
- [ ] 4.4 Redact or opt-in raw private comment text

## 5. Verification

- [ ] 5.1 Unit tests for event merge/dedupe
- [ ] 5.2 Integration test for upload + agent query
- [ ] 5.3 Manual iPhone smoke: read/share/abandon then query from Iris without Mac
