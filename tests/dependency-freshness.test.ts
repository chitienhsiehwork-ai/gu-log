import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNER_PATH = path.join(REPO_ROOT, 'scripts', 'dependency-freshness.mjs');

type Scenario =
  | 'success'
  | 'deprecated'
  | 'outdated-partial-failure'
  | 'metadata-failure'
  | 'metadata-timeout'
  | 'concurrency';

const VALID_RULES = {
  blockOnDeprecated: true,
  warnOnOutdated: true,
  warnOnUnmaintainedYears: 2,
  maxOutdatedPercent: 30,
};

function makeHarness(
  scenario: Scenario,
  preserveArtifacts = false,
  rulesContents: string | null = JSON.stringify(VALID_RULES)
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-dependency-freshness-'));
  const scriptsDir = path.join(root, 'scripts');
  const qualityDir = path.join(root, 'quality');
  const binDir = path.join(root, 'bin');
  const commandLog = path.join(root, 'pnpm-commands.jsonl');
  const activityLog = path.join(root, 'pnpm-activity.jsonl');
  const activityDir = path.join(root, 'pnpm-active');
  const rulesPath = path.join(qualityDir, 'dependency-rules.json');
  const baselinePath = path.join(qualityDir, 'dependency-freshness-baseline.json');
  const historyPath = path.join(qualityDir, 'dependency-freshness-history.json');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(qualityDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(SCANNER_PATH, path.join(scriptsDir, 'dependency-freshness.mjs'));

  if (rulesContents !== null) {
    fs.writeFileSync(rulesPath, rulesContents);
  }

  if (preserveArtifacts) {
    fs.writeFileSync(baselinePath, 'baseline-sentinel\n');
    fs.writeFileSync(historyPath, 'history-sentinel\n');
  }

  const fakePnpm = `#!/usr/bin/env node
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  writeSync
} = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify(args) + '\\n');

if (args[0] === 'outdated') {
  writeSync(1, JSON.stringify({
    alpha: {
      current: '1.0.0',
      latest: '1.1.0',
      wanted: '1.0.0',
      isDeprecated: false,
      dependencyType: 'dependencies'
    }
  }));
  if (process.env.FAKE_PNPM_SCENARIO === 'outdated-partial-failure') {
    writeSync(2, 'ERR_PNPM_META_FETCH_FAIL registry unavailable\\n');
  }
  process.exit(1);
}

if (args[0] === 'ls') {
  const dependencies = process.env.FAKE_PNPM_SCENARIO === 'concurrency'
    ? {
        alpha: { version: '1.0.0' },
        beta: { version: '2.0.0' },
        gamma: { version: '3.0.0' },
        delta: { version: '4.0.0' },
        epsilon: { version: '5.0.0' }
      }
    : { alpha: { version: '1.0.0' } };
  writeSync(1, JSON.stringify([{
    dependencies,
    devDependencies: process.env.FAKE_PNPM_SCENARIO === 'concurrency'
      ? {}
      : { '@scope/beta': { version: '2.0.0' } }
  }]));
  process.exit(0);
}

if (args[0] === 'view') {
  const packageName = args[1];
  if (process.env.FAKE_PNPM_SCENARIO === 'concurrency') {
    mkdirSync(process.env.FAKE_PNPM_ACTIVITY_DIR, { recursive: true });
    const marker = join(
      process.env.FAKE_PNPM_ACTIVITY_DIR,
      packageName.replace(/[^a-z0-9]/gi, '_') + '.active'
    );
    const releaseMarker = join(process.env.FAKE_PNPM_ACTIVITY_DIR, 'first-batch.release');
    const doneMarker = join(process.env.FAKE_PNPM_ACTIVITY_DIR, 'first-batch.done');
    writeFileSync(marker, '');
    const active = readdirSync(process.env.FAKE_PNPM_ACTIVITY_DIR)
      .filter((name) => name.endsWith('.active')).length;
    appendFileSync(
      process.env.FAKE_PNPM_ACTIVITY_LOG,
      JSON.stringify({
        type: 'start',
        packageName,
        active,
        firstBatchDone: existsSync(doneMarker)
      }) + '\\n'
    );

    if (packageName !== 'epsilon') {
      if (active === 4) writeFileSync(releaseMarker, '');
      const deadline = Date.now() + 4_000;
      while (!existsSync(releaseMarker)) {
        if (Date.now() >= deadline) {
          writeSync(2, 'first metadata batch never reached four active children\\n');
          process.exit(65);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }

    unlinkSync(marker);
    const activeAfterRelease = readdirSync(process.env.FAKE_PNPM_ACTIVITY_DIR)
      .filter((name) => name.endsWith('.active')).length;
    if (packageName !== 'epsilon' && activeAfterRelease === 0) writeFileSync(doneMarker, '');
  }
  const publishDate = new Date(Date.now() - 365.25 * 24 * 60 * 60 * 1000).toISOString();
  if (process.env.FAKE_PNPM_SCENARIO === 'metadata-failure' && packageName === '@scope/beta') {
    writeSync(2, 'registry unavailable\\n');
    process.exit(42);
  }
  if (process.env.FAKE_PNPM_SCENARIO === 'metadata-timeout' && packageName === '@scope/beta') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    process.exit(0);
  } else if (process.env.FAKE_PNPM_SCENARIO === 'deprecated' && packageName === '@scope/beta') {
    writeSync(1, JSON.stringify({
      deprecated: 'use gamma instead',
      time: {
        created: '2025-01-01T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z',
        '2.0.0': publishDate
      }
    }));
    process.exit(0);
  } else {
    writeSync(1, JSON.stringify({
      created: '2025-01-01T00:00:00.000Z',
      modified: '2026-01-02T00:00:00.000Z',
      '1.0.0': publishDate
    }));
    process.exit(0);
  }
}

writeSync(2, 'unexpected pnpm args: ' + JSON.stringify(args) + '\\n');
process.exit(64);
`;
  const fakePnpmPath = path.join(binDir, 'pnpm');
  fs.writeFileSync(fakePnpmPath, fakePnpm, { mode: 0o755 });

  const run = () =>
    spawnSync(process.execPath, [path.join(scriptsDir, 'dependency-freshness.mjs')], {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_PNPM_LOG: commandLog,
        FAKE_PNPM_ACTIVITY_LOG: activityLog,
        FAKE_PNPM_ACTIVITY_DIR: activityDir,
        FAKE_PNPM_SCENARIO: scenario,
        DEPENDENCY_FRESHNESS_COMMAND_TIMEOUT_MS: scenario === 'concurrency' ? '5000' : '500',
      },
      timeout: scenario === 'concurrency' ? 9_000 : 6_000,
    });

  const readCommands = (): string[][] => {
    if (!fs.existsSync(commandLog)) return [];
    return fs
      .readFileSync(commandLog, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  };

  const readActivity = (): Array<{
    type: 'start';
    packageName: string;
    active: number;
    firstBatchDone: boolean;
  }> => {
    if (!fs.existsSync(activityLog)) return [];
    return fs
      .readFileSync(activityLog, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };

  return { baselinePath, historyPath, readActivity, readCommands, run };
}

describe('dependency freshness scanner registry boundaries', () => {
  it('fails closed without overwriting artifacts when registry metadata fails', () => {
    const harness = makeHarness('metadata-failure', true);

    const result = harness.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'pnpm view @scope/beta deprecated time --json failed with exit 42'
    );
    expect(harness.readCommands()).toContainEqual([
      'view',
      '@scope/beta',
      'deprecated',
      'time',
      '--json',
    ]);
    expect(fs.readFileSync(harness.baselinePath, 'utf-8')).toBe('baseline-sentinel\n');
    expect(fs.readFileSync(harness.historyPath, 'utf-8')).toBe('history-sentinel\n');
  });

  it('bounds registry hangs and leaves artifacts untouched', () => {
    const harness = makeHarness('metadata-timeout', true);
    const startedAt = Date.now();

    const result = harness.run();

    expect(result.status).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain(
      'pnpm view @scope/beta deprecated time --json timed out after 500ms'
    );
    expect(harness.readCommands()).toContainEqual([
      'view',
      '@scope/beta',
      'deprecated',
      'time',
      '--json',
    ]);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(fs.readFileSync(harness.baselinePath, 'utf-8')).toBe('baseline-sentinel\n');
    expect(fs.readFileSync(harness.historyPath, 'utf-8')).toBe('history-sentinel\n');
  });

  it('rejects partial outdated JSON when pnpm reports a registry failure', () => {
    const harness = makeHarness('outdated-partial-failure', true);

    const result = harness.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('pnpm outdated --json failed with exit 1');
    expect(harness.readCommands()).toEqual([['outdated', '--json']]);
    expect(fs.readFileSync(harness.baselinePath, 'utf-8')).toBe('baseline-sentinel\n');
    expect(fs.readFileSync(harness.historyPath, 'utf-8')).toBe('history-sentinel\n');
  });

  it('accepts valid outdated JSON on exit 1 and fetches one metadata snapshot per package', () => {
    const harness = makeHarness('success');

    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    const commands = harness.readCommands();
    expect(commands.filter(([command]) => command === 'outdated')).toHaveLength(1);
    expect(commands.filter(([command]) => command === 'ls')).toHaveLength(1);
    const viewCommands = commands.filter(([command]) => command === 'view');
    expect(viewCommands).toHaveLength(2);
    expect(viewCommands).toEqual(
      expect.arrayContaining([
        ['view', 'alpha', 'deprecated', 'time', '--json'],
        ['view', '@scope/beta', 'deprecated', 'time', '--json'],
      ])
    );

    const baseline = JSON.parse(fs.readFileSync(harness.baselinePath, 'utf-8'));
    expect(baseline).toMatchObject({
      total: 2,
      fresh: 1,
      stale: 1,
      outdated: 0,
      deprecated: 0,
    });
    expect(baseline.details).toEqual([
      expect.objectContaining({
        name: 'alpha',
        current: '1.0.0',
        latest: '1.1.0',
        status: 'stale',
      }),
      expect.objectContaining({
        name: '@scope/beta',
        current: '2.0.0',
        latest: '2.0.0',
        status: 'fresh',
      }),
    ]);
  });

  it('replaces the same-day history snapshot instead of duplicating it', () => {
    const harness = makeHarness('success');

    const firstResult = harness.run();
    const secondResult = harness.run();

    expect(firstResult.status, firstResult.stderr).toBe(0);
    expect(secondResult.status, secondResult.stderr).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(harness.baselinePath, 'utf-8'));
    const history = JSON.parse(fs.readFileSync(harness.historyPath, 'utf-8'));
    expect(history).toEqual([
      {
        date: baseline.date,
        total: baseline.total,
        fresh: baseline.fresh,
        stale: baseline.stale,
        outdated: baseline.outdated,
        deprecated: baseline.deprecated,
        possiblyUnmaintained: baseline.possiblyUnmaintained,
      },
    ]);
  });

  it('accepts pnpm keyed metadata when a package is deprecated', () => {
    const harness = makeHarness('deprecated');

    const result = harness.run();

    expect(result.status).toBe(2);
    const baseline = JSON.parse(fs.readFileSync(harness.baselinePath, 'utf-8'));
    expect(baseline.deprecated).toBe(1);
    expect(baseline.details).toContainEqual(
      expect.objectContaining({
        name: '@scope/beta',
        status: 'deprecated',
        deprecatedMessage: 'use gamma instead',
      })
    );
  });
  it('runs registry metadata four at a time while preserving report order', () => {
    const harness = makeHarness('concurrency');

    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    const activity = harness.readActivity();
    expect(activity).toHaveLength(5);
    expect(Math.max(...activity.map((event) => event.active))).toBe(4);
    expect(activity.find((event) => event.packageName === 'epsilon')).toMatchObject({
      active: 1,
      firstBatchDone: true,
    });

    const baseline = JSON.parse(fs.readFileSync(harness.baselinePath, 'utf-8'));
    expect(baseline.details.map((entry: { name: string }) => entry.name)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
    ]);
  });

  it.each([
    [
      'unknown key',
      JSON.stringify({
        warnOnOutdated: true,
        warnOnUnmaintainedYears: 2,
        maxOutdatedPercent: 30,
        blockOnDeprecate: true,
      }),
      'unknown key',
    ],
    [
      'missing required key',
      JSON.stringify({
        blockOnDeprecated: true,
        warnOnOutdated: true,
        warnOnUnmaintainedYears: 2,
      }),
      'missing required key',
    ],
    [
      'invalid boolean',
      JSON.stringify({ ...VALID_RULES, blockOnDeprecated: 'true' }),
      'blockOnDeprecated',
    ],
    [
      'second invalid boolean',
      JSON.stringify({ ...VALID_RULES, warnOnOutdated: 'true' }),
      'warnOnOutdated',
    ],
    ['array root', '[]', 'expected an object'],
    [
      'non-positive unmaintained threshold',
      JSON.stringify({ ...VALID_RULES, warnOnUnmaintainedYears: 0 }),
      'warnOnUnmaintainedYears',
    ],
    [
      'out-of-range outdated budget',
      JSON.stringify({ ...VALID_RULES, maxOutdatedPercent: 101 }),
      'maxOutdatedPercent',
    ],
    ['invalid JSON', '{', 'valid JSON'],
    ['missing rules file', null, 'is missing'],
  ])('rejects %s before pnpm or artifact writes', (_label, rulesContents, diagnostic) => {
    const harness = makeHarness('deprecated', true, rulesContents);

    const result = harness.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid dependency freshness rules');
    expect(result.stderr).toContain(diagnostic);
    expect(harness.readCommands()).toEqual([]);
    expect(fs.readFileSync(harness.baselinePath, 'utf-8')).toBe('baseline-sentinel\n');
    expect(fs.readFileSync(harness.historyPath, 'utf-8')).toBe('history-sentinel\n');
  });

  it('uses warnOnUnmaintainedYears instead of a hard-coded threshold', () => {
    const harness = makeHarness(
      'success',
      false,
      JSON.stringify({ ...VALID_RULES, warnOnUnmaintainedYears: 0.5 })
    );

    const result = harness.run();

    expect(result.status, result.stderr).toBe(0);
    const baseline = JSON.parse(fs.readFileSync(harness.baselinePath, 'utf-8'));
    expect(baseline.possiblyUnmaintained).toBe(2);
    expect(
      baseline.details.every(
        (dependency: { possiblyUnmaintained?: boolean }) => dependency.possiblyUnmaintained
      )
    ).toBe(true);
  });
});
