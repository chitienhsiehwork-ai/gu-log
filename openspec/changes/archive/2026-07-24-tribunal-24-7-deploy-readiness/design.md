<!-- md-zh-tw: ignore -->

## Context

The Tribunal VM daemon is `tribunal-quota-loop.sh` (a quota-aware supervisor) dispatching `tribunal.sh` per article. Current provider dispatch already prefers Claude for `vibe-opus-scorer` and Codex for the objective judges, and Claude model parsing is frontmatter-only. Codex execution still uses the global `${GP_CODEX_MODEL:-gpt-5.5}` instead of `.codex/agents/<role>.toml`. `GP_WRITER_MODE` still defaults to `none`, and broker-based `subagent` mode cannot work in a non-interactive daemon because no process consumes its request files. Alerting is still `osascript` (a Linux no-op). The monitor reads controller JSON/log lines but omits the deployed floor, writer preflight, unit enablement, and linger state. The systemd unit already hard-fails when `USAGE_MONITOR` is missing; only direct loop invocation uses conservative fallback.

## Goals / Non-Goals

**Goals:**
- A 24/7 Tribunal VM run that actually rewrites sub-bar posts (not score-only).
- The intended model split: Claude writes and judges Vibe; Codex runs the three objective judges. Exact model selectors come only from each role's config.
- Unattended operability: reboot-persistent, operator gets alerted, monitor reflects reality, burst is tunable.

**Non-Goals:**
- Multi-host concurrency (single-host by decision — claims are local/PID-based; two hosts double-score).
- macOS daemon runtime (target is the Tribunal VM; mac path is a separate effort blocked by an off-repo `usage-monitor.sh`).
- Vendoring `usage-monitor.sh` or changing the burn-rate controller math.

## Decisions

**D1. Finish per-role resolution without replacing explicit compatibility fallback.** Vibe uses Claude; the three objective judges use Codex; writer dispatch remains the separate writer-mode contract. Each provider reads the selected role's model config. `TRIBUNAL_STRICT_ROLE_PROVIDERS=1` is the single deployed-mode switch: missing required CLIs or role configs fail startup or the role loudly. With the switch unset, the existing CCC compatibility fallback may select its available provider, but provenance must record the actual provider/model. Strict mode and `TRIBUNAL_FORCE_PROVIDER` are mutually exclusive; startup fails when both are set.

**D2. Parse Codex role config fail-closed.** Read the selected role's `model` from its TOML agent config and pass it to `codex exec`. A run-scoped `GP_CODEX_MODEL` remains an explicit override for experiments and emergency recovery; without that override, missing or invalid role config fails instead of silently choosing a model. The Claude rubric may still be included as prose, but its frontmatter runtime fields are never used by Codex.

**D3. Deployment opts into an executable rewrite path; library default stays safe.** Keep the library default `none`. Interactive orchestration may use `subagent` with a live broker consumer. The non-interactive VM daemon uses `GP_WRITER_MODE=cli`, verifies Claude CLI/auth prerequisites at startup, and fails before dispatch if the writer path is unusable.

**D4. Alerting via an injectable notifier.** `TRIBUNAL_NOTIFIER` is an executable path, not a shell command string. The runtime invokes it with the complete alert message as one argument on stall / EXHAUSTED / `fallback` / `floor_stop`. Without a notifier it degrades to a structured log line, never a silent Linux no-op.

**D5. Monitor parses live state.** Point the `tribunal-monitor` skill at `quota-controller.json` + the `CONTROLLER:` log lines + the configured floor, not the retired strings.

**D6. Burst is configuration, not new code.** The controller already fills the worker pool when behind the ideal line; document the operator knobs (`--workers`, `QUOTA_FLOOR=0`, `QUOTA_BURST_ALLOWANCE↑`, `MIN_COOLDOWN↓`) and the caveats (cgroup autoscaler caps at `AUTOSCALE_OOM_CAP=2` under memory pressure; the controller paces GPT/Codex quota only, not Claude).

## Risks / Trade-offs

- **Per-role routing runs two CLIs (codex + claude) in one tribunal run.** → Both must be installed and authenticated on the Tribunal VM; startup preflight and role dispatch fail loudly instead of silently changing the deployed model split.
- **Enabling rewrites increases spend per failing article.** → That is the intended value conversion; the burn controller + `QUOTA_FLOOR` still bound it.
- **Alert spam.** → Alert only on terminal/abnormal states (stall, EXHAUSTED spike, fallback, floor_stop), not every article.
- **`usage-monitor.sh` is off-repo.** → The deployed unit already hard-fails when it is absent; direct/manual loop execution retains the documented 1-worker/600s fallback.

## Migration Plan

Config + targeted code edits; no data migration. Roll out on the Tribunal VM: provision the two CLIs and auth, set `GP_WRITER_MODE=cli`, deploy routing and notifier changes, enable the unit, and enable linger. Rollback = revert the PR and restore `GP_WRITER_MODE=none`; do not fall back silently while claiming producer health.

## Open Questions

- Use a generic executable notifier command supplied by the host environment; provider-specific secrets and destination configuration stay off-repo.
- Whether to also add a deadline-aware burst mode (shorten the controller's window perception) or leave it as the documented `WEEKLY_WINDOW_SEC` hack — deferred; not required for the core ask.
