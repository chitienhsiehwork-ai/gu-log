/**
 * GP is score-only in Tribunal (openspec gp-source-preservation; CONTRIBUTING.md
 * 〈兩層品質門檻〉): scripts/tribunal.sh runs all four judges on a GP even after
 * one fails, writes every judge's score — failing ones included — to the
 * frontmatter of both language versions, and leaves the body untouched, so
 * the post still validates and ships zh-tw on the floor rule. The judges are a fake Codex CLI; no model is called.
 * Tribunal v2 is covered in tests/tribunal-v2/pipeline.test.ts.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import * as validatePostsModule from '../scripts/validate-posts.mjs';
import {
  EN_GP_POST,
  EN_POST_FILE,
  GP_POST,
  JUDGES,
  POST_FILE,
  SCORE_KEYS,
  SOURCE_URL,
  makeTribunalRepo,
  runTribunal,
} from './helpers/tribunal-fixture';
import { useTestTempDirectories } from './helpers/temp-directories';

// validate-posts.mjs is plain JS without .d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { validatePost } = validatePostsModule as any;

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
// tribunal.sh needs flock and GNU timeout: the Linux Tribunal runtime.
const linuxIt = process.platform === 'linux' ? it : it.skip;

const makeRepo = () => makeTribunalRepo(makeTempDirectory);

describe('scripts/tribunal.sh scores a GP with every judge', () => {
  linuxIt.each([
    ['fact-checker', 'factCheck', 'factChecker'], // the first stage
    ['vibe-opus-scorer', 'vibe', 'vibe'], // the last stage
  ])(
    'records all four scores in both languages when %s fails, and the GP still validates',
    (failingJudge, failingKey, failingStage) => {
      const run = runTribunal(makeRepo(), { failingJudge });

      expect(run.result.error, run.output).toBeUndefined();
      expect(run.result.status, run.output).toBe(1);
      expect(run.judges, run.output).toEqual(JUDGES);
      expect(run.claudeCalls, 'no writer or Claude call may run on a GP').toBe('');

      const zh = matter(fs.readFileSync(run.postPath, 'utf8'));
      const scores = zh.data.scores as Record<string, Record<string, number>>;
      for (const key of SCORE_KEYS) {
        expect(scores?.[key]?.score, `${key}\n${run.output}`).toBe(key === failingKey ? 6 : 9);
      }
      const en = matter(fs.readFileSync(run.enPath, 'utf8'));
      expect(en.data.scores, 'the English version carries the same scores').toEqual(scores);

      for (const [file, after, before] of [
        [run.postPath, zh, matter(GP_POST)],
        [run.enPath, en, matter(EN_GP_POST)],
      ] as const) {
        expect(after.content, file).toBe(before.content);
        expect(validatePost(file, []).errors, file).toEqual([]);
      }

      const entry = run.progress[POST_FILE];
      expect(entry?.status).toBe('FAILED');
      expect(entry?.failedStage).toBe(failingStage);
      // The FactChecker verdict is bound to the harness-verified source hash,
      // captured exactly once per invocation.
      expect(run.fetches, run.output).toEqual([SOURCE_URL]);
      expect(entry?.stages?.factChecker?.sourceEvidence?.schemaVersion).toBe(1);
      expect(entry?.stages?.factChecker?.sourceEvidence?.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry?.inputFingerprint, run.output).toMatch(
        new RegExp(`^${POST_FILE}=\\w+,${EN_POST_FILE}=\\w+$`)
      );
      expect(run.output).toContain('GP is score-only');
    },
    120_000
  );
});

// #1098: Tribunal cannot rewrite a GP, so re-judging unchanged content only
// re-rolls the judges. The daemon selectors skip a failed GP until its reader
// content changes.
describe('a failed GP is not selected again until its content changes', () => {
  function inputUnchanged(root: string) {
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source scripts/tribunal-helpers.sh && tribunal_failed_input_unchanged "$1" "$2" "$3"',
        'bash',
        '.score-loop/state/tribunal-progress.json',
        'src/content/posts',
        POST_FILE,
      ],
      { cwd: root, encoding: 'utf8' }
    );
    expect(result.error).toBeUndefined();
    return result.status === 0;
  }

  linuxIt(
    'skips the unchanged GP, then selects it after a zh-tw or English body edit',
    () => {
      const run = runTribunal(makeRepo(), { failingJudge: 'fact-checker' });
      expect(run.result.status, run.output).toBe(1);
      // The failing scores were written back, yet the reader input is unchanged.
      expect(inputUnchanged(run.root), run.output).toBe(true);

      for (const file of [run.postPath, run.enPath]) {
        const before = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(file, `${before}\n補一句修正。\n`);
        expect(inputUnchanged(run.root), file).toBe(false);
        fs.writeFileSync(file, before);
        expect(inputUnchanged(run.root), file).toBe(true);
      }
    },
    120_000
  );

  linuxIt(
    'gives a fixed GP a fresh attempt budget instead of marking it EXHAUSTED',
    () => {
      const first = runTribunal(makeRepo(), { failingJudge: 'fact-checker' });
      const progressPath = path.join(first.root, '.score-loop/state/tribunal-progress.json');
      first.progress[POST_FILE].topLevelAttempts = 5;
      fs.writeFileSync(progressPath, JSON.stringify(first.progress));
      fs.writeFileSync(
        first.postPath,
        `${fs.readFileSync(first.postPath, 'utf8')}\n補一句修正。\n`
      );
      fs.rmSync(path.join(first.root, 'judges.log'));

      const second = runTribunal(
        { root: first.root, bin: first.bin },
        { failingJudge: 'fact-checker' }
      );
      expect(second.result.status, second.output).toBe(1);
      expect(second.judges, second.output).toEqual(JUDGES);
      expect(second.progress[POST_FILE].status).toBe('FAILED');
      expect(second.progress[POST_FILE].topLevelAttempts).toBe(1);
    },
    120_000
  );

  linuxIt(
    'selects a FAILED entry that has no recorded fingerprint',
    () => {
      const run = runTribunal(makeRepo(), { failingJudge: 'fact-checker' });
      const progressPath = path.join(run.root, '.score-loop/state/tribunal-progress.json');
      delete run.progress[POST_FILE].inputFingerprint;
      fs.writeFileSync(progressPath, JSON.stringify(run.progress));
      expect(inputUnchanged(run.root)).toBe(false);
    },
    120_000
  );
});
