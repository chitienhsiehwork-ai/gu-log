<!-- md-zh-tw: ignore -->

## 1. Finish per-role model routing

- [ ] 1.1 Add a strict `.codex/agents/<role>.toml` model parser and use it for Codex execution, model provenance, and runner labels; preserve `GP_CODEX_MODEL` only as an explicit run-scoped override.
- [ ] 1.2 Implement `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` as the deployed provider contract: Vibe requires Claude, the three objective judges require Codex, and missing CLI/config fails loudly. Reject startup when strict mode and `TRIBUNAL_FORCE_PROVIDER` are both set. With strict mode unset, preserve explicit CCC fallback and actual provider/model provenance.
- [ ] 1.3 Update the safety contract with behavioral tests for per-role provider/model selection, invalid config, strict deployed routing, and explicit fallback.
- [ ] 1.4 Update `scripts/vibe-scoring-standard.md` so the Codex selector authority points to per-role config plus the explicit run-scoped override, not the old global default.

## 2. Enable an executable writer in the deployed runtime

- [ ] 2.1 Set the non-interactive systemd runtime to `GP_WRITER_MODE=cli`; keep `subagent` only for an interactive orchestrator with a live broker consumer.
- [ ] 2.2 Add startup preflight that fails before dispatch when writer mode is `none`/`subagent` or the Claude CLI/auth prerequisite is unavailable.

## 3. Reboot persistence (P0)

- [ ] 3.1 Document in `docs/tribunal-runbook.md` the required `systemctl --user enable tribunal-loop` + `loginctl enable-linger <user>` and add it to the deploy checklist.
- [ ] 3.2 Add a doctor/health check that reports whether the unit is enabled + linger is on.

## 4. Operator alerting (P1)

- [ ] 4.1 Replace the macOS `osascript` alarm with a `TRIBUNAL_NOTIFIER` executable path invoked with the complete message as one argument; never pass notifier content through shell evaluation.
- [ ] 4.2 Add alarm hooks to `tribunal-quota-loop.sh` (it has none today — current alarm calls live in `tribunal-helpers.sh`) firing the notifier on stall / EXHAUSTED spike / `fallback` / `floor_stop`; fall back to an observable log line when no channel is configured.

## 5. Accurate monitoring (P1)

- [ ] 5.1 Extend `.agents/skills/tribunal-monitor/SKILL.md` to report configured floor, writer preflight, unit enablement, and linger state alongside its existing controller JSON/log parsing.

## 6. Burst configurability + docs (P2)

- [ ] 6.1 Document the burst knobs in `docs/tribunal-runbook.md`: `--workers N`, `QUOTA_FLOOR=0`, `QUOTA_BURST_ALLOWANCE↑`, `MIN_COOLDOWN↓`, plus the `AUTOSCALE_OOM_CAP` cap and the "controller does not see Claude quota" caveat.
- [ ] 6.2 Document that systemd hard-fails without its off-repo `USAGE_MONITOR`, while direct loop invocation degrades to `fallback` (1 worker / 600s).

## 7. Verify

- [ ] 7.1 Shell tests green; `node scripts/validate-posts.mjs` unaffected; `openspec validate tribunal-24-7-deploy-readiness --strict` passes.
- [ ] 7.2 Dry-run on the operator-configured Tribunal VM: confirm a failing article is rewritten via Claude CLI, Vibe uses its configured Claude model, objective judges use their configured Codex models, strict preflight passes, and the monitor shows live controller state.
