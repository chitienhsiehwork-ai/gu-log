import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOWS_URL = new URL('../.github/workflows/', import.meta.url);
const WORKFLOW_URL = new URL('ci.yml', WORKFLOWS_URL);

type WorkflowStep = {
  if?: string;
  'continue-on-error'?: boolean | string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  'working-directory'?: string;
};

type WorkflowJob = {
  if?: string;
  'continue-on-error'?: boolean | string;
  needs?: string[];
  steps?: WorkflowStep[];
  'timeout-minutes'?: number;
};

type Workflow = { jobs: Record<string, WorkflowJob> };

async function readWorkflow(url: URL): Promise<Workflow> {
  return parse(await readFile(url, 'utf8')) as Workflow;
}

describe('Gitleaks CI workflow', () => {
  it('pins the scanner binary to an explicit stable semver', async () => {
    const workflow = await readWorkflow(WORKFLOW_URL);
    const action = (workflow.jobs.gitleaks.steps as WorkflowStep[]).find((step) =>
      step.uses?.startsWith('gitleaks/gitleaks-action@')
    );

    expect(action).toBeDefined();
    expect(action?.env?.GITLEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// openspec: gp-pipeline-publish-integrity — gp-pipeline 的 Go 測試是 PR 必要檢查。
describe('gp-pipeline Go test leaf', () => {
  const GO_JOB = 'gp-pipeline-go-tests';
  const GO_TEST = 'go test -count=1 ./...';

  it('runs the uncached Go suite after installing repo Node packages, with a time limit', async () => {
    const job = (await readWorkflow(WORKFLOW_URL)).jobs[GO_JOB];
    expect(job, `ci.yml has no ${GO_JOB} job`).toBeDefined();
    expect(job.if).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThan(0);

    const steps = job.steps ?? [];
    const setupPnpm = steps.findIndex((step) => step.uses === './.github/actions/setup-pnpm');
    const setupGo = steps.findIndex((step) => step.uses?.startsWith('actions/setup-go@'));
    const goTest = steps.findIndex((step) => step.run?.trim() === GO_TEST);

    expect(setupPnpm, 'setup-pnpm step missing').toBeGreaterThanOrEqual(0);
    expect(setupGo, 'setup-go step missing').toBeGreaterThanOrEqual(0);
    expect(goTest, `step running "${GO_TEST}" missing`).toBeGreaterThan(setupPnpm);
    expect(goTest).toBeGreaterThan(setupGo);
    expect(steps[setupGo].with?.['go-version-file']).toBe('tools/gp-pipeline/go.mod');
    expect(steps[setupGo].with?.['cache-dependency-path']).toBe('tools/gp-pipeline/go.sum');
    expect(steps[goTest]['working-directory']).toBe('tools/gp-pipeline');
    expect(steps[goTest].if).toBeUndefined();
  });

  it('gates ci-passed, which only accepts a literal success result', async () => {
    const { jobs } = await readWorkflow(WORKFLOW_URL);
    const ciPassed = jobs['ci-passed'];
    expect(ciPassed.needs).toContain(GO_JOB);
    expect(ciPassed.steps?.[0].run).toContain('.result == "success"');
    // continue-on-error would report a failed Go suite to ci-passed as success.
    expect(jobs[GO_JOB]['continue-on-error']).toBeUndefined();
    for (const step of jobs[GO_JOB].steps ?? []) {
      expect(step['continue-on-error']).toBeUndefined();
    }
  });

  it('is the only place any workflow runs Go tests', async () => {
    const owners: string[] = [];
    for (const file of (await readdir(WORKFLOWS_URL)).filter((name) => /\.ya?ml$/.test(name))) {
      const workflow = await readWorkflow(new URL(file, WORKFLOWS_URL));
      for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
        if ((job.steps ?? []).some((step) => /\bgo test\b/.test(step.run ?? ''))) {
          owners.push(`${file}:${jobId}`);
        }
      }
    }
    expect(owners).toEqual([`ci.yml:${GO_JOB}`]);
  });
});

// `pnpm test` 要跟 PR CI 擋的同一套。package.json 和 ci.yml 各寫一份指令，
// check-spec-ownership.mjs 又刻意不掃 package.json，所以在這裡把兩邊鎖在一起。
describe('local pnpm test scripts mirror the blocking CI test jobs', () => {
  const normalize = (command: string) => command.replace(/'/g, '"').replace(/\s+/g, ' ').trim();

  async function readScripts(): Promise<Record<string, string>> {
    return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  }

  async function ciCommands(jobId: string, pattern: RegExp): Promise<string[]> {
    const steps = (await readWorkflow(WORKFLOW_URL)).jobs[jobId]?.steps ?? [];
    const run = steps.map((step) => step.run ?? '').find((script) => pattern.test(script));
    expect(run, `ci.yml ${jobId} has no step matching ${pattern}`).toBeDefined();
    return (run ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('set '))
      .map(normalize);
  }

  it('test:e2e runs the same spec list, project and retries as e2e-core', async () => {
    const local = (await readScripts())['test:e2e'].split('&&').map(normalize);
    expect(local).toEqual(await ciCommands('e2e-core', /\bplaywright test\b/));
  });

  it('test:unit runs the same Vitest suite as unit-tests', async () => {
    const [ci] = await ciCommands('unit-tests', /\bvitest run\b/);
    const withoutReporter = (command: string) => command.replace(/\s--reporter=\S+/g, '');
    expect(withoutReporter(normalize((await readScripts())['test:unit']))).toBe(
      withoutReporter(ci)
    );
  });
});
