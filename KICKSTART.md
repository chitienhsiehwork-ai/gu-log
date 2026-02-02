# Kickstart Prompt

> Copy-paste this to a new Claude Code session opened in the gu-log directory.

---

Read CLAUDE.md and TODO.json to understand the project and task list. Then:

1. Pick the highest priority `"pending"` task from TODO.json (respect `depends_on`)
2. Update its status to `"in_progress"` in TODO.json
3. Do the work — commit code changes AND the TODO.json status update together
4. Mark the task `"done"` in TODO.json
5. Move on to the next task

Keep going until I tell you to stop or you run out of tasks. For each task:
- Run `npm run build` after changes to verify no rendering errors
- Commit after each completed task (not at the end)
- If a task is blocked, mark it `"blocked"` and move to the next eligible one
- Push to origin/main after every 2-3 commits

When translating articles (translate-all-en), always produce both zh-tw and en versions per TRANSLATION_PROMPT.md. One article per commit.

Go.
