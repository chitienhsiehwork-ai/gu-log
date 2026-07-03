---
name: backlog-sweep
description: Sweep gu-log GitHub issues and PRs with consistent triage categories, fan-out read-only analysis, reporting, and safe-autonomous execution boundaries.
---

# Backlog Sweep SOP

Use this when asked to clean up gu-log GitHub issues, pull requests, tracking issues, or a mixed backlog. The point is to avoid inventing a new triage policy every time.

This SOP is for GitHub/project hygiene, not article writing. For article pipeline work, use `.agents/skills/sp-pipeline-sop/SKILL.md`.

## Safety Gates

These actions are never safe-autonomous in a sweep and must be left for explicit user decision:

- PR merge
- Branch deletion
- Force-push or history rewrite
- Closing/deleting issues or PRs when information would be lost
- Bulk label/status edits with ambiguous product meaning
- Any data-loss or irreversible cleanup

CI status is the agent's job to watch. Do not ask the user to relay check status; use `gh pr checks --watch <pr>` or the available GitHub connector for the current runtime.

## Categories

| Category | Meaning | Allowed autonomous action |
|---|---|---|
| `must-ship` | Required for production health, broken main, broken deploy, security, data integrity, or an already-committed user promise | Prepare fix plan, identify owner/PR, run checks; do not merge without the repo's normal gate |
| `review-needed` | Looks useful but needs human/product/editorial judgment before action | Summarize decision needed and propose options |
| `stale-archive` | Old, superseded, duplicate, already shipped, or no longer relevant | Recommend archive/close target and evidence; do not close/delete without explicit approval |
| `blocked-by-user` | Needs user credential, policy choice, content direction, billing, external account, or private context | State blocker and exact question |
| `safe-autonomous` | Reversible, low-risk, clearly scoped maintenance with no product decision | Execute after reporting intent, then verify and report diff/checks |

When uncertain, classify as `review-needed`, not `safe-autonomous`.

## Sweep Flow

### 1. Read Current GitHub State

Gather issues, PRs, and any tracking issue the user named. Prefer machine-readable output:

```bash
gh issue list --state open --limit 200 --json number,title,labels,assignees,updatedAt,createdAt,url
gh pr list --state open --limit 200 --json number,title,headRefName,baseRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,updatedAt,createdAt,url,labels
```

If a tracking issue exists, read it before classifying:

```bash
gh issue view <number> --json number,title,body,comments,labels,url
```

Also read repo-local policy first when the sweep may touch agent workflow, content workflow, or OpenSpec:

- `AGENTS.md`
- `CLAUDE.md`
- `playbooks/mac-CC-playbook.md` or `playbooks/CCC-playbook.md` after `./scripts/detect-env.sh`
- `.agents/openspec-sdlc.md` when OpenSpec changes are involved

### 2. Fan Out Read-Only Analysis

Fan-out workers may inspect issues, PR diffs, CI status, labels, linked commits, and related docs. They must not mutate GitHub state.

Each read-only analysis result uses this fixed shape:

```md
## Item
- Type: issue | PR | tracking
- Number:
- Title:
- URL:
- Current state:
- Evidence:
- Category:
- Recommended action:
- Risk:
- Dependencies:
```

### 3. Consolidate Into One Report

The controller produces a single sweep report with:

- Counts by category
- Priority list, highest urgency first
- Per-item row with `number`, `title`, `category`, `evidence`, `recommended action`, `risk`
- Tracking issue update plan
- Safe-autonomous execution plan, if any
- Explicit list of actions requiring user decision

Use stable language. Do not hide uncertain calls inside confident labels.

### 4. Update Tracking Issue Plan

If the user asked for an actual tracking issue update, prepare a concise body/comment with:

- Sweep date
- Scope queried
- Category counts
- Priority list
- Items proposed for archive/close
- Items blocked on user
- Safe-autonomous items completed or queued

Posting the update is allowed only when the user asked for GitHub state to be updated, or when the current repo playbook clearly authorizes this class of maintenance. Otherwise, include the proposed text in the report.

### 5. Execute Only Safe-Autonomous Items

Before mutating, re-check that each item is still `safe-autonomous`:

- The action is reversible
- The scope is narrow
- No product/content decision is embedded
- No merge/branch deletion/force-push/data-loss risk is involved
- CI or validation command is known

After executing, run the relevant check and report:

```bash
git status --short
gh pr checks --watch <pr>
```

Use the available equivalent if the runtime uses GitHub MCP instead of `gh`.

## Reporting Format

```md
# Backlog Sweep Report

## Summary
- Scope:
- Queried:
- Counts:

## Priority List
1. ...

## Triage Table
| Item | Category | Evidence | Recommended action | Risk |
|---|---|---|---|---|

## Tracking Issue Update Plan
...

## Safe-Autonomous Actions
- Completed:
- Deferred:

## Requires User Decision
- ...

## Verification
- ...
```

## Controller Prompt Shape

```text
Read .agents/skills/backlog-sweep/SKILL.md.
Scope: <issues/PRs/tracking issue/query>.
Mutation allowed: <none|tracking-comment-only|safe-autonomous>.
Return the standard sweep report and do not merge/delete/force-push.
```
