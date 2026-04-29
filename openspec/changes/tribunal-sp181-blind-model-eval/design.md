## Context

The experiment compares whether changing the Tribunal model suite changes the final published-quality article. It is not a broad benchmark and not a full rollout.

Chosen article:

- `src/content/posts/sp-181-20260423-walden-cognition-multi-agents-working.mdx`
- `src/content/posts/en-sp-181-20260423-walden-cognition-multi-agents-working.mdx`

Why SP-181:

- The article is hard enough to justify three full reads.
- It tests multi-agent nuance rather than simple summarization.
- The core thesis, "writes stay single-threaded; other agents add intelligence," is easy to damage with generic rewriting.
- It has zh-tw and EN counterparts, so the pipeline must preserve bilingual artifacts.

## Goals / Non-Goals

Goals:

- Produce three blind Vercel Preview URLs for Sprin to review.
- Keep the model mapping hidden until Sprin finishes ranking candidates.
- Compare current production behavior against all-Opus-4.7 and all-GPT-5.5 suites.
- Verify GPT-5.5/Codex execution before spending full experiment tokens.
- Ensure the winning candidate can be cleaned and merged without experiment labels.

Non-goals:

- Do not run a statistically significant benchmark.
- Do not publish three public production articles.
- Do not merge losing candidates.
- Do not permanently change Tribunal defaults based on one article.
- Do not expose model mapping in branch names, PR titles, PR bodies, page titles, commit messages, or Vercel URLs before review.

## Decisions

### 1. Candidate labels

Use:

- Apple
- Banana
- Camera

These are blind labels, not slugs. A slug is the URL/file identifier such as `sp-181-20260423-walden-cognition-multi-agents-working`.

Camera is intentionally not a fruit; the label set is optimized for recognizability and low confusion, not taxonomy.

### 2. Branch and PR naming

Branches SHALL use blind labels only:

- `experiment/tribunal-apple-sp181`
- `experiment/tribunal-banana-sp181`
- `experiment/tribunal-camera-sp181`

Draft PR titles SHALL use blind labels only:

- `experiment: [Apple] SP-181 Tribunal blind candidate`
- `experiment: [Banana] SP-181 Tribunal blind candidate`
- `experiment: [Camera] SP-181 Tribunal blind candidate`

### 3. Title labels in preview

Each candidate MAY temporarily prefix the zh-tw and EN article title with `[Apple]`, `[Banana]`, or `[Camera]` so Sprin can easily refer to preview pages.

These labels are experiment artifacts and SHALL be removed before any candidate is merged to main.

### 4. Model suites under test

The experiment SHALL compare exactly these suites:

- Current Opus Tribunal baseline: current production stage/writer model configuration.
- All Opus 4.7 Tribunal: every judge and writer stage uses Opus 4.7 or its appropriate context-window variant where available.
- All GPT-5.5 Tribunal: every judge and writer stage uses GPT-5.5 through the Codex/OpenAI runner adapter.

The mapping from suite to Apple/Banana/Camera SHALL be randomized or otherwise kept outside branch/PR/page-visible text until review is complete.

### 5. GPT-5.5 setup gate

The experiment SHALL NOT start full three-candidate generation until the GPT-5.5/Codex runner can pass a smoke test proving:

- The judge path can produce valid Tribunal JSON for each required schema.
- The writer path can edit zh-tw and EN article files in-place or through an equivalent patch application path.
- The model identifier is recorded programmatically, not trusted from model self-report.
- The final branch artifact can build with `pnpm run build`.

### 6. Review workflow

After all three Draft PRs have Vercel Preview URLs, Iris SHALL send Sprin only:

- Apple URL
- Banana URL
- Camera URL

Iris SHALL NOT reveal mapping until Sprin ranks the candidates.

Sprin's review response can be lightweight:

- First / second / third place.
- Which candidate feels most like gu-log.
- Which candidate feels most AI-written.
- Any factual, tone, or structure red flags.
- Whether any candidate is merge-worthy after label cleanup.

## Risks / Trade-offs

### Codex/GPT-5.5 runner mismatch

GPT-5.5 may not fit the existing Claude CLI agent workflow. Mitigation: require smoke verification before the full experiment.

### Blind leakage through metadata

Model names can leak via scores frontmatter, progress JSON, commit messages, branch names, PR text, Vercel URL, or visible score panels. Mitigation: use blind labels in visible artifacts and keep model mapping in a private local note until review completes.

### Title labels contaminate the article

`[Apple]` labels help review but must not ship. Mitigation: require a cleanup task before merge.

### One-article overfitting

SP-181 can identify obvious failures or winners, but one article cannot justify a full Tribunal default migration. Mitigation: treat success as permission for a shadow run, not production replacement.
