## 1. Record the decision

- [x] 1.1 Decide: fact-check verification stays unconditional; the claim-free fast-path / skip is rejected. Rationale + rejected alternative + revisit criteria captured in `design.md`.
- [x] 1.2 Encode the decision as the living requirement in `tribunal-verification-scope` (spec delta) so a future conditional-verification proposal must delta it.

## 2. Make the decision discoverable outside openspec

- [x] 2.1 Add a one-line pointer comment in `.claude/agents/fact-checker.md` near the `accuracy` dimension: verification is unconditional by decision — do not add a claim-free skip/fast-path without deltaing `tribunal-verification-scope`; see `openspec/changes/archive/2026-07-16-reject-claim-free-factcheck-fastpath/design.md`. (So an editor touching the rubric directly, not via openspec, still hits the tripwire.)

## 3. Archive (sync the living requirement)

- [x] 3.1 `openspec archive -y reject-claim-free-factcheck-fastpath` → syncs `tribunal-verification-scope` into `openspec/specs/` and moves this change (with `design.md`) to `openspec/changes/archive/`. Commit in the same PR.
