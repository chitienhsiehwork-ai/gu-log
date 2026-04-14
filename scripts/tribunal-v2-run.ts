#!/usr/bin/env node
/**
 * Tribunal v2 — CLI Entry Point
 *
 * Usage:
 *   pnpm tribunal:run src/content/posts/cp-291-foo.mdx
 *   pnpm tribunal:run src/content/posts/cp-291-foo.mdx --apply-squash   # flip squash-merge from log-only → apply
 *   pnpm tribunal:run --list-in-progress                                 # show stalled runs
 *
 * Wires runners + adapters + progress persistence to runPipeline().
 *
 * Requires Node 24+ (native TypeScript strip-types). Checked on Node 25.
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  runPipeline,
  type PipelineState,
  type PipelineConfig,
} from '../src/lib/tribunal-v2/pipeline';
import { buildRunners } from '../src/lib/tribunal-v2/runners/stage-runners';
import { buildGitAdapter } from '../src/lib/tribunal-v2/adapters/git';
import { buildIoAdapter } from '../src/lib/tribunal-v2/adapters/io';
import {
  saveProgress,
  loadProgress,
  listInProgress,
  markCompleted,
} from '../src/lib/tribunal-v2/progress';

function usage(): never {
  console.error(`Usage:
  pnpm tribunal:run <article-path>            # run pipeline
  pnpm tribunal:run <article-path> --resume   # resume from saved progress
  pnpm tribunal:run --list-in-progress        # list stalled runs

Env:
  TRIBUNAL_V2_SQUASH_MERGE=apply              # actually squash-merge (default: log-only)
`);
  process.exit(2);
}

function printStateSummary(state: PipelineState): void {
  type AnyStage = {
    status: string;
    loops: number;
    maxLoops: number;
    output?: unknown;
  };
  const fmt = (label: string, s: AnyStage): string => {
    const out = s.output as
      | { composite?: number; pass?: boolean; scores?: Record<string, number> }
      | undefined;
    const dims = out?.scores ? ` scores=${JSON.stringify(out.scores)}` : '';
    const pass = out?.pass !== undefined ? ` pass=${out.pass}` : '';
    const comp = out?.composite !== undefined ? ` composite=${out.composite}` : '';
    return `  ${label}: status=${s.status} loops=${s.loops}/${s.maxLoops}${pass}${comp}${dims}`;
  };

  console.log('\n======= PIPELINE SUMMARY =======');
  console.log(`article:   ${state.articlePath}`);
  console.log(`branch:    ${state.articleBranch}`);
  console.log(`status:    ${state.status}`);
  console.log(`attempt:   ${state.crossRunAttempt}`);
  console.log(`startedAt: ${state.startedAt}`);
  if (state.completedAt) console.log(`completed: ${state.completedAt}`);
  console.log('\nstages:');
  console.log(fmt('stage0 (worthiness)', state.stages.stage0));
  console.log(fmt('stage1 (vibe)      ', state.stages.stage1));
  console.log(fmt('stage2 (freshEyes) ', state.stages.stage2));
  console.log(fmt('stage3 (factLib)   ', state.stages.stage3));
  console.log(fmt('stage4 (finalVibe) ', state.stages.stage4));
  console.log('================================\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();

  if (argv[0] === '--list-in-progress') {
    const states = await listInProgress();
    if (states.length === 0) {
      console.log('(no in-progress tribunal runs)');
      return;
    }
    console.log(`${states.length} in-progress runs:`);
    for (const s of states) {
      console.log(
        `  ${s.articlePath} | branch=${s.articleBranch} | stage=${s.currentStage} | started=${s.startedAt}`
      );
    }
    return;
  }

  const articlePath = resolve(argv[0]);
  if (!existsSync(articlePath)) {
    console.error(`Article not found: ${articlePath}`);
    process.exit(1);
  }

  const resume = argv.includes('--resume');
  const existing = resume ? await loadProgress(articlePath) : null;
  if (resume && !existing) {
    console.error(`No saved progress for ${articlePath}. Remove --resume to start fresh.`);
    process.exit(1);
  }
  if (existing) {
    console.log(`Resuming from saved progress at stage ${existing.currentStage}...`);
  }

  const config: PipelineConfig = {
    runners: buildRunners(articlePath),
    git: buildGitAdapter(),
    io: buildIoAdapter(),
    onProgress: async (state) => {
      await saveProgress(state);
    },
  };

  console.log(`\n[tribunal-v2] starting pipeline for ${articlePath}`);
  console.log(
    `[tribunal-v2] squash-merge mode: ${process.env.TRIBUNAL_V2_SQUASH_MERGE === 'apply' ? 'APPLY' : 'log-only'}`
  );

  const final = await runPipeline(articlePath, config, existing ?? undefined);
  printStateSummary(final);

  if (final.status === 'passed') {
    await markCompleted(articlePath);
    console.log('[tribunal-v2] done — status: PASSED');
    process.exit(0);
  } else if (final.status === 'failed') {
    console.log('[tribunal-v2] done — status: FAILED');
    process.exit(1);
  } else if (final.status === 'needs_review') {
    console.log('[tribunal-v2] done — status: NEEDS_REVIEW');
    process.exit(3);
  } else {
    console.log(`[tribunal-v2] done — status: ${final.status}`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\n[tribunal-v2] pipeline error:');
  console.error(err);
  process.exit(1);
});
