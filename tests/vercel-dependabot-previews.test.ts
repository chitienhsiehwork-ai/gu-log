import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { config } from '../vercel.mjs';

// Dependabot names branches dependabot/<package manager>/…, and the package
// manager segment is not the dependabot.yml ecosystem key.
const BRANCH_SEGMENT: Record<string, string> = {
  npm: 'npm_and_yarn',
  'github-actions': 'github_actions',
  gomod: 'go_modules',
  pip: 'pip',
};

// Only npm updates change what `astro build` ships, so only they earn a Vercel
// preview; the rest are fully covered by GitHub CI (#623, Hobby deploy quota).
const PREVIEWED_ECOSYSTEMS = new Set(['npm']);

const dependabot = parse(
  readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8')
) as { updates: { 'package-ecosystem': string }[] };
const ecosystems = [...new Set(dependabot.updates.map((update) => update['package-ecosystem']))];

describe('vercel.mjs Git deployment policy', () => {
  it('knows the branch segment of every configured Dependabot ecosystem', () => {
    expect(ecosystems.filter((ecosystem) => !Object.hasOwn(BRANCH_SEGMENT, ecosystem))).toEqual([]);
  });

  it('skips previews exactly for Dependabot ecosystems that never reach the site build', () => {
    const skipped = ecosystems
      .filter((ecosystem) => !PREVIEWED_ECOSYSTEMS.has(ecosystem))
      .map((ecosystem) => [`dependabot/${BRANCH_SEGMENT[ecosystem]}/**`, false]);

    expect(config.git?.deploymentEnabled).toEqual(Object.fromEntries(skipped));
  });

  it('leaves main, feature, and npm Dependabot branches on Vercel defaults', () => {
    const policy = config.git?.deploymentEnabled ?? {};
    for (const branch of ['main', 'feature/example', 'dependabot/npm_and_yarn/example']) {
      expect(Object.hasOwn(policy, branch), `${branch} must stay unspecified`).toBe(false);
    }
  });
});
