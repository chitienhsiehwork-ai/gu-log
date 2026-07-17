import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '..');

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf-8' });
}

function readPrebuildCommand(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
  const prebuild: unknown = pkg.scripts?.prebuild;
  expect(typeof prebuild).toBe('string');
  return prebuild as string;
}

function prebuildScriptRefs(prebuild: string): string[] {
  const refs = prebuild.match(/scripts\/[\w./-]+\.mjs/g) ?? [];
  expect(refs.length).toBeGreaterThan(0);
  return [...new Set(refs)];
}

/**
 * Synthetic dir that mimics the repo layout enough to run the real prebuild
 * command in it: real generator scripts are copied in on demand, node_modules
 * is symlinked so `import yaml from 'yaml'` resolves.
 */
function makeSyntheticPrebuildDir(options: { copyScripts: string[] }): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-prebuild-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'content', 'posts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');

  for (const scriptRef of options.copyScripts) {
    fs.copyFileSync(path.join(REPO_ROOT, scriptRef), path.join(tmp, scriptRef));
  }

  fs.writeFileSync(
    path.join(tmp, 'src', 'content', 'posts', 'sp-999-regression.mdx'),
    '---\ntitle: test\n---\nbody\n'
  );

  return tmp;
}

// ─── .vercelignore rule evaluation (gitignore-style, last match wins) ───────
// Deliberately supports only the pattern shapes .vercelignore actually uses
// (plain paths / directory prefixes / `!` negation). If someone adds a glob,
// the guard below fails the test so the matcher gets extended consciously —
// instead of silently mis-evaluating the packaging contract.
function vercelignoreRules(): { negated: boolean; pattern: string }[] {
  const content = fs.readFileSync(path.join(REPO_ROOT, '.vercelignore'), 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!');
      const pattern = negated ? line.slice(1) : line;
      expect(pattern, `glob patterns not supported by this test matcher: ${line}`).not.toMatch(
        /[*?[\]]/
      );
      return { negated, pattern };
    });
}

