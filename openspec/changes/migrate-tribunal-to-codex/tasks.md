## 1. Recover clawd-vm stash work

- [ ] 1.1 Confirm clawd-vm `~/clawd/projects/gu-log` stash subjects and commit ids for `stash@{1}` and `stash@{2}`
- [ ] 1.2 Materialize `stash@{1}` into a disposable review branch/worktree without popping it onto `main`
- [ ] 1.3 Materialize `stash@{2}` into a disposable review branch/worktree, including untracked files from `stash@{2}^3`
- [ ] 1.4 Compare VM stash changes against current local dirty diff and mark which local changes are reconcile candidates

## 2. Migrate sp-pipeline runtime

- [ ] 2.1 Apply the VM sp-pipeline Codex provider changes from `stash@{1}`
- [ ] 2.2 Set default real writing/probe chain to Codex/GPT-5.5 medium reasoning
- [ ] 2.3 Preserve or add deterministic output capture using `codex exec -o <tmp>` or a tested equivalent
- [ ] 2.4 Remove stale Claude/Gemini/Opus runtime naming from user-facing logs and docs while preserving compatibility flags
- [ ] 2.5 Run `go test ./...` inside `tools/sp-pipeline`

## 3. Migrate tribunal runtime

- [ ] 3.1 Apply `scripts/tribunal.sh` from VM `stash@{2}^3` as the canonical runner
- [ ] 3.2 Convert `scripts/tribunal-all-claude.sh` into a compatibility wrapper that delegates to `scripts/tribunal.sh`
- [ ] 3.3 Ensure all four judge stages and writer repair run through Codex/GPT-5.5
- [ ] 3.4 Ensure judge JSON is transferred through explicit score files and validated before frontmatter writes
- [ ] 3.5 Fix stale Opus/Claude wording in runner headers, logs, stage labels, and progress metadata
- [ ] 3.6 Fix the `vibe-scorer.sh` compatibility issue called out by the VM stash message

## 4. Add librarian evidence and glossary SSOT

- [ ] 4.1 Apply `scripts/tribunal-librarian-packet.py` from VM `stash@{2}^3`
- [ ] 4.2 Update `.claude/agents/librarian.md` to consume the deterministic evidence packet first
- [ ] 4.3 Add glossary entries for Andrej Karpathy, Simon Willison, and Boris Cherny
- [ ] 4.4 Add aliases needed for identity linking and update glossary UI/config for `people`
- [ ] 4.5 Add or update glossary concept entries for Software 3.0 and Agentic Engineering if missing

## 5. Smoke tests

- [ ] 5.1 Run `scripts/tribunal.sh --only-stage librarian <draft-post>` and verify related old posts appear in the packet
- [ ] 5.2 Run `scripts/tribunal.sh --only-stage vibe <draft-post>` and verify legacy `vibe-scorer.sh` can export JSON
- [ ] 5.3 Run an Andrej SP draft smoke test through sp-pipeline
- [ ] 5.4 Run `node scripts/validate-posts.mjs`
- [ ] 5.5 Run `pnpm run build`
