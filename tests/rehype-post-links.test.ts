import { describe, expect, it } from 'vitest';
import rehypePostLinks, { classifyPostLink } from '../src/plugins/rehype-post-links.mjs';

describe('classifyPostLink', () => {
  it.each([
    ['/posts/gp-1/', 'internal'],
    ['#section', 'internal'],
    ['https://gu-log.vercel.app/glossary', 'internal'],
    ['https://example.com/article', 'external'],
    ['//example.com/article', 'external'],
    ['mailto:reader@example.com', 'external'],
    ['https://gu-log.vercel.app.evil.example/article', 'external'],
  ])('classifies %s as %s', (href, expected) => {
    expect(classifyPostLink(href)).toBe(expected);
  });
});

describe('rehypePostLinks', () => {
  it('adds a non-color marker only to ordinary external links', () => {
    const external = {
      type: 'element',
      tagName: 'a',
      properties: { href: 'https://example.com' },
      children: [{ type: 'text', value: 'Example' }],
    };
    const internal = {
      type: 'element',
      tagName: 'a',
      properties: { href: '/about' },
      children: [{ type: 'text', value: 'About' }],
    };
    const component = {
      type: 'element',
      tagName: 'a',
      properties: { href: 'https://example.com', className: ['artifact-callout'] },
      children: [{ type: 'text', value: 'Artifact' }],
    };
    const tree = { type: 'root', children: [external, internal, component] };

    rehypePostLinks()(tree);

    expect(external.properties.dataLinkKind).toBe('external');
    expect(external.children.at(-1)).toMatchObject({
      tagName: 'span',
      properties: { ariaHidden: 'true', className: ['external-link-marker'] },
      children: [{ value: '\u2060↗' }],
    });
    expect(internal.properties.dataLinkKind).toBe('internal');
    expect(internal.children).toHaveLength(1);
    expect(component.properties.dataLinkKind).toBe('external');
    expect(component.children).toHaveLength(1);
  });
});
