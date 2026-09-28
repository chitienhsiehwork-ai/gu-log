/**
 * GP is score-only in Tribunal (openspec gp-source-preservation; CONTRIBUTING.md
 * 〈兩層品質門檻〉): scripts/tribunal.sh runs all four judges on a GP even after
 * one fails, writes every judge's score — failing ones included — to the
 * frontmatter, and leaves the body and the source-distance stamp untouched, so
 * the post still validates and ships zh-tw on the floor rule. The judges are a
 * fake Codex CLI; no model is called. Tribunal v2 is covered in
 * tests/tribunal-v2/pipeline.test.ts.
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
const JUDGES = ['fact-checker', 'librarian', 'fresh-eyes', 'vibe-opus-scorer'];

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
  for (const file of [
    'config/llm-pipeline.json',
    'src/data/glossary.json',
    'quality/brand-taxonomy-residual-allowlist.json',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
  }
  fs.mkdirSync(path.join(root, 'src/content/posts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/content/posts', POST_FILE), GP_POST);

  const bin = path.join(root, 'fake-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), FAKE_CODEX, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
  fs.mkdirSync(path.join(root, 'article-locks'), { mode: 0o700 });

  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  expect(git.status, git.stderr).toBe(0);
  return { root, bin };
}

function runTribunal(failingJudge: string) {
  const { root, bin } = makeRepo();
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
    result,
    output: result.stdout + result.stderr,
    postPath: path.join(root, 'src/content/posts', POST_FILE),
    judges: read('judges.log').trim().split('\n').filter(Boolean),
    claudeCalls: read('claude.log'),
    progress: JSON.parse(read('.score-loop/state/tribunal-progress.json') || '{}'),
  };
}

describe('scripts/tribunal.sh scores a GP with every judge', () => {
  linuxIt.each([
    ['fact-checker', 'factCheck', 'factChecker'],
    ['librarian', 'librarian', 'librarian'],
    ['vibe-opus-scorer', 'vibe', 'vibe'],
  ])(
    'records all four scores when %s fails, and the GP still validates',
    (failingJudge, failingKey, failingStage) => {
      const run = runTribunal(failingJudge);

      expect(run.result.error, run.output).toBeUndefined();
      expect(run.result.status, run.output).toBe(1);
      expect(run.judges, run.output).toEqual(JUDGES);
      expect(run.claudeCalls, 'no writer or Claude call may run on a GP').toBe('');

      const after = fs.readFileSync(run.postPath, 'utf8');
      const scores = matter(after).data.scores as Record<string, Record<string, number>>;
      for (const key of ['factCheck', 'librarian', 'freshEyes', 'vibe']) {
        expect(scores?.[key]?.score, `${key}\n${run.output}`).toBe(key === failingKey ? 6 : 9);
      }

      const before = matter(GP_POST);
      expect(matter(after).content).toBe(before.content);
      expect(matter(after).data.sourceDistance).toEqual(before.data.sourceDistance);
      expect(validatePost(run.postPath, []).errors).toEqual([]);

      const entry = run.progress[POST_FILE];
      expect(entry?.status).toBe('FAILED');
      expect(entry?.failedStage).toBe(failingStage);
      expect(run.output).toContain('GP is score-only');
    },
    120_000
  );
});