function patternMatches(filePath: string, pattern: string): boolean {
  const normalized = pattern.replace(/^\//, '').replace(/\/+$/, '');
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}

function isExcludedByVercelignore(filePath: string): boolean {
  let excluded = false;
  for (const { negated, pattern } of vercelignoreRules()) {
    if (patternMatches(filePath, pattern)) excluded = !negated;
  }
  return excluded;
}

describe('prebuild fails closed on reader revision generator', () => {
  it('exits non-zero when the generator script is missing from the bundle', () => {
    // Vercel bundle without scripts/build-reader-revision-manifest.mjs —
    // exactly the historical .vercelignore hole.
    const tmp = makeSyntheticPrebuildDir({
      copyScripts: ['scripts/build-version-manifest.mjs'],
    });

    const result = spawnSync('sh', ['-c', readPrebuildCommand()], {
      cwd: tmp,
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
  });

  it('exits non-zero when the generator itself fails', () => {
    const tmp = makeSyntheticPrebuildDir({
      copyScripts: ['scripts/build-version-manifest.mjs'],
    });
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'build-reader-revision-manifest.mjs'),
      'process.exit(1);\n'
    );

    const result = spawnSync('sh', ['-c', readPrebuildCommand()], {
      cwd: tmp,
      encoding: 'utf-8',
    });

    expect(result.status).not.toBe(0);
  });
});

describe('deploy packaging includes every prebuild generator', () => {
  it('keeps every scripts/*.mjs referenced by prebuild out of .vercelignore exclusion', () => {
    const refs = prebuildScriptRefs(readPrebuildCommand());

    for (const scriptRef of refs) {
      expect(fs.existsSync(path.join(REPO_ROOT, scriptRef)), `${scriptRef} should exist`).toBe(
        true
      );
      expect(isExcludedByVercelignore(scriptRef), `${scriptRef} excluded by .vercelignore`).toBe(
        false
      );
    }
  });
});

describe('CI wiring for reader revision manifest freshness', () => {
  it('runs the --check step in a job that gates ci-passed', () => {
    const ci = parseYaml(
      fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8')
    );

    type CiStep = { run?: string; if?: string };
    type CiJob = { steps?: CiStep[]; needs?: string[] };

    let checkJobId: string | undefined;
    let checkStep: CiStep | undefined;
    for (const [jobId, job] of Object.entries<CiJob>(ci.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (
          typeof step.run === 'string' &&
          step.run.includes('build-reader-revision-manifest.mjs --check')
        ) {
          checkJobId = jobId;
          checkStep = step;
        }
      }
    }

    expect(checkJobId, 'no CI step runs build-reader-revision-manifest.mjs --check').toBeDefined();
    // Blocking: the step must not be conditionally skipped.
    expect(checkStep?.if).toBeUndefined();
    expect(ci.jobs['ci-passed'].needs).toContain(checkJobId);
  });
});

describe('reader revision manifest --check', () => {
  it('exits non-zero on a stale manifest and zero on a fresh one', () => {
    const tmp = makeSyntheticPrebuildDir({
      copyScripts: ['scripts/build-reader-revision-manifest.mjs'],
    });
    const script = ['scripts/build-reader-revision-manifest.mjs'];

    const generate = spawnSync('node', script, { cwd: tmp, encoding: 'utf-8' });
    expect(generate.status).toBe(0);

    const fresh = spawnSync('node', [...script, '--check'], { cwd: tmp, encoding: 'utf-8' });
    expect(fresh.status).toBe(0);
    expect(fresh.stdout).toContain('post-reader-revisions.json fresh');

    fs.appendFileSync(
      path.join(tmp, 'src', 'content', 'posts', 'sp-999-regression.mdx'),
      '\nreader-visible edit\n'
    );

    const stale = spawnSync('node', [...script, '--check'], { cwd: tmp, encoding: 'utf-8' });
    expect(stale.status).not.toBe(0);
    expect(stale.stderr + stale.stdout).toContain('post-reader-revisions.json is stale');
  });
});

describe('post versions manifest stays safe on shallow builds', () => {
  it('skips regeneration on a shallow clone and leaves the committed manifest untouched', () => {
    // Committed manifest holds a sentinel value a regeneration would never
    // produce — if the script rewrites it, the assertion below catches it.
    const sentinel = '{\n  "sentinel-post": 42\n}\n';

    const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-shallow-origin-'));
    fs.mkdirSync(path.join(origin, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(origin, 'src', 'content', 'posts'), { recursive: true });
    fs.mkdirSync(path.join(origin, 'src', 'data'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'build-version-manifest.mjs'),
      path.join(origin, 'scripts', 'build-version-manifest.mjs')
    );
    fs.writeFileSync(
      path.join(origin, 'src', 'content', 'posts', 'sp-999-regression.mdx'),
      '---\ntitle: test\n---\nbody\n'
    );
    fs.writeFileSync(path.join(origin, 'src', 'data', 'post-versions.json'), sentinel);
    run('git', ['init', '-q'], origin);
    run('git', ['config', 'user.email', 'test@example.com'], origin);
    run('git', ['config', 'user.name', 'Test'], origin);
    run('git', ['add', '.'], origin);
    run('git', ['commit', '-qm', 'seed'], origin);

    // Real shallow clone, same shape as Vercel / CCC checkouts.
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-shallow-clone-'));
    run('git', ['clone', '-q', '--depth', '1', `file://${origin}`, clone], origin);
    expect(run('git', ['rev-parse', '--is-shallow-repository'], clone).trim()).toBe('true');

    const result = spawnSync('node', ['scripts/build-version-manifest.mjs'], {
      cwd: clone,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Shallow clone detected');
    expect(fs.readFileSync(path.join(clone, 'src', 'data', 'post-versions.json'), 'utf-8')).toBe(
      sentinel
    );
  });
});
