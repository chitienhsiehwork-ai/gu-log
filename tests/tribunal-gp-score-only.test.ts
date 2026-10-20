/**
 * GP is score-only in Tribunal (openspec gp-source-preservation; CONTRIBUTING.md
 * 〈兩層品質門檻〉): scripts/tribunal.sh runs all four judges on a GP even after
 * one fails, writes every judge's score — failing ones included — to the
 * frontmatter of both language versions, and leaves the body and the
 * source-distance stamp untouched, so the post still validates and ships zh-tw
 * on the floor rule. The judges are a fake Codex CLI; no model is called.
 * Tribunal v2 is covered in tests/tribunal-v2/pipeline.test.ts.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import * as validatePostsModule from '../scripts/validate-posts.mjs';
import { withValidStamp } from './helpers/source-distance-stamp';
import { useTestTempDirectories } from './helpers/temp-directories';

// validate-posts.mjs is plain JS without .d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { validatePost } = validatePostsModule as any;

const ROOT = path.resolve(__dirname, '..');
const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
// tribunal.sh needs flock and GNU timeout: the Linux Tribunal runtime.
const linuxIt = process.platform === 'linux' ? it : it.skip;

const POST_FILE = 'gp-pending-20260928-logbook.mdx';
const EN_POST_FILE = `en-${POST_FILE}`;
const JUDGES = ['fact-checker', 'librarian', 'fresh-eyes', 'vibe-opus-scorer'];
const SCORE_KEYS = ['factCheck', 'librarian', 'freshEyes', 'vibe'];

const GP_POST = withValidStamp(
  [
    '---',
    'ticketId: "GP-PENDING"',
    'title: "燈塔日誌教會值班的一件事"',
    'originalDate: "2026-08-30"',
    'translatedDate: "2026-09-28"',
    'source: "Mara Quill"',
    'sourceUrl: "https://keeper-notes.test/posts/logbook-on-call"',
    'summary: "沒事也要寫一行"',
    'lang: zh-tw',
    'translatedBy:',
    '  model: Opus 5.5',
    '  harness: Claude Code',
    '---',
    '正文充足內容'.repeat(40),
    '',
    'Mara Quill 把燈塔日誌搬進值班交接，沒事也要寫一行 (◕‿◕)',
    '',
  ].join('\n')
);

const EN_GP_POST = withValidStamp(
  [
    '---',
    'ticketId: "GP-PENDING"',
    'title: "What a lighthouse logbook teaches on-call"',
    'originalDate: "2026-08-30"',
    'translatedDate: "2026-09-28"',
    'source: "Mara Quill"',
    'sourceUrl: "https://keeper-notes.test/posts/logbook-on-call"',
    'summary: "Write a line even when nothing happens"',
    'lang: en',
    'translatedBy:',
    '  model: Opus 5.5',
    '  harness: Claude Code',
    '---',
    'Enough body text here. '.repeat(40),
    '',
    'Mara Quill moved the lighthouse logbook into the on-call handoff (◕‿◕)',
    '',
  ].join('\n')
);

// A fake Codex judge: it answers for the agent named in the prompt, writes the
// score where the prompt asks, and scores FAKE_FAILING_JUDGE below the bar.
const FAKE_CODEX = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "codex-cli 0.128.0"; exit 0; fi
if [ "\${1:-}" = "exec" ] && [ "\${2:-}" = "--help" ]; then exit 0; fi
[ "\${1:-}" = "exec" ] || exit 1
prompt="\${!#}"
agent="$(printf '%s\\n' "$prompt" | sed -n 's/^## Codex agent config: //p' | head -1)"
score_path="$(printf '%s\\n' "$prompt" | sed -n 's/^Write your JSON result to: //p' | tail -1)"
[ -n "$agent" ] && [ -n "$score_path" ] || exit 72
printf '%s\\n' "$agent" >> "$FAKE_JUDGE_LOG"
n=9; verdict=PASS
if [ "$agent" = "$FAKE_FAILING_JUDGE" ]; then n=6; verdict=FAIL; fi
case "$agent" in
  fact-checker) judge=factCheck; dims="accuracy fidelity consistency sourceBoundary commentarySeparation" ;;
  librarian) judge=librarian; dims="glossary crossRef sourceAlign attribution" ;;
  fresh-eyes) judge=freshEyes; dims="readability firstImpression payoffDensity lengthFit clarity" ;;
  vibe-opus-scorer) judge=vibe; dims="persona moguNote vibe narrative" ;;
  *) exit 73 ;;
esac
dimensions=""; reasons=""
for dim in $dims; do
  dimensions="$dimensions\${dimensions:+,}\\"$dim\\":$n"
  reasons="$reasons\${reasons:+,}\\"$dim\\":\\"fixture\\""
done
printf '{"judge":"%s","dimensions":{%s},"score":%s,"verdict":"%s","reasons":{%s}}\\n' \\
  "$judge" "$dimensions" "$n" "$verdict" "$reasons" > "$score_path"
`;

// Tribunal never rewrites a GP; a Claude call here would be a writer (or a
// real model call), so the fake only records that it happened.
const FAKE_CLAUDE = `#!/usr/bin/env bash
printf 'claude %s\\n' "$*" >> "$FAKE_CLAUDE_LOG"
exit 1
`;

function makeRepo() {
  const root = makeTempDirectory('gu-log-tribunal-gp-score-only-');
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  for (const dir of ['.claude/agents', '.codex/agents']) {
    fs.cpSync(path.join(ROOT, dir), path.join(root, dir), { recursive: true });
  }
  for (const file of ['config/llm-pipeline.json', 'src/data/glossary.json']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/content/posts', POST_FILE), GP_POST);
  fs.writeFileSync(path.join(root, 'src/content/posts', EN_POST_FILE), EN_GP_POST);

  const bin = path.join(root, 'fake-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.mkdirSync(path.join(root, 'article-locks'), { mode: 0o700 });
  // The reader-input fingerprint runs the repo's Node helper.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));

  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  expect(git.status, git.stderr).toBe(0);
  return { root, bin };
}

function runTribunal(failingJudge: string, repo = makeRepo()) {
  const { root, bin } = repo;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'GP_WRITER_MODE',
    'TRIBUNAL_RUNTIME_PROFILE',
    'TRIBUNAL_STRICT_ROLE_PROVIDERS',
    'TRIBUNAL_DEPLOYED_MODE',
    'TRIBUNAL_MODEL_CONFIG',
    'PROGRESS_FILE',
    'TRIBUNAL_MAIN_REPO',
    'TRIBUNAL_SCORE_OUTPUT',
  ]) {
    delete env[key];
  }
  const result = spawnSync('bash', ['scripts/tribunal.sh', POST_FILE], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90_000,
    killSignal: 'SIGKILL',
    env: {
      ...env,
      PATH: `${bin}:${process.env.PATH}`,
      TRIBUNAL_FORCE_PROVIDER: 'codex',
      TRIBUNAL_NO_COMMIT: '1',
      TRIBUNAL_ARTICLE_LOCK_DIR: path.join(root, 'article-locks'),
      TRIBUNAL_CODEX_TIMEOUT_SEC: '30',
      TRIBUNAL_CODEX_IDLE_TIMEOUT_SEC: '30',
      TRIBUNAL_CODEX_IDLE_POLL_SEC: '1',
      FAKE_FAILING_JUDGE: failingJudge,
      FAKE_JUDGE_LOG: path.join(root, 'judges.log'),
      FAKE_CLAUDE_LOG: path.join(root, 'claude.log'),
    },
  });
  const read = (file: string) =>
    fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '';
  return {
    root,
    bin,
    result,
    output: result.stdout + result.stderr,
    postPath: path.join(root, 'src/content/posts', POST_FILE),
    enPath: path.join(root, 'src/content/posts', EN_POST_FILE),
    judges: read('judges.log').trim().split('\n').filter(Boolean),
    claudeCalls: read('claude.log'),
    progress: JSON.parse(read('.score-loop/state/tribunal-progress.json') || '{}'),
  };
}

describe('scripts/tribunal.sh scores a GP with every judge', () => {
  linuxIt.each([
    ['fact-checker', 'factCheck', 'factChecker'], // the first stage
    ['vibe-opus-scorer', 'vibe', 'vibe'], // the last stage
  ])(
    'records all four scores in both languages when %s fails, and the GP still validates',
    (failingJudge, failingKey, failingStage) => {
      const run = runTribunal(failingJudge);

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
        expect(after.data.sourceDistance, file).toEqual(before.data.sourceDistance);
        expect(validatePost(file, []).errors, file).toEqual([]);
      }

      const entry = run.progress[POST_FILE];
      expect(entry?.status).toBe('FAILED');
      expect(entry?.failedStage).toBe(failingStage);
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
      const run = runTribunal('fact-checker');
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
      const first = runTribunal('fact-checker');
      const progressPath = path.join(first.root, '.score-loop/state/tribunal-progress.json');
      first.progress[POST_FILE].topLevelAttempts = 5;
      fs.writeFileSync(progressPath, JSON.stringify(first.progress));
      fs.writeFileSync(
        first.postPath,
        `${fs.readFileSync(first.postPath, 'utf8')}\n補一句修正。\n`
      );
      fs.rmSync(path.join(first.root, 'judges.log'));

      const second = runTribunal('fact-checker', { root: first.root, bin: first.bin });
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
      const run = runTribunal('fact-checker');
      const progressPath = path.join(run.root, '.score-loop/state/tribunal-progress.json');
      delete run.progress[POST_FILE].inputFingerprint;
      fs.writeFileSync(progressPath, JSON.stringify(run.progress));
      expect(inputUnchanged(run.root)).toBe(false);
    },
    120_000
  );
});
