## 1. Implementation

- [x] 1.1 Add or confirm supervisor export for a shared lock directory rooted at the main repo, e.g. `TRIBUNAL_SHARED_LOCK_DIR=$ROOT_DIR/.score-loop/locks`.
- [x] 1.2 Add a cheap validation helper for post-writer rewrites.
- [x] 1.3 Replace post-writer full `pnpm run build` with cheap validation in the judge retry loop.
- [x] 1.4 Add final build gate after all judge stages pass and before article PASS is persisted.
- [x] 1.5 Ensure the shared lock directory exists with `mkdir -p` before `flock`.
- [x] 1.6 Wrap final build in blocking exclusive `flock` on the shared build lock.
- [x] 1.7 Scope timeout to `pnpm run build` after lock acquisition, not to lock waiting; use `timeout --kill-after` so child processes are reaped.
- [x] 1.8 Classify build failures before repair: content-actionable failures may call writer/fixer; operational/resource failures SHALL NOT spend writer tokens blindly.
- [x] 1.9 Add build-fix loop with max attempts and build log tail passed to writer/fixer only for actionable failures.
- [x] 1.10 Emit logs for waiting/acquired/released lock, build duration, and build rc.

## 2. Verification

- [x] 2.1 Run `openspec validate tribunal-final-build-gate --strict`.
- [x] 2.2 Run shell-level flock test with two concurrent commands against the chosen lock path.
- [ ] 2.3 Run a controlled Tribunal article that triggers writer rewrite and confirm no full build occurs immediately after writer unless final gate is reached.
- [ ] 2.4 Observe live processes and confirm at most one `astro.js build` at a time.
- [ ] 2.5 Confirm build failure blocks article PASS and enters bounded repair/failure path.
- [ ] 2.6 Confirm successful final build marks article PASS.

## 3. Operations

- [x] 3.1 Update Tribunal runbook/status notes with build lock troubleshooting commands.
- [x] 3.2 Document how to distinguish lock wait, build execution timeout, build syntax failure, and OOM/exit 137.
