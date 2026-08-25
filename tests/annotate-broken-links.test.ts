import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_SOURCE = resolve('scripts/annotate-broken-links.mjs');
const fixtures: string[] = [];

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gu-log-annotate-links-'));
  fixtures.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'src/content/posts'), { recursive: true });
  mkdirSync(join(root, 'quality'), { recursive: true });
  copyFileSync(SCRIPT_SOURCE, join(root, 'scripts/annotate-broken-links.mjs'));
  return root;
}

function writeReport(root: string, broken: Array<{ file: string; url: string; context: string }>) {
  const input = join(root, 'broken-links.json');
  writeFileSync(input, JSON.stringify({ external: { broken } }));
  return input;
}

function runAnnotator(root: string, input: string) {
  return spawnSync(
    process.execPath,
    ['scripts/annotate-broken-links.mjs', '--apply', '--input', input],
    { cwd: root, encoding: 'utf8' }
  );
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe('annotate-broken-links target confinement', () => {
  it('rejects traversal before changing any post, escaped target, or suggestions file', () => {
    const root = setupFixture();
    const post = join(root, 'src/content/posts/gp-safe.mdx');
    const escaped = join(root, 'README.md');
    const suggestions = join(root, 'quality/broken-links-annotations.json');
    const postBefore = '[safe](https://broken.example/safe)\n';
    const escapedBefore = '[outside](https://broken.example/outside)\n';
    const suggestionsBefore = 'suggestions-sentinel\n';
    writeFileSync(post, postBefore);
    writeFileSync(escaped, escapedBefore);
    writeFileSync(suggestions, suggestionsBefore);
    const input = writeReport(root, [
      {
        file: 'gp-safe.mdx',
        url: 'https://broken.example/safe',
        context: 'safe',
      },
      {
        file: '../../../README.md',
        url: 'https://broken.example/outside',
        context: 'outside',
      },
    ]);

    const result = runAnnotator(root, input);

    expect(result.status).not.toBe(0);
    expect(readFileSync(post, 'utf8')).toBe(postBefore);
    expect(readFileSync(escaped, 'utf8')).toBe(escapedBefore);
    expect(readFileSync(suggestions, 'utf8')).toBe(suggestionsBefore);
  });

  it('rejects a basename symlink before changing its target or suggestions file', () => {
    const root = setupFixture();
    const outside = join(root, 'outside.mdx');
    const symlink = join(root, 'src/content/posts/escape.mdx');
    const suggestions = join(root, 'quality/broken-links-annotations.json');
    const outsideBefore = '[outside](https://broken.example/outside)\n';
    const suggestionsBefore = 'suggestions-sentinel\n';
    writeFileSync(outside, outsideBefore);
    symlinkSync(outside, symlink);
    writeFileSync(suggestions, suggestionsBefore);
    const input = writeReport(root, [
      {
        file: 'escape.mdx',
        url: 'https://broken.example/outside',
        context: 'outside',
      },
    ]);

    const result = runAnnotator(root, input);

    expect(result.status).not.toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe(outsideBefore);
    expect(readFileSync(suggestions, 'utf8')).toBe(suggestionsBefore);
  });

  it('rejects a malformed empty broken-link list instead of treating it as no findings', () => {
    const root = setupFixture();
    const input = join(root, 'broken-links.json');
    const suggestions = join(root, 'quality/broken-links-annotations.json');
    const suggestionsBefore = 'suggestions-sentinel\n';
    writeFileSync(input, JSON.stringify({ external: { broken: '' } }));
    writeFileSync(suggestions, suggestionsBefore);

    const result = runAnnotator(root, input);

    expect(result.status).not.toBe(0);
    expect(readFileSync(suggestions, 'utf8')).toBe(suggestionsBefore);
  });

  it('keeps the producer contract for a regular flat MDX basename', () => {
    const root = setupFixture();
    const post = join(root, 'src/content/posts/gp-safe.mdx');
    writeFileSync(post, '[safe](https://broken.example/safe)\n');
    const input = writeReport(root, [
      {
        file: 'gp-safe.mdx',
        url: 'https://broken.example/safe',
        context: 'safe',
      },
    ]);

    const result = runAnnotator(root, input);

    expect(result.status).toBe(0);
    expect(readFileSync(post, 'utf8')).toContain('[⚠️ 此連結已於');
  });
});
