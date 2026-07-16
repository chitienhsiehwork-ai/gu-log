# Tribunal v7 calibration reference: GP-187 false positive

This reference preserves the known-bad sample that triggered Tribunal v7. It is intentionally a git pointer instead of an edited copy, so judges can compare against the exact article that human review rejected.

## Exact git pointers

- Repo commit: `ab4c06704bce3873262ee0566fe178481af0202c`
- Bad sample: `src/content/posts/gp-187-20260428-openai-symphony-codex-orchestration.mdx`
- Bad sample blob: `0b4dc53271f1753115094f2b2a774bd1c0ed7a62`
- Overlap target: `src/content/posts/mp-179-20260316-daniel-mac8-symphony-manage-work-not-agents.mdx`
- Overlap target blob: `c6f90bdf228f1729ede2b2f21e784bff4f46121b`

To inspect the exact rejected article:

```bash
git show ab4c06704bce3873262ee0566fe178481af0202c:src/content/posts/gp-187-20260428-openai-symphony-codex-orchestration.mdx
```

To inspect the already-covered MP-179 baseline:

```bash
git show ab4c06704bce3873262ee0566fe178481af0202c:src/content/posts/mp-179-20260316-daniel-mac8-symphony-manage-work-not-agents.mdx
```

## Human review signal

GP-187 was previously scored too generously:

- `vibe: 8`
- `narrative: 9`
- `freshEyes.readability: 8`
- `freshEyes.firstImpression: 8`
- `librarian.crossRef: 7`

Human review rejected that result as a false positive:

- The post was too long and had too much filler.
- It repeated the Symphony / Linear / Codex workflow that MP-179 had already covered more tightly.
- It did not cite MP-179 early enough to tell repeat readers what was old and what was new.
- It contained awkward wording such as translating `rebase` as `變基`.
- Surface gu-log features did not rescue the underlying linear report skeleton.

## Correct v7 responsibility split

- Librarian owns corpus overlap: find MP-179, require early citation, identify repeated sections, and demand compression or contrast.
- FreshEyes owns reader fatigue: flag the feeling of “I understand this, but I do not want to keep reading.”
- Vibe owns article-local rhythm: compression, section boredom, decorative persona trap, and whether the article is actually fun enough to share.
- Writer consumes the evidence structurally: cite MP-179 early, compress repeated workflow background to a short recap, and spend the article on the newer official OpenAI SPEC / App Server / platform signal.

## Expected calibration behavior on the bad sample

When judging the exact bad GP-187 sample above:

- Librarian should not pass it as merely “could add one optional link.” It should explicitly name MP-179 and require early citation + compression.
- FreshEyes should not give it an effortless 8/8 if the middle reads like predictable recap mode.
- Vibe should not repeat the old `vibe 8 / narrative 9` outcome. A corrected score should land around `vibe 5–6` and `narrative 5–6`, or otherwise fail the publish bar for compression/section-boredom reasons.
