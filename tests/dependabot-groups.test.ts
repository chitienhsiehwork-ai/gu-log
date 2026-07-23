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
});
