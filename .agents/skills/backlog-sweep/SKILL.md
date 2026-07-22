---
name: backlog-sweep
description: Sweep gu-log GitHub issues and PRs with consistent triage categories, fan-out read-only analysis, reporting, and safe-autonomous execution boundaries.
---

# Backlog Sweep SOP

Use this for GitHub/project hygiene. Route article work to `.agents/skills/gp-pipeline-sop/SKILL.md`.

## Mutation Contract

Fan-out analysis is always read-only. The controller declares its mutation scope before changing GitHub or git state; it never infers authority for irreversible cleanup or unresolved product/content decisions.

Review-and-merge is allowed when the declared task scope or runtime playbook authorizes it and the PR passes normal review, safety, and CI gates. Closure requires declared scope plus recorded evidence. CI follow-through and post-merge cleanup follow the runtime playbook.

## Categories

| Category          | Meaning                                                                                                                    | Allowed autonomous action                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `must-ship`       | Required for production health, broken main, broken deploy, security, data integrity, or an already-committed user promise | Execute through normal gates; stop only on a genuine blocker or critical decision |
| `review-needed`   | Looks useful but needs human/product/editorial judgment before action                                                      | Summarize decision needed and propose options                                     |
| `stale-archive`   | Old, superseded, duplicate, already shipped, or no longer relevant                                                         | Record evidence; close only when the declared mutation scope permits it           |
| `blocked-by-user` | Needs user credential, policy choice, content direction, billing, external account, or private context                     | State blocker and exact question                                                  |
| `safe-autonomous` | Reversible, low-risk, clearly scoped maintenance with no product decision                                                  | Execute, verify, and report                                                       |

When uncertain, gather more evidence first. Use `review-needed` only when a material product, content, or policy judgment remains unresolved.

## Sweep Flow

### 1. Bootstrap and Read Current State

Follow the identity bootstrap in `AGENTS.md` first, including `./scripts/detect-env.sh --runtime <codex|claude-code>`, then read the routed runtime playbook. Read `.agents/openspec-sdlc.md` too when OpenSpec changes are in scope.

Gather issues, PRs, and any tracking issue the user named. Prefer machine-readable output. Set the CLI limit above the known backlog size; if the result reaches that limit, continue with a paginated API or connector query until complete.

```bash
gh issue list --state open --limit 1000 --json number,title,labels,assignees,updatedAt,createdAt,url
gh pr list --state open --limit 1000 --json number,title,headRefName,baseRefName,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,updatedAt,createdAt,url,labels
```

If a tracking issue exists, read it before classifying:

```bash
gh issue view <number> --json number,title,body,comments,labels,url
```

### 2. Fan Out Read-Only Analysis

Fan-out workers may inspect issues, PR diffs, CI status, labels, linked commits, and related docs. They must not mutate GitHub state.

Each read-only analysis result uses this shape:

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

The controller produces one report with:

- Counts by category
- Priority list, highest urgency first
- Per-item row with `number`, `title`, `category`, `evidence`, `recommended action`, `risk`
- Mutations completed or proposed, with verification
- Explicit list of decisions that remain genuinely blocked on the user

### 4. Update Tracking Issue

If the user asked for an actual tracking issue update, prepare a concise body/comment with:

- Sweep date
- Scope queried
- Category counts
- Priority list
- Items proposed for archive/close
- Items blocked on user
- Safe-autonomous items completed or queued

Post only when the declared mutation scope or runtime playbook authorizes the update. Otherwise, include proposed text in the report.

### 5. Execute Authorized Items

Immediately before mutation, refresh the item and confirm that it remains inside the declared scope, has no unresolved critical/data-loss decision, and has the required gates plus an item-specific verification path.

After executing, run only the checks relevant to that item and report them. Examples:

```bash
git status --short
gh pr checks <pr> --watch
```

Use the available equivalent if the runtime uses GitHub MCP instead of `gh`.

## Controller Prompt Shape

```text
Read .agents/skills/backlog-sweep/SKILL.md.
Scope: <issues/PRs/tracking issue/query>.
Mutation allowed: <explicit scope, or none>.
Return one evidence-backed report. Do not perform irreversible cleanup outside the declared scope; merge and branch cleanup follow the runtime playbook.
```
