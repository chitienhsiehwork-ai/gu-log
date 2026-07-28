import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNER_PATH = path.join(REPO_ROOT, 'scripts', 'dependency-freshness.mjs');

type Scenario =
  'success' | 'deprecated' | 'outdated-partial-failure' | 'metadata-failure' | 'metadata-timeout';

function makeHarness(scenario: Scenario, preserveArtifacts = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-dependency-freshness-'));
  const scriptsDir = path.join(root, 'scripts');
  const qualityDir = path.join(root, 'quality');
  const binDir = path.join(root, 'bin');
  const commandLog = path.join(root, 'pnpm-commands.jsonl');
  const baselinePath = path.join(qualityDir, 'dependency-freshness-baseline.json');
  const historyPath = path.join(qualityDir, 'dependency-freshness-history.json');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(qualityDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(SCANNER_PATH, path.join(scriptsDir, 'dependency-freshness.mjs'));

  if (preserveArtifacts) {
    fs.writeFileSync(baselinePath, 'baseline-sentinel\n');
    fs.writeFileSync(historyPath, 'history-sentinel\n');
  }

  const fakePnpm = `#!/usr/bin/env node
const { appendFileSync, writeSync } = require('node:fs');

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
  writeSync(1, JSON.stringify([{
    dependencies: { alpha: { version: '1.0.0' } },
    devDependencies: { '@scope/beta': { version: '2.0.0' } }
  }]));
  process.exit(0);
}

if (args[0] === 'view') {
  const packageName = args[1];
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
        '2.0.0': '2026-01-01T00:00:00.000Z'
      }
    }));
    process.exit(0);
  } else {
    writeSync(1, JSON.stringify({
      created: '2025-01-01T00:00:00.000Z',
      modified: '2026-01-02T00:00:00.000Z',
      '1.0.0': '2026-01-01T00:00:00.000Z'
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
        FAKE_PNPM_SCENARIO: scenario,
        DEPENDENCY_FRESHNESS_COMMAND_TIMEOUT_MS: '500',
      },
      timeout: 3_000,
    });

  const readCommands = (): string[][] =>
    fs
      .readFileSync(commandLog, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);

  return { baselinePath, historyPath, readCommands, run };
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
    expect(commands.filter(([command]) => command === 'view')).toEqual([
      ['view', 'alpha', 'deprecated', 'time', '--json'],
      ['view', '@scope/beta', 'deprecated', 'time', '--json'],
    ]);

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
});
