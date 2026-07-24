# tribunal-publisher-autopilot Specification

## Purpose

定義 Tribunal publisher autopilot 如何把可發布的 PASS artifacts 安全推進至 main、恢復既有 PR state，並沿用保守 merge guard 控制自動合併。

## Requirements

### Requirement: Tribunal runtime SHALL advance publishable PASS artifacts toward main

The long-running Tribunal runtime SHALL periodically attempt to materialize publishable PASS artifacts from the ignored runtime ledger into clean main-targeted publisher PRs.

#### Scenario: Runtime finds publishable PASS artifacts

- WHEN the ignored runtime ledger contains articles with current Tribunal version status PASS
- AND those articles are not blocked by conflict or validation events
- THEN runtime SHALL attempt publisher apply from the runtime ledger
- AND the resulting batch SHALL be based on origin/main
- AND the batch SHALL contain only publishable article artifacts

#### Scenario: Runtime is parked by quota debt

- WHEN runtime enters weekly_debt, five_hour_debt, or another quota-stop mode
- THEN runtime SHALL still continue publisher autopilot attempts on later loop iterations
- AND publishable PASS artifacts SHALL NOT require scoring to resume before they can advance to main

### Requirement: Publisher autopilot SHALL recover and advance publisher PR state

Publisher autopilot SHALL reconcile batch branches, PRs, and merged state so publisher entries do not stay stranded at intermediate states.

#### Scenario: Batch branch was pushed but PR creation previously failed

- WHEN a publisher batch entry is in branch_pushed
- AND no open or merged PR exists for the batch branch
- THEN autopilot SHALL create the missing PR
- AND it SHALL label the PR tribunal-publisher
- AND it SHALL transition the affected entries to pr_open

#### Scenario: Publisher PR is still draft

- WHEN an open publisher PR exists for a batch
- AND the PR is marked draft
- THEN autopilot SHALL mark the PR ready for review before attempting merge automation

#### Scenario: Publisher PR was merged

- WHEN a publisher batch branch has a merged PR into main
- THEN autopilot SHALL transition every entry in that batch to published
- AND it SHALL record merge metadata sufficient for audit and later reconciliation

### Requirement: Publisher autopilot SHALL use the existing conservative merge guard

Publisher autopilot SHALL NOT bypass branch protection or merge publisher PRs by ad hoc logic. It SHALL delegate merge eligibility to the existing gu-log auto-merge guard.

#### Scenario: Publisher PR checks are green and paths are allowlisted

- WHEN an open ready-for-review publisher PR targets main
- AND required checks are green
- AND the PR diff satisfies the existing auto-merge path guard
- THEN autopilot SHALL invoke the gu-log auto-merge guard for that PR

#### Scenario: Publisher PR checks are still pending

- WHEN an open publisher PR has not finished required checks
- THEN autopilot SHALL NOT treat that as fatal
- AND it SHALL leave the PR open for a later retry

#### Scenario: Publisher PR touches disallowed paths

- WHEN the auto-merge guard denies the PR because changed paths are outside the allowlist
- THEN autopilot SHALL NOT bypass that decision
- AND it SHALL leave the PR for explicit operator review
