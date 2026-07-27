import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_URL = new URL('../.github/workflows/deploy-smoke-test.yml', import.meta.url);
const temporaryDirectories: string[] = [];

type Step = {
  if?: string;
  name?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
};

type Job = {
  if?: string;
  'timeout-minutes'?: number;
  steps: Step[];
};

const normalizeExpression = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim();

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe('post-deploy smoke workflow hardening', () => {
  it('runs only terminal Production states and fails closed on deployment errors', async () => {
    const workflow = parse(await readFile(WORKFLOW_URL, 'utf8'));
    const job = workflow.jobs['smoke-test'] as Job;
    const report = job.steps.find((step) => step.name === 'Report deployment failure');
    const notify = job.steps.find((step) => step.name === 'Notify Telegram — deploy failed');

    expect(normalizeExpression(job.if)).toBe(
      "github.event.deployment.environment == 'Production' && (github.event.deployment_status.state == 'success' || github.event.deployment_status.state == 'failure' || github.event.deployment_status.state == 'error')"
    );
    expect(normalizeExpression(report?.if)).toBe(
      "github.event.deployment_status.state == 'failure' || github.event.deployment_status.state == 'error'"
    );
    expect(report?.run).toContain('exit 1');
    expect(normalizeExpression(notify?.if)).toBe(
      "always() && (github.event.deployment_status.state == 'failure' || github.event.deployment_status.state == 'error')"
    );
  });

  it('keeps event payloads out of shell source under least privilege and a bounded runtime', async () => {
    const workflow = parse(await readFile(WORKFLOW_URL, 'utf8'));
    const job = workflow.jobs['smoke-test'] as Job;

    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job['timeout-minutes']).toBe(10);

    const report = job.steps.find((step) => step.name === 'Report deployment failure');
    const notify = job.steps.find((step) => step.name === 'Notify Telegram — deploy failed');

    expect(report?.env).toMatchObject({
      DEPLOYMENT_SHA: '${{ github.event.deployment.sha }}',
      DEPLOYMENT_URL: '${{ github.event.deployment_status.target_url }}',
    });
    expect(report?.run).toContain('"$DEPLOYMENT_SHA"');
    expect(report?.run).toContain('"$DEPLOYMENT_URL"');

    expect(notify?.env).toMatchObject({
      TG_TOKEN: '${{ secrets.TELEGRAM_BOT_TOKEN }}',
      TG_CHAT: '${{ secrets.TELEGRAM_CHAT_ID }}',
      DEPLOYMENT_URL: '${{ github.event.deployment_status.target_url }}',
    });
    expect(notify?.run).toContain('${DEPLOYMENT_URL}');

    const shellSource = job.steps
      .flatMap((step) => (typeof step.run === 'string' ? [step.run] : []))
      .join('\n');

    expect(shellSource).not.toMatch(/\$\{\{\s*github\.event\b/);
  });

  it('selects the latest article routes from frontmatter instead of filename order', async () => {
    const workflow = parse(await readFile(WORKFLOW_URL, 'utf8'));
    const job = workflow.jobs['smoke-test'] as Job;
    const latestArticles = job.steps.find(
      (step) => step.name === 'Smoke test — check latest articles are live'
    );

    expect(latestArticles?.run).toContain('/^translatedDate:/');
    expect(latestArticles?.run).toContain("LC_ALL=C sort -t '|' -k1,1r -k2,2");
    expect(latestArticles?.run).toContain('while IFS= read -r filename');
    expect(latestArticles?.run).not.toMatch(/\bls src\/content\/posts|\bsort -r\b/);
    expect(latestArticles?.shell).toBe('bash');

    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gu-log-deploy-smoke-'));
    temporaryDirectories.push(fixtureRoot);
    const postsDirectory = path.join(fixtureRoot, 'src/content/posts');
    const binDirectory = path.join(fixtureRoot, 'bin');
    const curlLog = path.join(fixtureRoot, 'curl.log');
    mkdirSync(postsDirectory, { recursive: true });
    mkdirSync(binDirectory);

    const fixtures = [
      ['gp-1-newest-by-frontmatter.mdx', '2026-07-25'],
      ['gp-2-alpha-tie.mdx', '2026-07-24'],
      ['gp-3-beta-tie.mdx', '2026-07-24'],
      ['gp-4-fourth.mdx', '2026-07-23'],
      ['gp-5-fifth.mdx', '2026-07-22'],
      ['gp-6-sixth.mdx', '2026-07-21'],
      ['gp-7-seventh.mdx', '2026-07-20'],
      ['gp-8-eighth.mdx', '2026-07-19'],
      ['gp-9-ninth.mdx', '2026-07-18'],
      ['mp-1-tenth.mdx', '2026-07-17'],
      ['sd-99-filename-sorts-first.mdx', '2026-01-01'],
      ['en-gp-999-english-is-not-a-zh-route.mdx', '2026-07-27'],
    ] as const;
    for (const [filename, translatedDate] of fixtures) {
      const quote = filename === 'gp-1-newest-by-frontmatter.mdx' ? "'" : '"';
      writeFileSync(
        path.join(postsDirectory, filename),
        `---\ntranslatedDate: ${quote}${translatedDate}${quote}\n---\n`
      );
    }

    const fakeCurl = path.join(binDirectory, 'curl');
    writeFileSync(
      fakeCurl,
      `#!/bin/sh
for argument in "$@"; do
  case "$argument" in
    https://*) printf '%s\\n' "$argument" >> "$CURL_LOG" ;;
  esac
done
printf '200'
`
    );
    chmodSync(fakeCurl, 0o755);

    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', latestArticles?.run ?? 'exit 1'],
      {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          CURL_LOG: curlLog,
          PATH: `${binDirectory}:${process.env.PATH}`,
        },
        stdio: 'pipe',
      }
    );
    if (result.status !== 0) {
      throw new Error(`latest article smoke fixture failed: ${result.stderr.toString()}`);
    }

    const requestedUrls = readFileSync(curlLog, 'utf8').trim().split('\n');
    expect(requestedUrls).toHaveLength(10);
    expect(requestedUrls.slice(0, 3)).toEqual([
      'https://gu-log.vercel.app/posts/gp-1-newest-by-frontmatter',
      'https://gu-log.vercel.app/posts/gp-2-alpha-tie',
      'https://gu-log.vercel.app/posts/gp-3-beta-tie',
    ]);
    expect(requestedUrls).not.toContain(
      'https://gu-log.vercel.app/posts/sd-99-filename-sorts-first'
    );

    const invalidFixtureRoot = mkdtempSync(path.join(tmpdir(), 'gu-log-deploy-smoke-invalid-'));
    temporaryDirectories.push(invalidFixtureRoot);
    const invalidPostsDirectory = path.join(invalidFixtureRoot, 'src/content/posts');
    mkdirSync(invalidPostsDirectory, { recursive: true });
    writeFileSync(
      path.join(invalidPostsDirectory, 'gp-1-missing-date.mdx'),
      '---\ntitle: Missing date\n---\n'
    );

    const invalidResult = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', latestArticles?.run ?? 'exit 1'],
      {
        cwd: invalidFixtureRoot,
        env: process.env,
        stdio: 'pipe',
      }
    );
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr.toString()).toContain(
      'Missing or invalid translatedDate for latest article smoke selection'
    );
  });
});
