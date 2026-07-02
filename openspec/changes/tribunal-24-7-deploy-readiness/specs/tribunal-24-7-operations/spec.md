## ADDED Requirements

### Requirement: The deployed long-running runtime SHALL enable rewrites

The deployed 24/7 runtime (systemd unit / wrapper) SHALL set a writer mode that performs rewrites (`GP_WRITER_MODE=subagent` or `cli`). The library default MAY remain `none`, but the production daemon SHALL NOT run in score-only mode.

#### Scenario: Failing article is rewritten, not skipped

- **WHEN** an article fails a judge under the deployed daemon
- **THEN** the tribunal writer SHALL be invoked to rewrite it
- **AND** the run SHALL NOT log "rewrite skipped (GP_WRITER_MODE=none)" and burn attempts to EXHAUSTED without rewriting

### Requirement: The runtime SHALL survive a host reboot

The deployed runtime SHALL be configured to restart automatically after a host reboot.

#### Scenario: Daemon returns after reboot

- **WHEN** the clawd-vm host reboots
- **THEN** the tribunal daemon SHALL start again without manual intervention
- **AND** the deploy documentation SHALL state the required `systemctl --user enable` + `loginctl enable-linger` steps

### Requirement: Operational failures SHALL reach the operator on the deploy host

Abnormal runtime states SHALL be delivered to a channel the operator actually receives on the Linux deploy host. A macOS-only notification SHALL NOT be the sole alert path.

#### Scenario: Stall or EXHAUSTED or fallback alerts the operator

- **WHEN** the daemon stalls, hits an EXHAUSTED spike, or enters `fallback`/`floor_stop`
- **THEN** an alert SHALL be sent via a host-appropriate channel (e.g. Telegram / clawd notifier)
- **AND** where no channel is configured it SHALL at least record an observable log line, never silently no-op

### Requirement: The monitoring tool SHALL report the live controller state

The monitoring tool SHALL parse the current controller output (`quota-controller.json`, `CONTROLLER:` log lines, the configured floor) rather than a retired format.

#### Scenario: Monitor shows real quota/mode

- **WHEN** an operator runs the tribunal monitor against the live daemon
- **THEN** it SHALL show the current controller `mode` and quota reading
- **AND** SHALL NOT report blanks because it is matching a removed `Tier …% remaining` format or a stale 3% floor (the real default floor is 10%)

### Requirement: Burst spend SHALL be operator-configurable

The runtime SHALL let an operator increase burn rate to drain a large quota balance before a refresh deadline, with the limits documented.

#### Scenario: Operator raises burn rate

- **WHEN** an operator wants to spend a large balance before refresh
- **THEN** raising `--workers`, lowering `QUOTA_FLOOR`, raising `QUOTA_BURST_ALLOWANCE`, and lowering `MIN_COOLDOWN` SHALL increase throughput
- **AND** the docs SHALL state that the cgroup autoscaler can cap workers at `AUTOSCALE_OOM_CAP` under memory pressure and that the controller paces Codex/GPT quota only, not Claude
