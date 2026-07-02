## 1. Recover clawd-vm stash work

- [x] 1.1 確認 clawd-vm `~/clawd/projects/gu-log` 內 `stash@{1}` 與 `stash@{2}` 的 stash subjects 與 commit ids
- [x] 1.2 將 `stash@{1}` materialize 到 disposable review branch/worktree，不直接 pop 到 `main`
- [x] 1.3 將 `stash@{2}` materialize 到 disposable review branch/worktree，包含 `stash@{2}^3` 的 untracked files
- [x] 1.4 比對 VM stash changes 與目前 local dirty diff，標記哪些 local changes 是 reconcile candidates

## 2. Migrate sp-pipeline runtime

- [x] 2.1 套用 VM `stash@{1}` 中的 sp-pipeline Codex provider changes
- [x] 2.2 將預設正式 writing/probe chain 設為 Codex/GPT-5.5 medium reasoning
- [x] 2.3 保留或新增 deterministic output capture，使用 `codex exec -o <tmp>` 或 tested equivalent
- [x] 2.4 移除 user-facing logs 與 docs 中 stale Claude/Gemini/Opus runtime naming，同時保留 compatibility flags
- [x] 2.5 在 `tools/sp-pipeline` 內執行 `go test ./...`

## 3. Migrate tribunal runtime

- [x] 3.1 從 VM `stash@{2}^3` 套用 `scripts/tribunal.sh` 作為 canonical runner
- [x] 3.2 將 `scripts/tribunal-all-claude.sh` 轉為 compatibility wrapper，delegate 到 `scripts/tribunal.sh`
- [x] 3.3 確認四個 judge stages 與 writer repair 都透過 Codex/GPT-5.5 執行
- [x] 3.4 確認 judge JSON 透過 explicit score files 傳遞，並在 frontmatter writes 前驗證
- [x] 3.5 修正 runner headers、logs、stage labels、progress metadata 內 stale Opus/Claude wording
- [x] 3.6 修正 VM stash message 指出的 `vibe-scorer.sh` compatibility issue
- [x] 3.7 Reconcile clawd-vm `codex/tribunal-v4-safety-hardening` safety controls，且不 revert GPT-5.5/Codex runtime naming

## 4. 新增 librarian evidence 與 glossary SSOT

- [x] 4.1 從 VM `stash@{2}^3` 套用 `scripts/tribunal-librarian-packet.py`
- [x] 4.2 新增 `.codex/agents/librarian.toml` Codex override，讓 Librarian 先 consume deterministic evidence packet，且不改 `.claude/agents/*.md` Claude Code frontmatter
- [x] 4.3 新增 Andrej Karpathy、Simon Willison、Boris Cherny 的 glossary entries
- [x] 4.4 新增 identity linking 所需 aliases，並更新 glossary UI/config 以支援 `people`
- [x] 4.5 若 Software 3.0 與 Agentic Engineering concept entries 缺失，新增或更新

## 5. Smoke tests

- [ ] 5.1 執行 `scripts/tribunal.sh --only-stage librarian <draft-post>`，確認 related old posts 會出現在 packet
- [ ] 5.2 執行 `scripts/tribunal.sh --only-stage vibe <draft-post>`，確認 legacy `vibe-scorer.sh` 可 export JSON
- [ ] 5.3 用 Andrej SP draft 跑 sp-pipeline smoke test
- [x] 5.4 執行 `node scripts/validate-posts.mjs`
- [x] 5.5 執行 `pnpm run build`
- [x] 5.6 執行 no-token Tribunal safety contract checks

Notes:
- Detailed evidence now lives next to each spec:
  - `specs/codex-tribunal-runtime/evidence/2026-05-07-runtime-boundary-and-safety.md`
  - `specs/codex-exec-writing-runtime/evidence/2026-05-07-sp-pipeline-tests.md`
  - `specs/librarian-crossref-evidence/evidence/2026-05-07-andrej-librarian-packet.md`
  - `specs/glossary-identity-ssot/evidence/2026-05-07-people-glossary.md`
- 已執行 `scripts/tribunal-librarian-packet.py /Users/shroom/gu-log/tmp/andrej-youtube-fetch/draft-v1.mdx`，並為 Karpathy / Software 3.0 / Agentic Engineering 產出 old-post overlap evidence。完整 `tribunal.sh --only-stage librarian` LLM smoke 仍未勾選，避免在沒有 deliberate smoke fixture 的情況下 mutate real post。
- 已執行 `GOCACHE=/Users/shroom/gu-log/tmp/go-build-cache go test ./...` in `tools/sp-pipeline`，確認 deterministic SP pipeline tests pass。
- Full LLM tribunal / sp-pipeline smoke tests 仍未勾選，因為它們會花 live GPT-5.5 credits，且可能 mutate post frontmatter。
- 2026-05-06：mac-cdx 嘗試用從 `tmp/andrej-youtube-fetch/draft-v1.mdx` 複製出的 temporary fixture 執行 live `scripts/tribunal.sh --only-stage librarian sp-smoke-andrej-codex.mdx` smoke。該執行被 sandbox approval reviewer 拒絕，原因是會將 local draft/repo content 送到 external GPT-5.5/Codex service，並 mutate repo/progress state。依 security policy，不要用 indirect execution bypass。temporary fixture 已移除。
- 2026-05-06 19:00+08：mac-cdx 在 10-hour gap 後重新檢查 clawd-vm。VM 有新的 `codex/tribunal-v4-safety-hardening` branch，且 `main` 因 SP-190/counter commits ahead。已在本機 reconcile 該 branch 的 useful safety controls：`--score-only`、`--allow-rewrite`、non-mutating `vibe-scorer.sh`、invalid-JSON fail-fast、Codex idle watchdog、no hook-bypass flags、預設 no direct main push，以及 static `scripts/tests/test-tribunal-safety-contract.sh`。未將 VM 的 Opus/Claude metadata changes 套到 `.claude/agents/*.md`；Codex/GPT-5.5 runtime 現在由 `.codex/agents/*.toml` 與 `scripts/tribunal.sh` 表示。
