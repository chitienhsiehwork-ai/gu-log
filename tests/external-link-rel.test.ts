import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function astroFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return astroFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.astro') ? [entryPath] : [];
  });
}

describe('external link referrer policy', () => {
  it('adds noopener and noreferrer to every literal _blank Astro anchor', () => {
    const violations: string[] = [];

    for (const file of astroFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/<a\b[^>]*>/gs)) {
        const anchor = match[0];
        if (!/\btarget=(["'])_blank\1/.test(anchor)) continue;

        const rel = anchor.match(/\brel=(["'])([^"']*)\1/)?.[2]?.split(/\s+/) ?? [];
        if (rel.includes('noopener') && rel.includes('noreferrer')) continue;

        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${path.relative(ROOT, file)}:${line}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
