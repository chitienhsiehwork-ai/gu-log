## Why

The tribunal engine is architecturally ready for a 24/7 run (atomic claims, graceful stop, bounded retries, a burn-rate quota controller), but the **deployed configuration** is not. The current runtime already routes Vibe to Claude when available and records Claude model provenance fail-closed, but the other judges still use a global Codex model override instead of their role config. More importantly, the Tribunal VM daemon scores every article but never rewrites it (`GP_WRITER_MODE` defaults to `none` and the systemd unit never sets an executable writer mode), so failing posts can burn attempts to EXHAUSTED for zero quality gain. Linux alerting is still a macOS `osascript` no-op, reboot persistence is undocumented, and monitoring does not expose all deployed preflight state. This change closes those remaining deployment gaps.

## What Changes

- **Finish per-role model routing.** Keep the existing Vibe→Claude / objective judges→Codex split, but resolve each role's model from its repo config instead of the global `GP_CODEX_MODEL` default. Model values stay owned by the agent config files; this change only owns dispatch and fail-closed parsing.
- **Enable rewrites in the deployed runtime.** The non-interactive long-running unit SHALL use a provisioned Claude CLI writer (`GP_WRITER_MODE=cli`). Interactive local orchestration may continue to use `subagent`; the daemon MUST NOT select broker mode unless a real broker consumer is running.
- **Real operator alerting.** Replace the macOS-only `osascript` alarm with a channel the operator receives on the Linux deploy host (Telegram / existing host notifier) for stall / EXHAUSTED / `fallback` / `floor_stop`.
- **Accurate monitoring.** Extend the existing `CONTROLLER:` / `quota-controller.json` monitor with the configured floor, writer preflight, unit enablement, and linger state.
- **Reboot persistence.** Document + require `systemctl --user enable` + `loginctl enable-linger` so the daemon returns after a reboot.
- **Operator-configurable burst.** Document the knobs (`--workers`, `QUOTA_FLOOR`, `QUOTA_BURST_ALLOWANCE`, `MIN_COOLDOWN`) to drain a large quota balance before a refresh deadline, including the cgroup autoscaler cap and that the controller does not see Claude quota.

## Capabilities

### New Capabilities
- `tribunal-24-7-operations`: What the deployed long-running runtime must guarantee to run unattended — rewrites enabled, reboot persistence, operator-reachable alerting, accurate health readout, and operator-configurable burst spend.

### Modified Capabilities
- `codex-tribunal-runtime`: replace literal model snapshots with per-role config lookup; define deployed strict routing separately from the existing CCC compatibility fallback.

## Impact

- **Model routing:** `scripts/tribunal-helpers.sh`, `.codex/agents/*.toml`, and `.claude/agents/*.md`. Existing Claude frontmatter parsing remains the fail-closed pattern for the new Codex TOML parser.
- **Safety contract test:** `scripts/tests/test-tribunal-safety-contract.sh` must stop asserting the global Codex model default and instead prove per-role config lookup, strict deployed routing, and explicit compatibility fallback.
- **Runtime enablement:** `scripts/tribunal-loop.service`, `scripts/cc-tribunal-loop-wrapper.sh`, and the host-local `tribunal.env` preflight.
- **Alerting:** `scripts/tribunal-helpers.sh` (`tribunal_quota_alarm` ~778-785; the macOS `osascript` no-op is at line 784; existing alarm call sites at ~938/940/943/1046), `scripts/tribunal-quota-loop.sh` (**add** alarm hooks — it has none today; all current alarm calls live in `tribunal-helpers.sh`).
- **Monitoring:** `.agents/skills/tribunal-monitor/SKILL.md`.
- **Reboot + burst docs:** `docs/tribunal-runbook.md`.
- **External dependency:** `usage-monitor.sh` (off-repo, supplied by `USAGE_MONITOR`) — systemd already refuses to start without it; direct loop invocation retains a conservative fallback. Its actual host path belongs in local machine context.
- **Non-goals:** multi-host coordination (explicitly single-host); macOS daemon runtime (target is the Tribunal VM); vendoring `usage-monitor.sh`; changing the controller's burn-rate math.
