import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const pendingNames = {
  zh: 'gp-pending-20260729-collision.mdx',
  en: 'en-gp-pending-20260729-collision.mdx',
};
const destinationNames = {
  zh: 'gp-1-20260729-collision.mdx',
  en: 'en-gp-1-20260729-collision.mdx',
};
const pendingBytes = {
  zh: '---\nticketId: GP-PENDING\n---\n\n待配號正文。\n',
  en: '---\nticketId: GP-PENDING\n---\n\nPending body.\n',
};
const destinationBytes = 'existing destination sentinel\n';
const counterBytes = `${JSON.stringify(
  {
    GP: { next: 1 },
    MP: { next: 1 },
    SD: { next: 1 },
    Lv: { next: 1 },
  },
  null,
  2
)}\n`;

function createFixture(destinationLanguage?: keyof typeof destinationNames) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-allocator-'));
  const scriptsDir = path.join(fixtureRoot, 'scripts');
  const postsDir = path.join(fixtureRoot, 'src', 'content', 'posts');
  const allocatorPath = path.join(scriptsDir, 'allocate-ticket.mjs');
  const pendingPaths = {
    zh: path.join(postsDir, pendingNames.zh),
    en: path.join(postsDir, pendingNames.en),
  };
  const destinationPaths = {
    zh: path.join(postsDir, destinationNames.zh),
    en: path.join(postsDir, destinationNames.en),
  };
  const counterPath = path.join(scriptsDir, 'article-counter.json');

  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'allocate-ticket.mjs'), allocatorPath);
  fs.writeFileSync(pendingPaths.zh, pendingBytes.zh);
  fs.writeFileSync(pendingPaths.en, pendingBytes.en);
  if (destinationLanguage) {
    fs.writeFileSync(destinationPaths[destinationLanguage], destinationBytes);
  }
  fs.writeFileSync(counterPath, counterBytes);
  fs.writeFileSync(path.join(scriptsDir, 'validate-posts.mjs'), 'process.exit(0);\n');

  return {
    fixtureRoot,
    allocatorPath,
    pendingPaths,
    destinationPaths,
    counterPath,
  };
}

describe('manual ticket allocation', () => {
  it('fails the complete plan before mutation when the English destination exists', () => {
    const fixture = createFixture('en');

    try {
      const result = spawnSync(process.execPath, [fixture.allocatorPath, 'GP'], {
        cwd: fixture.fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Destination already exists: ${destinationNames.en}`);
      expect(fs.existsSync(fixture.destinationPaths.zh)).toBe(false);
      expect(fs.readFileSync(fixture.destinationPaths.en, 'utf8')).toBe(destinationBytes);
      expect(fs.readFileSync(fixture.pendingPaths.zh, 'utf8')).toBe(pendingBytes.zh);
      expect(fs.readFileSync(fixture.pendingPaths.en, 'utf8')).toBe(pendingBytes.en);
      expect(fs.readFileSync(fixture.counterPath, 'utf8')).toBe(counterBytes);
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  });

  it('cleans earlier reservations when a later no-clobber reservation fails', () => {
    const fixture = createFixture('en');
    const allocatorUrl = pathToFileURL(fixture.allocatorPath).href;
    const plan = [
      { which: 'zh', oldName: pendingNames.zh, newName: destinationNames.zh },
      { which: 'en', oldName: pendingNames.en, newName: destinationNames.en },
    ];
    const probe = `
      import { reserveDestinations } from ${JSON.stringify(allocatorUrl)};
      try {
        reserveDestinations(${JSON.stringify(plan)});
      } catch (error) {
        process.stderr.write(error.message);
        process.exitCode = 1;
      }
    `;

    try {
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
        cwd: fixture.fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Destination already exists: ${destinationNames.en}`);
      expect(fs.existsSync(fixture.destinationPaths.zh)).toBe(false);
      expect(fs.readFileSync(fixture.destinationPaths.en, 'utf8')).toBe(destinationBytes);
      expect(fs.readFileSync(fixture.pendingPaths.zh, 'utf8')).toBe(pendingBytes.zh);
      expect(fs.readFileSync(fixture.pendingPaths.en, 'utf8')).toBe(pendingBytes.en);
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  });

  it('moves the pending post without changing the successful allocation contract', () => {
    const fixture = createFixture();

    try {
      const result = spawnSync(process.execPath, [fixture.allocatorPath, 'GP'], {
        cwd: fixture.fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(fixture.pendingPaths.zh)).toBe(false);
      expect(fs.existsSync(fixture.pendingPaths.en)).toBe(false);
      expect(fs.readFileSync(fixture.destinationPaths.zh, 'utf8')).toBe(
        pendingBytes.zh.replace('GP-PENDING', 'GP-1')
      );
      expect(fs.readFileSync(fixture.destinationPaths.en, 'utf8')).toBe(
        pendingBytes.en.replace('GP-PENDING', 'GP-1')
      );
      expect(fs.readFileSync(fixture.counterPath, 'utf8')).toContain('"next": 2');
    } finally {
      fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  });
});
