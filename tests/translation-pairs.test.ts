import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findMissingPairs,
  gitDiffAddedVsBase,
  loadPostMap,
} from '../scripts/check-translation-pairs.mjs';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function postBody(ticketId: string, marker: string): string {
  const body = Array.from(
    { length: 24 },
    (_, index) => `${marker} stable migration evidence line ${index}`
  ).join('\n');
  return `---\nticketId: ${ticketId}\nstatus: published\n---\n\n${body}\n`;
}

describe('translation-pair PR scope', () => {
  it('reports a published English-only paired-series post as missing zh-tw', () => {
    const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-translation-pairs-posts-'));

    try {
      const file = 'en-gp-987654-en-only-probe.mdx';
      fs.writeFileSync(path.join(postsDir, file), postBody('GP-987654', 'english-only'));

      expect(findMissingPairs(loadPostMap(postsDir))).toEqual([
        {
          ticketId: 'GP-987654',
          file,
          missingLang: 'zh-tw',
        },
      ]);
    } finally {
      fs.rmSync(postsDir, { recursive: true, force: true });
    }
  });

  it('does not ask a taken-down post for a sidecar (openspec: post-takedown)', () => {
    const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-translation-pairs-posts-'));

    try {
      fs.writeFileSync(
        path.join(postsDir, 'mp-987656-taken-down.mdx'),
        '---\nticketId: MP-987656\nstatus: taken-down\ntakenDownAt: "2026-09-27"\n---\n'
      );

      expect(findMissingPairs(loadPostMap(postsDir))).toEqual([]);
    } finally {
      fs.rmSync(postsDir, { recursive: true, force: true });
    }
  });

  it('does not let body text retire an English-only post with no frontmatter status', () => {
    const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-translation-pairs-posts-'));

    try {
      const file = 'en-gp-987655-body-status-probe.mdx';
      fs.writeFileSync(
        path.join(postsDir, file),
        '---\nticketId: GP-987655\n---\n\nThe migration note says status: retired, but this post is published.\n'
      );

      expect(findMissingPairs(loadPostMap(postsDir))).toEqual([
        {
          ticketId: 'GP-987655',
          file,
          missingLang: 'zh-tw',
        },
      ]);
    } finally {
      fs.rmSync(postsDir, { recursive: true, force: true });
    }
  });

  // gp-signature-picks：GP 照 MP 契約，中英都要，不看 Tribunal 結果。
  it('requires an English sidecar for every GP, whatever its Tribunal result', () => {
    const postsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-gp-sidecars-'));
    const failed = `
scores:
  tribunalVersion: 9
  vibe: { persona: 6, moguNote: 6, vibe: 6, narrative: 6, score: 6 }`;
    const writePost = (name: string, ticketId: string, scores = '') => {
      fs.writeFileSync(
        path.join(postsDir, name),
        `---\nticketId: ${ticketId}\nstatus: published${scores}\n---\n\nBody\n`
      );
    };

    try {
      writePost('gp-fail.mdx', 'GP-902', failed);
      writePost('gp-unscored.mdx', 'GP-903');
      writePost('gp-paired.mdx', 'GP-904');
      writePost('en-gp-paired.mdx', 'GP-904');
      writePost('en-gp-orphan.mdx', 'GP-906');
      writePost('mp-999-example.mdx', 'MP-999');

      expect(
        findMissingPairs(loadPostMap(postsDir)).sort((a, b) => a.ticketId.localeCompare(b.ticketId))
      ).toEqual([
        { ticketId: 'GP-902', file: 'gp-fail.mdx', missingLang: 'en' },
        { ticketId: 'GP-903', file: 'gp-unscored.mdx', missingLang: 'en' },
        { ticketId: 'GP-906', file: 'en-gp-orphan.mdx', missingLang: 'zh-tw' },
        { ticketId: 'MP-999', file: 'mp-999-example.mdx', missingLang: 'en' },
      ]);
    } finally {
      fs.rmSync(postsDir, { recursive: true, force: true });
    }
  });

  it('does not classify a rename set above diff.renameLimit as added posts', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-translation-pairs-'));

    try {
      const postsDir = path.join(repo, 'src', 'content', 'posts');
      fs.mkdirSync(postsDir, { recursive: true });
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      git(repo, ['config', 'user.name', 'Test']);

      for (let index = 1; index <= 4; index += 1) {
        fs.writeFileSync(
          path.join(postsDir, `sp-${index}-migration.mdx`),
          postBody(`SP-${index}`, `post-${index}`)
        );
      }
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed legacy posts']);
      git(repo, ['branch', 'base']);

      // Force the migration above the repository's rename-detection ceiling.
      // Each file also changes slightly, so Git must perform inexact matching.
      git(repo, ['config', 'diff.renameLimit', '1']);
      for (let index = 1; index <= 4; index += 1) {
        const oldPath = `src/content/posts/sp-${index}-migration.mdx`;
        const newPath = `src/content/posts/gp-${index}-migration.mdx`;
        git(repo, ['mv', oldPath, newPath]);
        fs.writeFileSync(path.join(repo, newPath), postBody(`GP-${index}`, `post-${index}`));
      }

      const genuinelyNewPost = 'src/content/posts/gp-999-new.mdx';
      fs.writeFileSync(path.join(repo, genuinelyNewPost), postBody('GP-999', 'new-post'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'migrate taxonomy and add one post']);

      const limitedAdded = git(repo, [
        'diff',
        '-M',
        '--name-only',
        '--diff-filter=A',
        'base...HEAD',
        '--',
        'src/content/posts/*.mdx',
      ])
        .split('\n')
        .filter(Boolean);

      expect(limitedAdded).toContain('src/content/posts/gp-1-migration.mdx');
      expect(gitDiffAddedVsBase('base', repo)).toEqual([genuinelyNewPost]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
