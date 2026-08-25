import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const temporaryRepos: string[] = [];

afterEach(() => {
  for (const repo of temporaryRepos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

function isolatedGitEnv(home: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('GIT_')) {
      delete env[key];
    }
  }
  return {
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
  };
}

describe('repository hygiene', () => {
  test('ignores Vite environment variants while keeping the example trackable', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'gu-log-env-ignore-'));
    temporaryRepos.push(repo);
    const template = path.join(repo, 'empty-git-template');
    mkdirSync(template);
    const env = isolatedGitEnv(repo);

    execFileSync('git', ['init', '-q', '--template', template], { cwd: repo, env });
    copyFileSync(path.join(ROOT, '.gitignore'), path.join(repo, '.gitignore'));

    const checkIgnore = (candidate: string): number => {
      const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', candidate], {
        cwd: repo,
        env,
        encoding: 'utf8',
      });
      if (result.status !== 0 && result.status !== 1) {
        throw new Error(
          `git check-ignore failed for ${candidate}: ${result.stderr || result.error?.message}`
        );
      }
      return result.status;
    };

    for (const candidate of [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
      '.env.test',
      '.env.test.local',
      '.env.production',
      '.env.production.local',
    ]) {
      expect(checkIgnore(candidate), candidate).toBe(0);
    }
    expect(checkIgnore('.env.example'), '.env.example').toBe(1);
  });
});
