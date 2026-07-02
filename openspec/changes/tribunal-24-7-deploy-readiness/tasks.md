## 1. Per-role model routing (P0 — unblocks the intended split)

- [ ] 1.1 In `scripts/tribunal-helpers.sh`, add a role→provider resolver: `{writer, rewriter, vibe}`→claude; `{fact-checker, librarian, fresh-eyes, orchestrator}`→codex. Resolve each role's **model** by reading its config field (`.claude/agents/<role>.md` / `.codex/agents/<role>.toml`), not a literal in the resolver — the build values are owned by `tribunal-model-pinning-strategy`.
- [ ] 1.2 Route each judge/writer invocation through the resolver instead of the global `tribunal_llm_provider()` choosing one provider for all (helpers.sh ~380-401).
- [ ] 1.3 Replace the hardcoded `--model gpt-5.5` (helpers.sh:358) with a lookup of `.codex/agents/<role>.toml` `model`; default `gpt-5.5` when unset; remove the "Ignore model" prompt line (helpers.sh ~336-338).
- [ ] 1.4 Make a missing required CLI fail that role loudly (explicit error), not silently reroute all roles.
- [ ] 1.5 Add/extend a shell test asserting writer/vibe resolve to the claude provider + their configured Opus model, and the other judges to the codex provider + their configured model (assert against the config field, not a hardcoded version string; mirror `scripts/tests/` patterns).
- [ ] 1.6 Update `scripts/tests/test-tribunal-safety-contract.sh` in the same change: its current assertions (`--model gpt-5.5` hardcode at line 77, the "Ignore YAML / frontmatter runtime fields" prompt at line 72, the static `codex-gpt-5.5-medium` runner label at 109/115, and `^model = "gpt-5.5"` pinned across `.codex/agents/*.toml` at line 95) flip from "must be hardcoded/pinned" to "must be read from per-role config". Removing the hardcode without this turns a currently-green test red.

## 2. Enable rewrites in the deployed runtime (P0 — the headline bomb)

- [ ] 2.1 Set `GP_WRITER_MODE=subagent` in `scripts/tribunal-loop.service` (and `cc-tribunal-loop-wrapper.sh` / `cc-cron-tribunal.sh` if they spawn the loop), keeping the library default `none` in helpers.sh.
- [ ] 2.2 Add a startup pre-flight assertion that warns loudly if the deployed daemon resolves `GP_WRITER_MODE=none`.

## 3. Reboot persistence (P0)

- [ ] 3.1 Document in `docs/tribunal-runbook.md` the required `systemctl --user enable tribunal-loop` + `loginctl enable-linger <user>` and add it to the deploy checklist.
- [ ] 3.2 Add a doctor/health check that reports whether the unit is enabled + linger is on.

## 4. Operator alerting (P1)

- [ ] 4.1 Replace the macOS `osascript` `tribunal_quota_alarm` (helpers.sh ~778-785; `osascript` at line 784) with an injectable notifier (env-configured command / clawd Telegram notifier).
- [ ] 4.2 Add alarm hooks to `tribunal-quota-loop.sh` (it has none today — current alarm calls live in `tribunal-helpers.sh`) firing the notifier on stall / EXHAUSTED spike / `fallback` / `floor_stop`; fall back to an observable log line when no channel is configured.

## 5. Accurate monitoring (P1)

- [ ] 5.1 Update `.claude/skills/tribunal-monitor/SKILL.md` to parse `quota-controller.json` + `CONTROLLER:` log lines + the real floor (default 10%), not the retired `Tier …% remaining` format / stale 3% floor.

## 6. Burst configurability + docs (P2)

- [ ] 6.1 Document the burst knobs in `docs/tribunal-runbook.md`: `--workers N`, `QUOTA_FLOOR=0`, `QUOTA_BURST_ALLOWANCE↑`, `MIN_COOLDOWN↓`, plus the `AUTOSCALE_OOM_CAP` cap and the "controller does not see Claude quota" caveat.
- [ ] 6.2 Document the off-repo `usage-monitor.sh` prerequisite and that its absence drops the controller into `fallback` (1 worker / 600s).

## 7. Verify

- [ ] 7.1 Shell tests green; `node scripts/validate-posts.mjs` unaffected; `openspec validate tribunal-24-7-deploy-readiness --strict` passes.
- [ ] 7.2 Dry-run on clawd-vm: confirm a failing article is rewritten (not skipped), writer/vibe run on the configured Claude/Opus model, other judges on the configured Codex/GPT-5.5 model, and the monitor shows live controller state.
