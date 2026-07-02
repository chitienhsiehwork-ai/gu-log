## Context

Tribunal worker pipeline currently performs an expensive full Astro build immediately after each `tribunal-writer` rewrite. This catches broken MDX early, but it couples every content-quality iteration to a full-site production build. On the VPS, a single `astro.js build` has been observed at ~2GB RSS; recent loop logs show 49 measured post-rewrite builds with median ~113s and max ~160s. The failure mode under parallelism is not primarily quota exhaustion but RAM spikes when multiple workers reach build at the same time.

The current quota controller can recommend high concurrency, and memory autoscale can reduce worker count after OOM. That is reactive. This change makes build resource usage structurally safer by reducing build count and serializing the remaining builds.

## Goals / Non-Goals

**Goals:**
- Reduce number of full `pnpm run build` executions per article.
- Preserve final correctness: no article may be marked PASS until a full production build succeeds after final content changes.
- Prevent concurrent Astro builds across worker worktrees on the same VM.
- Keep workers free to parallelize token-heavy judge/writer work while serializing only the RAM-heavy build phase.
- Make build wait/execute/fail states visible in logs.
- Avoid false timeout attribution by not counting lock wait time as build execution time.

**Non-Goals:**
- Do not introduce dynamic rendering or gu-log-api page serving.
- Do not remove full-site build from the final gate.
- Do not redesign the four judge stages.
- Do not rely on Vercel deploy failure as the first build signal.

## Decisions

### D1: Full build moves from post-writer loop to final gate

**Decision:** After a writer rewrite, run cheap validation only. Run full `pnpm run build` once all content judges have passed and before `mark_article_passed`.

**Rationale:** Content judges do not need a full-site build after every rewrite. Full build is a deployability/syntax/render gate and is most valuable after final content state is known.

**Trade-off:** Broken MDX may survive until final gate if cheap validation misses it. This is acceptable because final build still blocks PASS, and cheap validation catches common low-level mistakes earlier.

### D2: Cheap validation remains inside rewrite loop

**Decision:** Each writer rewrite SHALL still perform low-cost validation before re-scoring.

Expected cheap checks:
- Target zh-tw post still exists.
- EN counterpart still exists if it existed before rewrite.
- Frontmatter parses and required schema fields remain valid.
- Target post validation command passes when available, e.g. `node scripts/validate-posts.mjs src/content/posts/<post>.mdx`.
- `git diff --check` passes for touched post files.

Cheap validation SHALL NOT call heavyweight full-project checks such as `pnpm run build` or any command known to initialize the full Astro/Vite production build graph. If an optional checker loads too much of Astro/Vite and approaches full build cost, it SHOULD be excluded from the rewrite loop and reserved for the final gate.

**Rationale:** Cheap validation prevents obvious syntax/schema damage from wasting judge calls while avoiding full Astro memory spikes.

### D3: Shared build lock uses stable repo-scoped path

**Decision:** Full build SHALL use a blocking exclusive `flock` on a stable shared path, e.g. `${TRIBUNAL_SHARED_LOCK_DIR}/build.lock`, where the shared lock dir resolves to the main repo `.score-loop/locks` directory, not each worker worktree.

**Rationale:** Workers run in separate worktrees; relative lock paths inside each worktree do not serialize anything. A stable main-repo lock path is easy to inspect and avoids `/tmp` date/name drift.

### D4: Lock wait and build timeout are separate concepts

**Decision:** The process SHALL log before waiting for the lock, after acquiring it, and after release. The build timeout SHALL wrap only `pnpm run build` execution after lock acquisition, not the waiting period.

**Rationale:** A worker waiting behind another build should not be counted as a build timeout. If the build itself hangs, `timeout` kills it and releases the lock when the subshell exits.

### D5: Build failure becomes a final judge failure with bounded repair

**Decision:** If final build fails, Tribunal SHALL NOT mark article PASS. It SHALL classify the failure before spending repair tokens:

- Syntax/schema/render failures likely caused by the target post MAY enter writer/fixer repair with build log tail and target post context.
- System/resource failures such as exit 137, OOM-kill evidence, Node/V8 fatal process errors, or infrastructure interruption SHALL NOT be blindly sent to writer as if they were content bugs. They SHOULD fail the build gate as an operational/resource failure, lower concurrency if applicable, and/or alert the operator.

Repair attempts SHALL be bounded by a configured max attempt count.

**Rationale:** Build failures are often actionable and local to writer MDX/frontmatter changes, but OOM/resource failures are not useful writer feedback. Classification avoids wasting tokens on hallucinated content fixes. Bounded repair avoids infinite loops.

## Proposed Flow

1. For each judge stage:
   1. Run judge.
   2. If PASS, persist stage score and continue.
   3. If FAIL, call `tribunal-writer`.
   4. Run cheap validation.
   5. Re-score same stage.
2. After all judge stages PASS:
   1. Enter final build gate.
   2. Ensure the shared lock directory exists with `mkdir -p`.
   3. Wait for shared build lock.
   4. Run `timeout --kill-after=<grace> <BUILD_TIMEOUT> pnpm run build`.
   5. If PASS, mark article PASS.
   6. If FAIL, classify the failure; invoke build fixer only for actionable content/render failures and retry up to max attempts.

## Observability

Logs SHALL include:
- `Waiting for build lock: <path>`
- `Acquired build lock after <seconds>s`
- `Running final pnpm build...`
- `Final build passed in <seconds>s`
- `Final build failed rc=<code> duration=<seconds>s`
- `Released build lock`

Operators SHALL be able to verify safety with:

```bash
ps -eo pid,ppid,stat,etime,%mem,rss,comm,args | grep 'astro.js build'
```

Expected: at most one `astro.js build` per VM while Tribunal is running.

## Risks / Trade-offs

**[Risk] Cheap validation misses a render-only bug** → final full build still catches it before PASS.

**[Risk] Build lock serializes too much and reduces throughput** → intended; token-heavy judge work remains parallel, only RAM-heavy full build serializes.

**[Risk] Lock path accidentally points to each worker worktree** → add explicit logging of resolved lock path and verify with concurrent workers.

**[Risk] Build wait looks like hang** → log waiting/acquired timestamps and keep timeout scoped to build execution.

**[Risk] Final build repair loop consumes tokens** → cap attempts and mark article FAILED/EXHAUSTED on repeated build failure.

## Migration Plan

1. Add shared lock dir export in supervisor if not already present.
2. Implement cheap validation helper in `tribunal-all-claude.sh`.
3. Remove immediate full build from writer rewrite loop.
4. Add final build gate before `mark_article_passed`.
5. Add build-fix loop with max attempts and clear logs.
6. Validate with shell-level flock test and live Tribunal observation.
7. Monitor `systemctl --user show tribunal-loop.service -p MemoryPeak` and count concurrent `astro.js build` processes.
