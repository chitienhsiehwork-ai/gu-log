## Context

The original blind experiment targeted SP-181 and compared current Opus Tribunal, all Opus 4.7, and all GPT-5.5. The deadline changed: the Anthropic subscription ends on May 1, and the remaining Claude weekly quota should be burned by midnight today.

Chosen initial seed article:

- `src/content/posts/sp-181-20260423-walden-cognition-multi-agents-working.mdx`
- `src/content/posts/en-sp-181-20260423-walden-cognition-multi-agents-working.mdx`

Expanded candidate pool:

- Any gu-log SP/CP post with `sourceUrl` in frontmatter.
- Prefer recent, high-signal AI/tooling posts with enough source substance to stress reasoning, factuality, taste, and gu-log voice.

## Goals / Non-Goals

Goals:

- Burn remaining Claude weekly quota aggressively before midnight Asia/Taipei.
- Compare Opus 4.7, Opus 4.6, and Opus 4.5 from the same single URL seed.
- Keep reviewer-facing labels blind: Apple, Banana, Camera.
- Randomize label→model mapping per trial to reduce positional/model-name bias.
- Save raw Claude JSON, extracted markdown, mappings, manifests, and quota samples locally.
- Continue automatically across multiple good gu-log source URLs until deadline or quota exhaustion.

Non-goals:

- Do not wait for GPT-5.5/Codex setup in this burn run.
- Do not publish generated candidates to production automatically.
- Do not open three PRs per URL during the quota-burn window.
- Do not treat one burn run as statistically rigorous model migration evidence.
- Do not hide the mapping from local artifacts; hide it only from reviewer-facing summaries.

## Decisions

### 1. Candidate labels

Each trial SHALL use:

- Apple
- Banana
- Camera

The mapping to Opus 4.7 / 4.6 / 4.5 SHALL be randomized per trial and written to a local mapping file under `.score-loop/opus-url-burn/`.

### 2. URL-only starting point

Each model prompt SHALL start from exactly one URL selected from gu-log post frontmatter. The prompt MAY mention the gu-log evaluation task, but it SHALL NOT feed the model the existing gu-log article body as source content.

### 3. Candidate selection

The runner SHOULD prefer:

- SP-181 first, because it was the original blind-test target.
- Recent SP/CP posts about agents, Claude Code, Codex, model behavior, AI tooling, evaluation, infra, or product strategy.
- Source URLs likely to be publicly readable.
- Medium-to-long source material that can expose differences in grounding and taste.

The runner MAY skip or deprioritize URLs that repeatedly fail fetch/access.

### 4. Workload shape

Each URL trial SHALL run the three Opus models concurrently when quota permits. The default tasks SHALL rotate across:

- SP-style gu-log article draft from URL only.
- Editorial critique of likely gu-log article angle.
- Factuality/source-grounding review.
- Product/engineering insight memo.
- Safe red-team / overclaim risk review.

The runner SHOULD include enough output budget and repeated trials to burn quota materially, while still saving useful artifacts.

### 5. Stop condition

The run SHALL stop when any of these is true:

- Asia/Taipei midnight deadline is reached.
- Claude weekly quota is effectively exhausted or Claude CLI starts returning quota errors.
- The operator manually stops the background process.

The user explicitly authorized spending the remaining Claude weekly quota for this experiment, so the normal human-reserve floor does not apply to this run.

## Risks / Trade-offs

### Quota exhaustion before useful artifacts

Aggressive concurrency can hit quota quickly. Mitigation: save every raw result immediately, and rotate URLs/tasks so partial runs remain useful.

### Source fetch failures

Some URLs, especially X/Twitter or paywalled sources, may fail under Claude web tools. Mitigation: record failures and continue to the next candidate.

### Blind leakage

Local mapping files intentionally contain model mapping. Mitigation: do not include mapping in user-facing blind review snippets until Sprin asks for reveal.

### Production contamination

Generated text can be experimental or mediocre. Mitigation: write under `.score-loop/opus-url-burn/`; do not patch production posts automatically.
