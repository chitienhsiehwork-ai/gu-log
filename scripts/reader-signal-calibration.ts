#!/usr/bin/env tsx
/**
 * Reader signal calibration report (openspec: reader-signal-calibration).
 *
 *   pnpm reader:calibrate -- --events <export.json> [--min-sample 10] [--json]
 *
 * Read-only: it only reads the export, post frontmatter scores and the reader
 * revision manifest, then prints. It never writes files or touches Tribunal state.
 * Logic lives in src/lib/reader-signal-calibration.ts; this file is I/O only.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MIN_SAMPLE,
  buildCalibrationReport,
  formatCalibrationReport,
  parseHumanSignalExport,
  type CalibrationPost,
} from '../src/lib/reader-signal-calibration';
import { DEFAULT_POSTS_DIR, readPostIndex } from './lib/taken-down-posts.mjs';

const DEFAULT_REVISIONS = fileURLToPath(
  new URL('../src/data/post-reader-revisions.json', import.meta.url)
);

function usage(message: string): never {
  console.error(`${message}
用法：pnpm reader:calibrate -- --events <export.json> [--min-sample ${DEFAULT_MIN_SAMPLE}] [--json]
       [--posts-dir <dir>] [--revisions <post-reader-revisions.json>]`);
  process.exit(2);
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    events: { type: 'string' },
    'min-sample': { type: 'string' },
    json: { type: 'boolean', default: false },
    'posts-dir': { type: 'string' },
    revisions: { type: 'string' },
  },
});

if (!values.events) usage('缺少 --events');
const minSample = Number(values['min-sample'] ?? DEFAULT_MIN_SAMPLE);
if (!Number.isInteger(minSample) || minSample < 1) usage('--min-sample 必須是正整數');

const exported = parseHumanSignalExport(JSON.parse(readFileSync(values.events, 'utf8')));
const revisions = JSON.parse(readFileSync(values.revisions ?? DEFAULT_REVISIONS, 'utf8')) as Record<
  string,
  string
>;
const posts: CalibrationPost[] = readPostIndex(values['posts-dir'] ?? DEFAULT_POSTS_DIR).map(
  (post: { file: string; data: Record<string, unknown> }) => {
    const postId = post.file.replace(/\.mdx$/i, '');
    return {
      postId,
      title: typeof post.data.title === 'string' ? post.data.title : undefined,
      readerRevision: revisions[postId] ?? null,
      scores: post.data.scores as CalibrationPost['scores'],
    };
  }
);

const report = buildCalibrationReport({ events: exported.events, posts, minSample });
process.stdout.write(
  values.json ? `${JSON.stringify(report, null, 2)}\n` : formatCalibrationReport(report)
);
