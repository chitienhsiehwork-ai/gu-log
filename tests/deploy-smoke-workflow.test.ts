import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_URL = new URL('../.github/workflows/deploy-smoke-test.yml', import.meta.url);

type Step = {
  if?: string;
  name?: string;
  run?: string;
  env?: Record<string, string>;
};

type Job = {
  if?: string;
  'timeout-minutes'?: number;
  steps: Step[];
};

const normalizeExpression = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim();

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
});
