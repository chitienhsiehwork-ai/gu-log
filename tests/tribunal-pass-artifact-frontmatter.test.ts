import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSERT_PASS_ARTIFACTS = path.join(REPO_ROOT, 'scripts', 'tribunal-assert-pass-artifacts.sh');
const tempRepos: string[] = [];

function createStagedPost(content: string): { repo: string; postFile: string } {
  const repo = mkdtempSync(path.join(tmpdir(), 'tribunal-pass-frontmatter-'));
  const postFile = 'mp-999-frontmatter-boundary.mdx';
  const postsDir = path.join(repo, 'src', 'content', 'posts');

  tempRepos.push(repo);
  mkdirSync(postsDir, { recursive: true });
  expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0);
  writeFileSync(path.join(postsDir, postFile), content);
  expect(
    spawnSync('git', ['add', path.join('src', 'content', 'posts', postFile)], { cwd: repo }).status
  ).toBe(0);

  return { repo, postFile };
}

function runGuard(repo: string, postFile: string) {
  return spawnSync('bash', [ASSERT_PASS_ARTIFACTS, repo, postFile, '--staged'], {
    encoding: 'utf8',
  });
}

const SCORE_BLOCK = `scores:
  tribunalVersion: 999
  librarian:
  factCheck:
  freshEyes:
  vibe:`;

afterEach(() => {
  while (tempRepos.length > 0) {
    rmSync(tempRepos.pop()!, { recursive: true, force: true });
  }
});

describe('Tribunal PASS artifact frontmatter boundary', () => {
  it('rejects score-shaped prose outside the first frontmatter block', () => {
    const { repo, postFile } = createStagedPost(`---
ticketId: MP-999
title: Frontmatter boundary
lang: zh-tw
translatedDate: 2026-07-30
---

\`\`\`yaml
${SCORE_BLOCK}
\`\`\`
`);

    const result = runGuard(repo, postFile);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('target post artifact lacks scores');
  });

  it('accepts the required score fields inside the first frontmatter block', () => {
    const { repo, postFile } = createStagedPost(`---
ticketId: MP-999
title: Frontmatter boundary
lang: zh-tw
translatedDate: 2026-07-30
${SCORE_BLOCK}
---

Body.
`);

    const result = runGuard(repo, postFile);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
