import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE_SCRIPT = new URL('../scripts/tribunal-librarian-packet.py', import.meta.url);
const SOURCE_CHECKER = new URL('../scripts/check-glossary-links.mjs', import.meta.url);
const SOURCE_ANCHOR_RULE = new URL('../src/lib/glossary-anchor.mjs', import.meta.url);
const NODE_MODULES = fileURLToPath(new URL('../node_modules', import.meta.url));
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

  it('lists possibly unlinked glossary terms from the checker instead of deriving anchors', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tribunal-librarian-packet-'));
    temporaryRoots.push(root);
    const scriptsDirectory = path.join(root, 'scripts');
    const postsDirectory = path.join(root, 'src', 'content', 'posts');
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(postsDirectory, { recursive: true });
    mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
    mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
    copyFileSync(SOURCE_SCRIPT, path.join(scriptsDirectory, 'tribunal-librarian-packet.py'));
    copyFileSync(SOURCE_CHECKER, path.join(scriptsDirectory, 'check-glossary-links.mjs'));
    copyFileSync(SOURCE_ANCHOR_RULE, path.join(root, 'src', 'lib', 'glossary-anchor.mjs'));
    symlinkSync(NODE_MODULES, path.join(root, 'node_modules'));
    writeFileSync(
      path.join(root, 'src', 'data', 'glossary.json'),
      JSON.stringify([
        {
          term: 'Software 3.0',
          en: 'Software 3.0',
          definition: '用自然語言寫程式。',
          category: 'concepts',
        },
      ])
    );
    const packetFor = (name: string, body: string) => {
      writeFileSync(
        path.join(postsDirectory, name),
        `---\nticketId: MP-999\ntitle: Target post\nlang: zh-tw\n---\n\n${body}\n`
      );
      const result = spawnSync(
        'python3',
        [path.join(scriptsDirectory, 'tribunal-librarian-packet.py'), name],
        { encoding: 'utf8' }
      );
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };

    expect(packetFor('unlinked.mdx', 'Software 3.0 改變了寫程式的方式。')).toContain(
      '- possibly unlinked glossary terms: Software 3.0\n'
    );
    // The old page id is not the anchor the checker expects, so the term is still unlinked.
    expect(
      packetFor(
        'page-id.mdx',
        '[Software 3.0](/glossary#software-3.0) 改變了寫程式的方式。Software 3.0 之後換人寫。'
      )
    ).toContain('- possibly unlinked glossary terms: Software 3.0\n');
    expect(
      packetFor(
        'linked.mdx',
        '[Software 3.0](/glossary#software-30) 改變了寫程式的方式。Software 3.0 之後換人寫。'
      )
    ).toContain('- possibly unlinked glossary terms: none\n');
  });
});
