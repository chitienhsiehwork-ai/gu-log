import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONFIG_PATH = fileURLToPath(new URL('../.gitleaks.toml', import.meta.url));
const CONFIG = readFileSync(CONFIG_PATH, 'utf8');

function readTomlSection(name: string): string {
  const lines: string[] = [];
  let inSection = false;

  for (const line of CONFIG.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]\s*$/)?.[1];
    if (header) {
      inSection = header === name;
    } else if (inSection) {
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function readAllowlistedPathPatterns(): RegExp[] {
  const pathsBlock = readTomlSection('allowlist').match(/\n\s*paths\s*=\s*\[([\s\S]*?)\]/)?.[1];

  if (!pathsBlock) {
    throw new Error('Missing [allowlist].paths in .gitleaks.toml');
  }

  return [...pathsBlock.matchAll(/'''([^']+)'''/g)].map((match) => new RegExp(match[1]));
}

function isPathAllowlisted(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

describe('gitleaks path allowlist', () => {
  const patterns = readAllowlistedPathPatterns();

  it('extends the built-in secret detection rules', () => {
    expect(readTomlSection('extend')).toMatch(/^\s*useDefault\s*=\s*true\s*$/m);
  });

  it.each([
    'node_modules/example-package/index.js',
    'packages/site/node_modules/example-package/index.js',
    'dist/index.html',
    '.astro/data-store.json',
  ])('ignores generated or dependency path %s', (path) => {
    expect(isPathAllowlisted(path, patterns)).toBe(true);
  });

  it.each([
    'src/components/Auth.astro',
    'src/utils/distillation.ts',
    'docs/node_modules-security.md',
    'packages/site/dist/index.js',
    'packages/site/.astro/data-store.json',
  ])('still scans secret-bearing source path %s', (path) => {
    expect(isPathAllowlisted(path, patterns)).toBe(false);
  });
});
