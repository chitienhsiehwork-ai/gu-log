## Why

The tribunal engine is architecturally ready for a 24/7 run (atomic claims, graceful stop, bounded retries, a burn-rate quota controller), but the **deployed configuration** is not. As shipped, the clawd-vm daemon (a) scores every article but never rewrites it (`GP_WRITER_MODE` defaults to `none` and the systemd unit never sets it) → every failing post burns 5 attempts to EXHAUSTED for zero quality gain; (b) runs all five judge/writer roles on a hardcoded `gpt-5.5` instead of the intended Opus-4.5-for-writer/vibe split; (c) has no operator alerting that works on Linux (the only alarm is a macOS `osascript` no-op); (d) ships a monitor tool that parses a dead quota format; and (e) has no documented reboot-persistence. This change hardens the deployment so a real 24/7 run improves articles instead of expensively confirming they are bad.

## What Changes

- **Per-role model routing.** Replace the single global provider choice + hardcoded `--model gpt-5.5` (`tribunal-helpers.sh:358`) with per-role resolution: writer/rewriter + vibe scorer → Claude Opus 4.5; fact-checker / librarian / fresh-eyes + the orchestrator → Codex GPT-5.5. Honor the existing-but-ignored `model` field in `.codex/agents/*.toml`.
- **Enable rewrites in the deployed runtime.** The long-running unit/wrapper SHALL set `GP_WRITER_MODE=subagent` (the `none` default stays as a safe library default; the deployment opts in).
- **Real operator alerting.** Replace the macOS-only `osascript` alarm with a channel the operator receives on the Linux deploy host (Telegram / existing clawd notifier) for stall / EXHAUSTED / `fallback` / `floor_stop`.
- **Accurate monitoring.** Update the `tribunal-monitor` skill to parse the live `CONTROLLER:` log lines + `quota-controller.json` + the real 10% floor instead of the retired `Tier GO / 3%` strings.
- **Reboot persistence.** Document + require `systemctl --user enable` + `loginctl enable-linger` so the daemon returns after a reboot.
- **Operator-configurable burst.** Document the knobs (`--workers`, `QUOTA_FLOOR`, `QUOTA_BURST_ALLOWANCE`, `MIN_COOLDOWN`) to drain a large quota balance before a refresh deadline, including the cgroup autoscaler cap and that the controller does not see Claude quota.

## Capabilities

### New Capabilities
- `tribunal-model-routing`: How each tribunal role (writer, rewriter, vibe, fact-checker, librarian, fresh-eyes, orchestrator) resolves its provider and model, per-role rather than one global provider, with documented fallback when a preferred CLI is absent.
- `tribunal-24-7-operations`: What the deployed long-running runtime must guarantee to run unattended — rewrites enabled, reboot persistence, operator-reachable alerting, accurate health readout, and operator-configurable burst spend.

### Modified Capabilities
- (none — these are new operational requirements; existing `tribunal-run-control` / `tribunal-ops-policy` cover pause/parallelism, not model routing or deploy-time enablement.)

## Impact

- **Model routing:** `scripts/tribunal-helpers.sh` (provider/model dispatch ~358-401, the "Ignore model" prompt note ~336-338), `.codex/agents/*.toml` + `.claude/agents/*.md` (`model` fields already set), `tools/sp-pipeline/internal/llm/defaults.go` (Go writer chain — already Opus).
- **Runtime enablement:** `scripts/tribunal-loop.service`, `scripts/cc-tribunal-loop-wrapper.sh`, `scripts/cc-cron-tribunal.sh` (set `GP_WRITER_MODE`).
- **Alerting:** `scripts/tribunal-helpers.sh` (`tribunal_quota_alarm` ~748-755), `scripts/tribunal-quota-loop.sh` (alarm hooks).
- **Monitoring:** `.claude/skills/tribunal-monitor/SKILL.md`.
- **Reboot + burst docs:** `docs/tribunal-runbook.md`.
- **External dependency:** `usage-monitor.sh` (off-repo, `$HOME/clawd/scripts/`) — note as a deploy prerequisite; not in scope to vendor.
- **Non-goals:** multi-host coordination (explicitly single-host); macOS daemon runtime (target is clawd-vm); vendoring `usage-monitor.sh`; changing the controller's burn-rate math.
