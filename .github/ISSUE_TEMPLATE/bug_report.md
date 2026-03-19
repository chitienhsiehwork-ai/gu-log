---
name: Bug report
about: Report a bug in an agent-ready format
title: "fix: "
labels: [bug]
assignees: []
---

## Bug summary

What is happening, and what should happen instead?

## Reproduction

1. 
2. 
3. 

## Expected behavior

## Actual behavior

## Impact

Who is affected, and how bad is it?

## Acceptance criteria

- [ ] Bug is reproducible before the fix
- [ ] A failing automated test is added or updated first
- [ ] The fix makes the failing test pass
- [ ] No obvious regressions are introduced

## Engineering constraints

- Fix the root cause, not just the visible symptom
- Keep the patch minimal unless broader cleanup is required
- If behavior changes, document the new expected behavior

## Testing workflow (Red → Green → Refactor)

- [ ] **Red**: reproduce the bug with a failing test first
- [ ] **Green**: implement the smallest fix that turns the test green
- [ ] **Refactor**: only after green, clean up code if needed
- [ ] Run the smallest relevant verification commands before opening PR

## Notes / implementation hints

- Relevant files:
  - 
- Logs / screenshots / examples:
  - 
- Related issue / PR:
  - 
