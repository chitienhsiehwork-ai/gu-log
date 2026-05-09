# gu-log Agent Skills

This directory contains repo-local skills for agents working on gu-log.

## ChatGPT share URLs

If a task includes `chatgpt.com/share/...`, load:

- `.agents/skills/chatgpt-share-fetch/SKILL.md`

Then use `scripts/fetch-chatgpt-share.mjs` to fetch the transcript into `sources/chatgpt/...` before writing or transforming it.
