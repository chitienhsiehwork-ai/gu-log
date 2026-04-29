## 1. Preparation

- [ ] 1.1 Confirm `main` is clean and up to date before creating experiment branches.
- [ ] 1.2 Record the chosen base commit for all three candidates.
- [ ] 1.3 Decide and privately record the Apple/Banana/Camera → model-suite mapping outside PR-visible text.
- [ ] 1.4 Ensure existing SP-181 Tribunal progress/scores do not cause crash-resume reuse in experiment runs.

## 2. GPT-5.5/Codex setup gate

- [ ] 2.1 Fix or refresh OpenAI/Codex authentication.
- [ ] 2.2 Implement or configure the GPT-5.5 runner adapter for judge stages.
- [ ] 2.3 Implement or configure the GPT-5.5 runner adapter for writer stages.
- [ ] 2.4 Run smoke test for valid Tribunal judge JSON schema output.
- [ ] 2.5 Run smoke test for writer edit/patch application on a disposable article copy.
- [ ] 2.6 Verify build passes after GPT-5.5 smoke edit.

## 3. Candidate generation

- [ ] 3.1 Create `experiment/tribunal-apple-sp181` from the shared base commit.
- [ ] 3.2 Create `experiment/tribunal-banana-sp181` from the shared base commit.
- [ ] 3.3 Create `experiment/tribunal-camera-sp181` from the shared base commit.
- [ ] 3.4 Add temporary `[Apple]`, `[Banana]`, `[Camera]` title prefixes only inside their respective experiment branches.
- [ ] 3.5 Run the assigned model suite for Apple.
- [ ] 3.6 Run the assigned model suite for Banana.
- [ ] 3.7 Run the assigned model suite for Camera.
- [ ] 3.8 Validate each candidate with post validation, diff check, and build.

## 4. PR and preview

- [ ] 4.1 Push all three branches.
- [ ] 4.2 Open three Draft PRs with blind label titles and no model mapping.
- [ ] 4.3 Wait for Vercel Preview URLs for all three candidates.
- [ ] 4.4 Send Sprin only the Apple/Banana/Camera preview URLs.

## 5. Review and reveal

- [ ] 5.1 Collect Sprin's ranking and notes.
- [ ] 5.2 Reveal the Apple/Banana/Camera → model-suite mapping after ranking.
- [ ] 5.3 Decide whether the result justifies a larger shadow run.

## 6. Cleanup / merge

- [ ] 6.1 Close losing PRs unless Sprin wants to keep them for comparison.
- [ ] 6.2 Remove `[Apple]`/`[Banana]`/`[Camera]` title prefixes from the winning branch before merge.
- [ ] 6.3 Ensure visible scores/frontmatter on the winning branch do not expose experiment-only metadata that should not ship.
- [ ] 6.4 Re-run validation and build after cleanup.
- [ ] 6.5 Merge only the cleaned winning candidate if Sprin approves.
