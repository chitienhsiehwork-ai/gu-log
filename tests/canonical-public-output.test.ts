import { describe, expect, it } from 'vitest';
import { validateArtifactContracts } from '../scripts/verify-canonical-public-output.mjs';

const zhTwItem = {
  slug: 'gp-1-example',
  ticketId: 'GP-1',
  title: '範例文章',
  lang: 'zh-tw',
};
const enItem = {
  slug: 'en-gp-1-example',
  ticketId: 'GP-1',
  title: 'Example article',
  lang: 'en',
};

function validArtifacts() {
  return {
    sitemaps: [
      {
        name: 'sitemap-index.xml',
        content:
          '<sitemapindex><sitemap><loc>https://gu-log.vercel.app/sitemap-0.xml</loc></sitemap></sitemapindex>',
      },
      { name: 'sitemap-0.xml', content: '<urlset></urlset>' },
    ],
    rss: {
      name: 'rss.xml',
      content: [
        '<rss version="2.0"><channel>',
        '<title>gu-log</title><link>https://gu-log.vercel.app/</link><description>Feed</description>',
        '<item><title>Post</title><link>https://gu-log.vercel.app/posts/example</link>',
        '<pubDate>Wed, 22 Jul 2026 00:00:00 GMT</pubDate></item>',
        '</channel></rss>',
      ].join(''),
    },
    searchIndexes: [
      { name: 'search-index.json', content: JSON.stringify([zhTwItem, enItem]) },
      { name: 'search-index.zh-tw.json', content: JSON.stringify([zhTwItem]) },
      { name: 'search-index.en.json', content: JSON.stringify([enItem]) },
    ],
  };
}

describe('generated public artifact contracts', () => {
  it('accepts valid RSS, sitemap, and search indexes', () => {
    expect(validateArtifactContracts(validArtifacts())).toEqual([]);
  });

  it('fails closed when the sitemap index is absent', () => {
    const artifacts = validArtifacts();
    artifacts.sitemaps = artifacts.sitemaps.filter(({ name }) => name !== 'sitemap-index.xml');

    expect(validateArtifactContracts(artifacts)).toContain('missing sitemap-index.xml');
  });

  it('rejects an RSS feed without a complete item contract', () => {
    const artifacts = validArtifacts();
    artifacts.rss.content = '<rss version="2.0"><channel><title>gu-log</title></channel></rss>';

    expect(validateArtifactContracts(artifacts)).toEqual(
      expect.arrayContaining([
        'rss.xml channel must contain a non-empty <link>',
        'rss.xml channel must contain a non-empty <description>',
        'rss.xml must contain at least one <item>',
      ])
    );
  });

  it('does not let item fields satisfy missing channel fields', () => {
    const artifacts = validArtifacts();
    artifacts.rss.content = [
      '<rss version="2.0"><channel>',
      '<link>https://gu-log.vercel.app/</link><description>Feed</description>',
      '<item><title>Only an item title</title>',
      '<link>https://gu-log.vercel.app/posts/example</link>',
      '<pubDate>Wed, 22 Jul 2026 00:00:00 GMT</pubDate></item>',
      '</channel></rss>',
    ].join('');

    expect(validateArtifactContracts(artifacts)).toContain(
      'rss.xml channel must contain a non-empty <title>'
    );
  });

  it('rejects malformed and missing search indexes', () => {
    const artifacts = validArtifacts();
    artifacts.searchIndexes = [
      { name: 'search-index.json', content: '{not json' },
      { name: 'search-index.zh-tw.json', content: JSON.stringify([zhTwItem]) },
    ];

    expect(validateArtifactContracts(artifacts)).toEqual(
      expect.arrayContaining([
        'search-index.json must contain valid JSON',
        'missing search-index.en.json',
      ])
    );
  });

  it('rejects wrong-language entries in a localized index', () => {
    const artifacts = validArtifacts();
    artifacts.searchIndexes = artifacts.searchIndexes.map((index) =>
      index.name === 'search-index.zh-tw.json'
        ? { ...index, content: JSON.stringify([enItem]) }
        : index
    );

    expect(validateArtifactContracts(artifacts)).toContain(
      'search-index.zh-tw.json must contain only lang=zh-tw entries'
    );
  });

  it('requires both languages in the combined index', () => {
    const artifacts = validArtifacts();
    artifacts.searchIndexes = artifacts.searchIndexes.map((index) =>
      index.name === 'search-index.json' ? { ...index, content: JSON.stringify([zhTwItem]) } : index
    );

    expect(validateArtifactContracts(artifacts)).toContain(
      'search-index.json must contain at least one lang=en entry'
    );
  });

  it('rejects empty titles and missing ticketId fields', () => {
    const artifacts = validArtifacts();
    const invalidItem = { slug: 'gp-2-broken', title: ' ', lang: 'zh-tw' };
    artifacts.searchIndexes = artifacts.searchIndexes.map((index) =>
      index.name === 'search-index.zh-tw.json'
        ? { ...index, content: JSON.stringify([invalidItem]) }
        : index
    );

    expect(validateArtifactContracts(artifacts)).toEqual(
      expect.arrayContaining([
        'search-index.zh-tw.json[0].title must be a non-empty string',
        'search-index.zh-tw.json[0].ticketId must be a string or null',
      ])
    );
  });
});
