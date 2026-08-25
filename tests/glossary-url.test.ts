import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import glossaryData from '../src/data/glossary.json';
import { parseGlossaryUrl } from '../src/config/glossary';

const zhPage = readFileSync(new URL('../src/pages/glossary.astro', import.meta.url), 'utf8');
const enPage = readFileSync(new URL('../src/pages/en/glossary.astro', import.meta.url), 'utf8');

describe('glossary URL render contract', () => {
  it.each([
    ['zh-tw', zhPage],
    ['en', enPage],
  ])('%s page validates item and thread URLs before rendering hrefs', (_lang, page) => {
    expect(page).toContain('parseGlossaryUrl(item.url');
    expect(page).toContain('parseGlossaryUrl(item.thread.url');
    expect(page).toContain('item.url !== undefined');
    expect(page).toContain('href={item.safeUrl.href}');
    expect(page).toContain('href={item.safeThreadUrl.href}');
    expect(page).not.toContain('href={item.url}');
    expect(page).not.toContain('href={item.thread.url}');
  });
});

describe('parseGlossaryUrl', () => {
  it.each([
    ['/about', true, { href: '/about', external: false }],
    ['/glossary#agent', true, { href: '/glossary#agent', external: false }],
    [
      'https://example.com/path?q=1#section',
      true,
      { href: 'https://example.com/path?q=1#section', external: true },
    ],
    ['HTTP://example.com/path', false, { href: 'HTTP://example.com/path', external: true }],
  ])('accepts %s when allowInternal=%s', (value, allowInternal, expected) => {
    expect(parseGlossaryUrl(value, { allowInternal, field: 'Safe.url' })).toEqual(expected);
  });

  it.each([
    '',
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'mailto:reader@example.com',
    'ftp://example.com/file',
    '//evil.example/path',
    '///evil.example/path',
    '/\\evil.example/path',
    '\\\\evil.example\\path',
    'about',
    '../about',
    '#agent',
    'https:example.com',
    'https:/example.com',
    'https:///evil.example',
    'https://',
    ' https://example.com',
    'https://example.com\n.evil.example',
  ])('rejects ambiguous or executable URL %s', (value) => {
    expect(() => parseGlossaryUrl(value, { allowInternal: true, field: 'Exploit.url' })).toThrow(
      'Invalid glossary URL at Exploit.url'
    );
  });

  it('rejects an internal URL for thread.url', () => {
    expect(() =>
      parseGlossaryUrl('/posts/example', {
        allowInternal: false,
        field: 'Thread.thread.url',
      })
    ).toThrow('Invalid glossary URL at Thread.thread.url');
  });

  it('accepts every URL in the current glossary corpus', () => {
    for (const item of glossaryData) {
      if (item.url) {
        expect(
          parseGlossaryUrl(item.url, {
            allowInternal: true,
            field: `${item.term}.url`,
          })
        ).toBeDefined();
      }
      if (item.thread?.url) {
        expect(
          parseGlossaryUrl(item.thread.url, {
            allowInternal: false,
            field: `${item.term}.thread.url`,
          })
        ).toBeDefined();
      }
    }
  });
});
