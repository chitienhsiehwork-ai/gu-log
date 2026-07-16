import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../scripts/list-content-gate-posts.mjs');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function post(ticketId: string, marker: string, extra = ''): string {
  const body = Array.from(
    { length: 24 },
    (_, index) => `${marker} stable migration evidence line ${index}`
  ).join('\n');
  return `---\nticketId: "${ticketId}"\n---\n\n${body}\n${extra}`;
}

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-content-gate-'));
  fs.mkdirSync(path.join(repo, 'src', 'content', 'posts'), { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  return repo;
}

function runGate(repo: string, baseRef = 'base'): string[] {
  const output = execFileSync('node', [SCRIPT, `--base=${baseRef}`], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  return output ? output.split('\n') : [];
}

describe('list-content-gate-posts taxonomy migration scope', () => {
  it('exempts path-changing taxonomy-only renames above the configured rename limit', () => {
    const repo = makeRepo();

    try {
      const postsDir = path.join(repo, 'src', 'content', 'posts');
      for (let index = 1; index <= 4; index += 1) {
        fs.writeFileSync(
          path.join(postsDir, `sp-${index}-migration.mdx`),
          post(`SP-${index}`, `post-${index}`)
        );
      }
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed legacy posts']);
      git(repo, ['branch', 'base']);

      // The script must override a repository ceiling lower than the migration set.
      git(repo, ['config', 'diff.renameLimit', '1']);
      for (let index = 1; index <= 4; index += 1) {
        const oldFile = `src/content/posts/sp-${index}-migration.mdx`;
        const newFile = `src/content/posts/gp-${index}-migration.mdx`;
        git(repo, ['mv', oldFile, newFile]);
        fs.writeFileSync(path.join(repo, newFile), post(`GP-${index}`, `post-${index}`));
      }
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'canonicalize taxonomy']);

      expect(runGate(repo)).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('still gates a path-changing rename that also edits reader prose', () => {
    const repo = makeRepo();

    try {
      const oldFile = 'src/content/posts/sp-1-migration.mdx';
      const newFile = 'src/content/posts/gp-1-migration.mdx';
      fs.writeFileSync(path.join(repo, oldFile), post('SP-1', 'post-1'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'seed legacy post']);
      git(repo, ['branch', 'base']);

      git(repo, ['mv', oldFile, newFile]);
      fs.writeFileSync(path.join(repo, newFile), post('GP-1', 'post-1', 'new reader prose\n'));
      git(repo, ['add', '.']);
      git(repo, ['commit', '-qm', 'rename and edit prose']);

      expect(runGate(repo)).toEqual([newFile]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
