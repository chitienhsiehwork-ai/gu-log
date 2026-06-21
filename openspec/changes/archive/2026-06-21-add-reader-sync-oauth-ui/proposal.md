## Why

Reader Tracker already sits behind GitHub OAuth, so asking users to paste a GitHub private gist token is unnecessary and unsafe as the primary flow.

## What Changes

- Use gu-log API `/reader-sync` endpoints when a gu-log JWT is present.
- Keep manually pasted GitHub PAT sync only as a legacy fallback.
- Show a reauthorization action when the backend says the existing GitHub OAuth grant lacks `gist` scope.
- Continue storing per-post reader revisions so rewritten Tribunal versions can appear stale/greyed out.

## Impact

- Signed-in users can sync Reader Tracker without copying secrets.
- Existing local and legacy Gist stores still merge through the existing record-level merge logic.
