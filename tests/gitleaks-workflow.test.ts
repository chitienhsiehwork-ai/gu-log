import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_URL = new URL('../.github/workflows/ci.yml', import.meta.url);

type WorkflowStep = {
  uses?: string;
  env?: Record<string, string>;
};

describe('Gitleaks CI workflow', () => {
  it('pins the scanner binary to an explicit stable semver', async () => {
    const workflow = parse(await readFile(WORKFLOW_URL, 'utf8'));
    const action = (workflow.jobs.gitleaks.steps as WorkflowStep[]).find((step) =>
      step.uses?.startsWith('gitleaks/gitleaks-action@')
    );

    expect(action).toBeDefined();
    expect(action?.env?.GITLEAKS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
