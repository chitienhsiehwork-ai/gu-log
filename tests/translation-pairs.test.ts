import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitDiffAddedVsBase } from '../scripts/check-translation-pairs.mjs';

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
