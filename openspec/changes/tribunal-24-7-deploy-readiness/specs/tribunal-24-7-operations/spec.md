<!-- md-zh-tw: ignore -->

## ADDED Requirements

### Requirement: The deployed long-running runtime SHALL enable rewrites

The deployed non-interactive 24/7 runtime (systemd unit / wrapper) SHALL set `GP_WRITER_MODE=cli` and SHALL verify that the Claude CLI writer can start non-interactively before article dispatch. The library default MAY remain `none`, and interactive orchestration MAY use `subagent` only while a broker consumer is live, but the production daemon SHALL NOT run in score-only or unconsumed broker mode.

#### Scenario: Failing article is rewritten, not skipped

- **WHEN** an article fails a judge under the deployed daemon
- **THEN** the tribunal writer SHALL be invoked to rewrite it
- **AND** the run SHALL NOT log "rewrite skipped (GP_WRITER_MODE=none)" and burn attempts to EXHAUSTED without rewriting

#### Scenario: Writer preflight fails before dispatch

- **WHEN** writer mode is `none` or `subagent`, or the Claude CLI cannot start non-interactively within the configured preflight timeout
- **THEN** the deployed daemon SHALL exit before claiming or dispatching an article
- **AND** SHALL emit an actionable writer-preflight error

### Requirement: The runtime SHALL survive a host reboot

The deployed runtime SHALL be configured to restart automatically after a host reboot.

#### Scenario: Daemon returns after reboot

- **WHEN** the Tribunal VM host reboots
- **THEN** the tribunal daemon SHALL start again without manual intervention
- **AND** the deploy documentation SHALL state the required `systemctl --user enable` + `loginctl enable-linger` steps

### Requirement: Operational failures SHALL reach the operator on the deploy host

Abnormal runtime states SHALL be delivered to a channel the operator actually receives on the Linux deploy host. `TRIBUNAL_NOTIFIER`, when configured, SHALL be an executable path invoked directly with the complete alert message as one argument; the runtime SHALL NOT evaluate it as shell text. A macOS-only notification SHALL NOT be the sole alert path.

#### Scenario: Stall or EXHAUSTED or fallback alerts the operator

- **WHEN** the daemon stalls, hits an EXHAUSTED spike, or enters `fallback`/`floor_stop`
- **THEN** an alert SHALL be sent via a host-appropriate channel (e.g. Telegram / host notifier)
- **AND** where no channel is configured it SHALL at least record an observable log line, never silently no-op

#### Scenario: Notifier message cannot become shell code

- **WHEN** `TRIBUNAL_NOTIFIER` is configured and an alert message contains spaces, quotes, substitutions, or shell metacharacters
- **THEN** the runtime SHALL execute the notifier path directly with the unchanged message as one argument
- **AND** SHALL NOT use `eval`, `sh -c`, or equivalent shell interpretation

### Requirement: The monitoring tool SHALL report the live controller state

The monitoring tool SHALL parse the current controller output (`quota-controller.json`, `CONTROLLER:` log lines, the configured floor) rather than a retired format. It SHALL also report writer preflight, systemd unit enablement, and user linger state.

#### Scenario: Monitor shows real quota/mode

- **WHEN** an operator runs the tribunal monitor against the live daemon
- **THEN** it SHALL show the current controller `mode` and quota reading
- **AND** SHALL show the configured floor, writer mode/preflight, unit enabled state, and linger state
- **AND** SHALL NOT report blanks because it is matching a removed `Tier …% remaining` format or a stale 3% floor (the real default floor is 10%)

### Requirement: Burst spend SHALL be operator-configurable

The runtime SHALL let an operator increase burn rate to drain a large quota balance before a refresh deadline, with the limits documented.

#### Scenario: Operator raises burn rate

- **WHEN** an operator wants to spend a large balance before refresh
- **THEN** raising `--workers`, lowering `QUOTA_FLOOR`, raising `QUOTA_BURST_ALLOWANCE`, and lowering `MIN_COOLDOWN` SHALL increase throughput
- **AND** the docs SHALL state that the cgroup autoscaler can cap workers at `AUTOSCALE_OOM_CAP` under memory pressure and that the controller paces Codex/GPT quota only, not Claude
