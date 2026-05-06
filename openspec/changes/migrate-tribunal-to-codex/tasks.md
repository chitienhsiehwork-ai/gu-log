## 1. Recover clawd-vm stash work

- [x] 1.1 Confirm clawd-vm `~/clawd/projects/gu-log` stash subjects and commit ids for `stash@{1}` and `stash@{2}`
- [x] 1.2 Materialize `stash@{1}` into a disposable review branch/worktree without popping it onto `main`
- [x] 1.3 Materialize `stash@{2}` into a disposable review branch/worktree, including untracked files from `stash@{2}^3`
- [x] 1.4 Compare VM stash changes against current local dirty diff and mark which local changes are reconcile candidates

## 2. Migrate sp-pipeline runtime

- [x] 2.1 Apply the VM sp-pipeline Codex provider changes from `stash@{1}`
- [x] 2.2 Set default real writing/probe chain to Codex/GPT-5.5 medium reasoning
- [x] 2.3 Preserve or add deterministic output capture using `codex exec -o <tmp>` or a tested equivalent
- [x] 2.4 Remove stale Claude/Gemini/Opus runtime naming from user-facing logs and docs while preserving compatibility flags
- [x] 2.5 Run `go test ./...` inside `tools/sp-pipeline`

## 3. Migrate tribunal runtime

- [x] 3.1 Apply `scripts/tribunal.sh` from VM `stash@{2}^3` as the canonical runner
- [x] 3.2 Convert `scripts/tribunal-all-claude.sh` into a compatibility wrapper that delegates to `scripts/tribunal.sh`
- [x] 3.3 Ensure all four judge stages and writer repair run through Codex/GPT-5.5
- [x] 3.4 Ensure judge JSON is transferred through explicit score files and validated before frontmatter writes
- [x] 3.5 Fix stale Opus/Claude wording in runner headers, logs, stage labels, and progress metadata
- [x] 3.6 Fix the `vibe-scorer.sh` compatibility issue called out by the VM stash message
- [x] 3.7 Reconcile clawd-vm `codex/tribunal-v4-safety-hardening` safety controls without reverting GPT-5.5/Codex runtime naming

## 4. Add librarian evidence and glossary SSOT

- [x] 4.1 Apply `scripts/tribunal-librarian-packet.py` from VM `stash@{2}^3`
- [x] 4.2 Add `.codex/agents/librarian.toml` Codex override to consume the deterministic evidence packet first, without changing `.claude/agents/*.md` Claude Code frontmatter
- [x] 4.3 Add glossary entries for Andrej Karpathy, Simon Willison, and Boris Cherny
- [x] 4.4 Add aliases needed for identity linking and update glossary UI/config for `people`
- [x] 4.5 Add or update glossary concept entries for Software 3.0 and Agentic Engineering if missing

## 5. Smoke tests

- [ ] 5.1 Run `scripts/tribunal.sh --only-stage librarian <draft-post>` and verify related old posts appear in the packet
- [ ] 5.2 Run `scripts/tribunal.sh --only-stage vibe <draft-post>` and verify legacy `vibe-scorer.sh` can export JSON
- [ ] 5.3 Run an Andrej SP draft smoke test through sp-pipeline
- [x] 5.4 Run `node scripts/validate-posts.mjs`
- [x] 5.5 Run `pnpm run build`
- [x] 5.6 Run no-token Tribunal safety contract checks

Notes:
- `scripts/tribunal-librarian-packet.py /Users/shroom/gu-log/tmp/andrej-youtube-fetch/draft-v1.mdx` was run and produced old-post overlap evidence for Karpathy / Software 3.0 / Agentic Engineering. The full `tribunal.sh --only-stage librarian` LLM smoke remains unchecked to avoid mutating a real post outside a deliberate smoke fixture.
- Full LLM tribunal / sp-pipeline smoke tests remain unchecked because they spend live GPT-5.5 credits and can mutate post frontmatter.
- 2026-05-06: mac-cdx attempted the live `scripts/tribunal.sh --only-stage librarian sp-smoke-andrej-codex.mdx` smoke with a temporary fixture copied from `tmp/andrej-youtube-fetch/draft-v1.mdx`. The execution was rejected by the sandbox approval reviewer because it would export local draft/repo content to an external GPT-5.5/Codex service and mutate repo/progress state. Per security policy, do not bypass this with indirect execution. The temporary fixture was removed.
- 2026-05-06 19:00+08: mac-cdx rechecked clawd-vm after a 10-hour gap. VM had a new `codex/tribunal-v4-safety-hardening` branch plus `main` ahead by SP-190/counter commits. Reconciled the branch's useful safety controls locally: `--score-only`, `--allow-rewrite`, non-mutating `vibe-scorer.sh`, invalid-JSON fail-fast, Codex idle watchdog, no hook-bypass flags, no direct main push by default, and a static `scripts/tests/test-tribunal-safety-contract.sh`. Did not apply VM's Opus/Claude metadata changes to `.claude/agents/*.md`; Codex/GPT-5.5 runtime is now represented by `.codex/agents/*.toml` plus `scripts/tribunal.sh`.
