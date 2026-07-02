## Context

The clawd-vm tribunal daemon is `tribunal-quota-loop.sh` (a quota-aware supervisor) dispatching `tribunal.sh` per article. Provider/model selection happens in `tribunal-helpers.sh`: `tribunal_llm_provider()` picks ONE provider for all roles (codex if present), and `tribunal_codex_exec` hardcodes `--model gpt-5.5` (helpers.sh:358) while the prompt explicitly tells the model to "Ignore model". The per-role `model` fields in `.codex/agents/*.toml` are therefore dead on the production path; only the CCC-claude fallback path honors `.claude/agents/*.md` models. `GP_WRITER_MODE` defaults to `none` (helpers.sh:416) and no deploy unit sets it. Alerting is `osascript` (Linux no-op). The quota controller writes `quota-controller.json` with modes `pacing/floor_stop/fallback`; the `tribunal-monitor` skill greps for the retired `Tier …% remaining` format and a stale 3% floor (the real default floor is 10%, `QUOTA_FLOOR:-10`). Reboot survival needs `systemctl --user enable` + `loginctl enable-linger`.

## Goals / Non-Goals

**Goals:**
- A 24/7 clawd-vm run that actually rewrites sub-bar posts (not score-only).
- The intended model split: Claude (Opus) writes/judges-vibe; Codex (GPT-5.5) does the other judges + orchestration. The exact builds are owned by `tribunal-model-pinning-strategy`; this change only routes to whatever each role's config declares.
- Unattended operability: reboot-persistent, operator gets alerted, monitor reflects reality, burst is tunable.

**Non-Goals:**
- Multi-host concurrency (single-host by decision — claims are local/PID-based; two hosts double-score).
- macOS daemon runtime (target is clawd-vm; mac path is a separate effort blocked by an off-repo `usage-monitor.sh`).
- Vendoring `usage-monitor.sh` or changing the burn-rate controller math.

## Decisions

**D1. Per-role resolution, not a global provider.** Introduce a role→provider map: `{writer, rewriter, vibe} → claude`; `{fact-checker, librarian, fresh-eyes, orchestrator} → codex`. The **model** for each role is read from that role's existing config field (`.claude/agents/*.md` for claude roles — today `claude-opus-4-5`; `.codex/agents/*.toml` for codex roles — today `gpt-5.5`), **not hardcoded in the resolver**. The exact build values are owned by `tribunal-model-pinning-strategy`; this resolver just stops ignoring them. Each judge/writer invocation consults the map instead of `tribunal_llm_provider()` choosing once for all. *Alternative considered:* keep one provider and just swap it to claude globally — rejected: the user wants GPT doing the cheaper judges to spread quota across both balances.

**D2. Remove the hardcoded codex model flag.** Replace `--model gpt-5.5` (helpers.sh:358) with a lookup of the `.codex/agents/<role>.toml` `model` field (already present, currently ignored), and drop the "Ignore model" prompt line so codex roles honor their declared model. Defaults to gpt-5.5 when unset. **`scripts/tests/test-tribunal-safety-contract.sh` must move in the same change** — it currently asserts the hardcode, the "Ignore YAML" prompt, the static `codex-gpt-5.5-medium` runner label, and pinned `.codex` models; those assertions flip from "must exist" to "must read from config" (see tasks 1.6).

**D3. Deployment opts into rewrites; library default stays safe.** Keep `GP_WRITER_MODE` defaulting to `none` in `tribunal-helpers.sh` (safe for ad-hoc/library use) but require the deployed unit/wrapper to export `GP_WRITER_MODE=subagent`. This makes the dangerous-by-omission state impossible in production without changing safe local behavior.

**D4. Alerting via an injectable notifier.** Replace the hardcoded `osascript` call with a notifier hook (env-configured command / existing clawd Telegram notifier) invoked on stall / EXHAUSTED / `fallback` / `floor_stop`. On hosts without a notifier configured it degrades to a log line (never silently no-ops the way osascript does on Linux).

**D5. Monitor parses live state.** Point the `tribunal-monitor` skill at `quota-controller.json` + the `CONTROLLER:` log lines + the configured floor, not the retired strings.

**D6. Burst is configuration, not new code.** The controller already fills the worker pool when behind the ideal line; document the operator knobs (`--workers`, `QUOTA_FLOOR=0`, `QUOTA_BURST_ALLOWANCE↑`, `MIN_COOLDOWN↓`) and the caveats (cgroup autoscaler caps at `AUTOSCALE_OOM_CAP=2` under memory pressure; the controller paces GPT/Codex quota only, not Claude).

## Risks / Trade-offs

- **Per-role routing runs two CLIs (codex + claude) in one tribunal run.** → Both must be installed + authed on clawd-vm; document as a prerequisite and fail loudly if a role's required CLI is absent rather than silently rerouting all roles.
- **Enabling rewrites increases spend per failing article.** → That is the intended value conversion; the burn controller + `QUOTA_FLOOR` still bound it.
- **Alert spam.** → Alert only on terminal/abnormal states (stall, EXHAUSTED spike, fallback, floor_stop), not every article.
- **`usage-monitor.sh` is off-repo.** → If absent the controller sits in `fallback` (1 worker/600s); make its presence a documented pre-flight check, not a silent degrade.

## Migration Plan

Config + targeted code edits; no data migration. Roll out on clawd-vm: set the unit env, deploy the routing change, wire the notifier, fix the monitor skill, enable + linger. Rollback = revert; the `none` default and single-provider path still work.

## Open Questions

- Which notifier exactly (existing clawd Telegram bot vs a generic webhook env)? Pick during implementation; the spec only requires "operator-reachable on the deploy host".
- Whether to also add a deadline-aware burst mode (shorten the controller's window perception) or leave it as the documented `WEEKLY_WINDOW_SEC` hack — deferred; not required for the core ask.
