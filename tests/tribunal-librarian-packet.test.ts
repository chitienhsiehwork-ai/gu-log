import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE_SCRIPT = new URL('../scripts/tribunal-librarian-packet.py', import.meta.url);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Tribunal Librarian evidence packet', () => {
  it('resolves internal post slugs independently from query strings and fragments', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tribunal-librarian-packet-'));
    temporaryRoots.push(root);
    const scriptsDirectory = path.join(root, 'scripts');
    const postsDirectory = path.join(root, 'src', 'content', 'posts');
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(postsDirectory, { recursive: true });
    copyFileSync(SOURCE_SCRIPT, path.join(scriptsDirectory, 'tribunal-librarian-packet.py'));

    writeFileSync(
      path.join(postsDirectory, 'real-post.mdx'),
      `---
ticketId: MP-998
title: Existing post
lang: zh-tw
---

Existing body.
`
    );
    writeFileSync(
      path.join(postsDirectory, 'en-real-post.mdx'),
      `---
ticketId: MP-998
title: Existing post
lang: en
---

Existing body.
`
    );
    writeFileSync(
      path.join(postsDirectory, 'target-post.mdx'),
      `---
ticketId: MP-999
title: Target post
lang: zh-tw
---

[plain](/posts/real-post)
[fragment](/posts/real-post#section)
[query](/posts/real-post?utm_source=repro)
[query and fragment](/en/posts/en-real-post?utm_source=repro#section)
[trailing slash](/posts/real-post/?utm_source=repro)
[wrong English locale](/en/posts/real-post?wrong=locale#section)
[wrong Chinese locale](/posts/en-real-post?wrong=locale#section)
[nested path](/en/posts/nested/en-real-post?wrong=shape#section)
[missing](/posts/missing-post?utm_source=repro#section)
`
    );

    const result = spawnSync(
      'python3',
      [path.join(scriptsDirectory, 'tribunal-librarian-packet.py'), 'target-post.mdx'],
      { encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('- internal links checked: 9');
    expect(result.stdout).toContain(
      '- broken internal links: /en/posts/real-post?wrong=locale#section, /posts/en-real-post?wrong=locale#section, /en/posts/nested/en-real-post?wrong=shape#section, /posts/missing-post?utm_source=repro#section'
    );
  });
});
