## 1. Viewer helpers

- [ ] 1.1 Add helper to summarize human signal store by kind and sync status
- [ ] 1.2 Add helper to export/copy all or pending human signals as JSON
- [ ] 1.3 Add tests for corrupted/empty store viewer behavior

## 2. UI

- [ ] 2.1 Add Human Signals panel to `/reading-tracker` or a dedicated authenticated route
- [ ] 2.2 Show recent events with article identity, version, kind, confidence, trust tier, sync status
- [ ] 2.3 Show low-confidence abandon candidates as suspected/unknown, not final judgment
- [ ] 2.4 Show share intent as strong reaction with unknown polarity by default
- [ ] 2.5 Add copy/export pending packet affordance

## 3. Read-state consistency

- [ ] 3.1 Decide dashboard manual mark-read behavior: create human signal or explicitly tracker-only
- [ ] 3.2 Cover bulk mark-read behavior in tests or mark out of scope in UI copy

## 4. Verification

- [ ] 4.1 Unit tests for summary/export helpers
- [ ] 4.2 UI contract test for viewer fields
- [ ] 4.3 Manual smoke on iPhone-sized viewport
