## Why

The tribunal engine is architecturally ready for a 24/7 run (atomic claims, graceful stop, bounded retries, a burn-rate quota controller), but the **deployed configuration** is not. As shipped, the clawd-vm daemon (a) scores every article but never rewrites it (`GP_WRITER_MODE` defaults to `none` and the systemd unit never sets it) → every failing post burns 5 attempts to EXHAUSTED for zero quality gain; (b) runs all five judge/writer roles on a hardcoded `gpt-5.5` instead of the intended Claude-for-writer/vibe split (the exact Opus build each role pins is owned by the `tribunal-model-pinning-strategy` change, not this one); (c) has no operator alerting that works on Linux (the only alarm is a macOS `osascript` no-op); (d) ships a monitor tool that parses a dead quota format; and (e) has no documented reboot-persistence. This change hardens the deployment so a real 24/7 run improves articles instead of expensively confirming they are bad.

## What Changes

- **Per-role model routing.** Replace the single global provider choice + hardcoded `--model gpt-5.5` (`tribunal-helpers.sh:358`) with per-role resolution: writer/rewriter + vibe scorer → Claude (Opus); fact-checker / librarian / fresh-eyes + the orchestrator → Codex (GPT-5.5). This change owns the **mechanism** — read each role's already-present `model` field (`.codex/agents/*.toml`, `.claude/agents/*.md`) instead of ignoring it; the **values** (which Opus / Codex build each role pins) are owned by the `tribunal-model-pinning-strategy` change and are not re-decided here.
- **Enable rewrites in the deployed runtime.** The long-running unit/wrapper SHALL set `GP_WRITER_MODE=subagent` (the `none` default stays as a safe library default; the deployment opts in).
- **Real operator alerting.** Replace the macOS-only `osascript` alarm with a channel the operator receives on the Linux deploy host (Telegram / existing clawd notifier) for stall / EXHAUSTED / `fallback` / `floor_stop`.
- **Accurate monitoring.** Update the `tribunal-monitor` skill to parse the live `CONTROLLER:` log lines + `quota-controller.json` + the real 10% floor instead of the retired `Tier …% remaining` format + stale 3% floor.
- **Reboot persistence.** Document + require `systemctl --user enable` + `loginctl enable-linger` so the daemon returns after a reboot.
- **Operator-configurable burst.** Document the knobs (`--workers`, `QUOTA_FLOOR`, `QUOTA_BURST_ALLOWANCE`, `MIN_COOLDOWN`) to drain a large quota balance before a refresh deadline, including the cgroup autoscaler cap and that the controller does not see Claude quota.

## Capabilities

### New Capabilities
- `tribunal-model-routing`: How each tribunal role (writer, rewriter, vibe, fact-checker, librarian, fresh-eyes, orchestrator) resolves its provider and model, per-role rather than one global provider, with documented fallback when a preferred CLI is absent.
- `tribunal-24-7-operations`: What the deployed long-running runtime must guarantee to run unattended — rewrites enabled, reboot persistence, operator-reachable alerting, accurate health readout, and operator-configurable burst spend.

### Modified Capabilities
- (no in-place capability edits — these are new operational requirements. Existing `tribunal-run-control` / `tribunal-ops-policy` cover pause/parallelism, not model routing or deploy-time enablement.)

### Coupled Changes
- **`tribunal-model-pinning-strategy`** (active): owns the model **values** each role pins (e.g. the Opus build, codex build). This change owns only the **routing mechanism** that reads those values. The two must land coherently — if pinning-strategy changes the agent-config `model` fields, this change's resolver picks them up automatically. Do not duplicate the value decision here; reconcile any conflict in `tribunal-model-pinning-strategy`.

## Impact

- **Model routing:** `scripts/tribunal-helpers.sh` (provider/model dispatch ~358-401, the "Ignore model" prompt note ~336-338), `.codex/agents/*.toml` + `.claude/agents/*.md` (`model` fields already set), `tools/gp-pipeline/internal/llm/defaults.go` (Go writer chain — already Opus).
- **Safety contract test:** `scripts/tests/test-tribunal-safety-contract.sh` — **currently green and asserts the exact things this change removes** (the `--model gpt-5.5` hardcode at line 77, the "Ignore YAML / frontmatter runtime fields" prompt at line 72, the static `codex-gpt-5.5-medium` runner label at 109/115, and `^model = "gpt-5.5"` pinned across all `.codex/agents/*.toml` at line 95). It MUST be updated in lockstep or routing edits turn it red.
- **Runtime enablement:** `scripts/tribunal-loop.service`, `scripts/cc-tribunal-loop-wrapper.sh`, `scripts/cc-cron-tribunal.sh` (set `GP_WRITER_MODE`).
- **Alerting:** `scripts/tribunal-helpers.sh` (`tribunal_quota_alarm` ~778-785; the macOS `osascript` no-op is at line 784; existing alarm call sites at ~938/940/943/1046), `scripts/tribunal-quota-loop.sh` (**add** alarm hooks — it has none today; all current alarm calls live in `tribunal-helpers.sh`).
- **Monitoring:** `.claude/skills/tribunal-monitor/SKILL.md`.
- **Reboot + burst docs:** `docs/tribunal-runbook.md`.
- **External dependency:** `usage-monitor.sh` (off-repo, `$HOME/clawd/scripts/`) — note as a deploy prerequisite; not in scope to vendor.
- **Non-goals:** multi-host coordination (explicitly single-host); macOS daemon runtime (target is clawd-vm); vendoring `usage-monitor.sh`; changing the controller's burn-rate math.
