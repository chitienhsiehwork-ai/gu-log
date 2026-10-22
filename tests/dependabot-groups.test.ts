import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = new URL('../', import.meta.url);

describe('Dependabot dependency review boundaries', () => {
  it('keeps Fuse.js out of the generic minor/patch group', async () => {
    const config = parse(await readFile(new URL('.github/dependabot.yml', REPO_ROOT), 'utf-8'));
    const npm = config.updates.find(
      (update: { 'package-ecosystem': string; directory: string }) =>
        update['package-ecosystem'] === 'npm' && update.directory === '/'
    );

    expect(npm.groups['misc-minor-patch']['exclude-patterns']).toContain('fuse.js');
  });

  it('pins this review surface to the independently verified Fuse.js release', async () => {
    const pkg = JSON.parse(await readFile(new URL('package.json', REPO_ROOT), 'utf-8'));
    expect(pkg.dependencies['fuse.js']).toBe('^7.5.0');
  });

  it('separates routine GitHub Actions updates from high-risk majors', async () => {
    const config = parse(await readFile(new URL('.github/dependabot.yml', REPO_ROOT), 'utf-8'));
    const actions = config.updates.find(
      (update: { 'package-ecosystem': string }) => update['package-ecosystem'] === 'github-actions'
    );

    expect(actions.groups['actions-minor-patch']).toEqual({
      patterns: ['*'],
      'update-types': ['minor', 'patch'],
    });
    expect(actions.groups['actions-major']).toEqual({
      patterns: ['*'],
      'update-types': ['major'],
    });
    expect(actions.groups).not.toHaveProperty('actions-all');
  });

  it('keeps major updates enabled for every configured ecosystem', async () => {
    const config = parse(await readFile(new URL('.github/dependabot.yml', REPO_ROOT), 'utf-8'));
    expect(
      config.updates.map((update: { 'package-ecosystem': string }) => update['package-ecosystem'])
    ).toEqual(['npm', 'github-actions', 'gomod', 'pip']);

    for (const update of config.updates) {
      const blocksAllMajors = (update.ignore ?? []).some(
        (rule: { 'dependency-name': string; 'update-types'?: string[] }) =>
          rule['dependency-name'] === '*' &&
          rule['update-types']?.includes('version-update:semver-major')
      );
      expect(blocksAllMajors, `${update['package-ecosystem']} must keep major updates`).toBe(false);
    }
  });

  it('scans composite actions as well as workflows', async () => {
    const config = parse(await readFile(new URL('.github/dependabot.yml', REPO_ROOT), 'utf-8'));
    const actions = config.updates.find(
      (update: { 'package-ecosystem': string }) => update['package-ecosystem'] === 'github-actions'
    );
    const compositeActions = readdirSync(new URL('.github/actions/', REPO_ROOT));

    expect(actions.directories).toEqual(['/', '/.github/actions/*']);
    expect(compositeActions.length).toBeGreaterThan(0);
    for (const name of compositeActions) {
      expect(existsSync(new URL(`.github/actions/${name}/action.yml`, REPO_ROOT)), name).toBe(true);
    }
  });

  it('points gomod and pip at directories that hold their manifests', async () => {
    const config = parse(await readFile(new URL('.github/dependabot.yml', REPO_ROOT), 'utf-8'));
    const directoryOf = (ecosystem: string) =>
      config.updates.find(
        (update: { 'package-ecosystem': string }) => update['package-ecosystem'] === ecosystem
      ).directory as string;

    expect(existsSync(new URL(`.${directoryOf('gomod')}/go.mod`, REPO_ROOT))).toBe(true);
    expect(
      readdirSync(new URL(`.${directoryOf('pip')}/`, REPO_ROOT)).some((file) =>
        /requirements.*\.txt$/.test(file)
      )
    ).toBe(true);
  });
});
