## 1. Preparation

- [x] 1.1 Confirm Claude CLI is installed and Opus 4.7 / 4.6 / 4.5 model IDs work.
- [x] 1.2 Fast-forward `main` before modifying the experiment spec.
- [x] 1.3 Inspect gu-log posts and confirm `sourceUrl` candidates exist.
- [ ] 1.4 Record the selected candidate URL list for the burn run.

## 2. Spec pivot

- [x] 2.1 Replace GPT-5.5/Codex gate with Claude-only urgent quota-burn scope.
- [x] 2.2 Define midnight / quota-exhaustion stop conditions.
- [x] 2.3 Define URL-only starting constraint and local artifact storage.
- [ ] 2.4 Validate OpenSpec strictly.

## 3. Runner implementation

- [ ] 3.1 Implement candidate extraction from gu-log post frontmatter.
- [ ] 3.2 Implement per-trial Apple/Banana/Camera random mapping to Opus 4.7 / 4.6 / 4.5.
- [ ] 3.3 Implement concurrent Claude calls from one URL seed.
- [ ] 3.4 Implement rotating experiment tasks and local artifact output.
- [ ] 3.5 Implement quota/deadline polling and graceful stop.
- [ ] 3.6 Implement background launcher and log paths.

## 4. Verification

- [ ] 4.1 Run syntax checks for the runner.
- [ ] 4.2 Run a short smoke test with one URL and a small time limit.
- [ ] 4.3 Confirm raw JSON, markdown, manifest, and mapping artifacts are produced.
- [ ] 4.4 Run OpenSpec validation.
- [ ] 4.5 Review diff for accidental production content changes.

## 5. Burn run

- [ ] 5.1 Launch the quota-burn background process with deadline set to midnight Asia/Taipei.
- [ ] 5.2 Monitor early logs for model ID errors, quota errors, or fetch failures.
- [ ] 5.3 Report PID, log path, result path, and current status to Sprin.
- [ ] 5.4 Continue monitoring until quota exhaustion, midnight, or manual stop.
