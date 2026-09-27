import { describe, expect, it } from 'vitest';
import {
  isListingPage,
  onwardNavigationHtml,
  validateArtifactContracts,
  validateTakedownOutputs,
} from '../scripts/verify-canonical-public-output.mjs';

const zhTwItem = {
  slug: 'gp-1-example',
  ticketId: 'GP-1',
  title: '範例文章',
  lang: 'zh-tw',
};
const secondZhTwItem = {
  slug: 'gp-2-second-example',
  ticketId: 'GP-2',
  title: '第二篇範例文章',
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

  it('requires localized index membership to match the combined index', () => {
    const artifacts = validArtifacts();
    artifacts.searchIndexes = artifacts.searchIndexes.map((index) =>
      index.name === 'search-index.json'
        ? { ...index, content: JSON.stringify([zhTwItem, secondZhTwItem, enItem]) }
        : index
    );

    expect(validateArtifactContracts(artifacts)).toContain(
      'search-index.zh-tw.json membership must match search-index.json lang=zh-tw'
    );
  });

  it('rejects duplicate language and slug identities', () => {
    const artifacts = validArtifacts();
    artifacts.searchIndexes = artifacts.searchIndexes.map((index) =>
      index.name === 'search-index.json'
        ? {
            ...index,
            content: JSON.stringify([zhTwItem, { ...zhTwItem, title: '重複的範例文章' }, enItem]),
          }
        : index
    );

    expect(validateArtifactContracts(artifacts)).toContain(
      'search-index.json contains duplicate identity lang=zh-tw slug=gp-1-example'
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

// ════════════════════════════════════════════════════════════════════════════
// taken-down（openspec: post-takedown）：下架文章不得出現在任何機器輸出與列表，
// 自己的三種輸出只剩墓碑。
// ════════════════════════════════════════════════════════════════════════════
describe('taken-down post leak checks', () => {
  const post = {
    id: 'gp-273-20260813-human-loop',
    lang: 'zh-tw',
    path: '/posts/gp-273-20260813-human-loop',
    ticketId: 'GP-273',
  };
  const tombstoneHtml =
    '<html><head><meta name="robots" content="noindex"></head><body>' +
    '<article data-post-representation data-post-status="taken-down">' +
    '<div data-post-tombstone data-tombstone-series="GP"></div></article></body></html>';
  const tombstoneJson = JSON.stringify({ body: '', headings: [], summary: '這篇翻譯已下架。' });
  const tombstoneMarkdown =
    '---\nstatus: taken-down\n---\n\n# T\n\ngu-log 的翻譯文章之墓\n\n[去讀原文 →](https://example.com)\n';
  const clean = () => ({
    takenDownPosts: [post],
    sitemaps: [
      {
        name: 'sitemap-0.xml',
        content: '<urlset><loc>https://gu-log.vercel.app/posts/live</loc></urlset>',
      },
    ],
    rss: {
      content:
        '<rss><channel><item><link>https://gu-log.vercel.app/posts/live</link></item></channel></rss>',
    },
    searchIndexes: [
      { name: 'search-index.json', content: JSON.stringify([{ slug: 'live', lang: 'zh-tw' }]) },
    ],
    feed: {
      content: JSON.stringify({ articles: [{ slug: 'live', lang: 'zh-tw', url: '/posts/live' }] }),
    },
    postArtifacts: new Map([
      [post.path, { html: tombstoneHtml, json: tombstoneJson, markdown: tombstoneMarkdown }],
    ]),
    navigationPages: [{ name: 'dist/index.html', content: '<a href="/posts/live">live</a>' }],
  });

  it('passes when the tombstone is only reachable by its own URL', () => {
    expect(validateTakedownOutputs(clean())).toEqual([]);
  });

  it('names the post and the surface when a tombstone URL leaks', () => {
    const input = clean();
    input.sitemaps[0].content = `<urlset><loc>https://gu-log.vercel.app${post.path}/</loc></urlset>`;
    input.rss.content = `<rss><channel><item><link>https://gu-log.vercel.app${post.path}</link></item></channel></rss>`;
    input.searchIndexes[0].content = JSON.stringify([{ slug: post.id, lang: 'zh-tw' }]);
    input.feed = {
      content: JSON.stringify({ articles: [{ slug: post.id, lang: 'zh-tw', url: post.path }] }),
    };
    input.navigationPages = [
      { name: 'dist/tags/agents/index.html', content: `<a href="${post.path}">x</a>` },
      { name: 'dist/posts/other/index.html#onward', content: `<a href="${post.path}/">x</a>` },
    ];
    const errors = validateTakedownOutputs(input);
    for (const surface of [
      'sitemap-0.xml',
      'rss.xml',
      'search-index.json',
      'api/feed.json',
      'dist/tags/agents/index.html',
      'dist/posts/other/index.html#onward',
    ]) {
      expect(errors).toContain(`${surface}: lists taken-down post GP-273 ${post.path}`);
    }
  });

  it('rejects a tombstone that still carries article content or misses noindex', () => {
    const input = clean();
    input.postArtifacts.set(post.path, {
      html:
        tombstoneHtml.replace('<meta name="robots" content="noindex">', '') +
        '<div class="post-content"><p>leak</p></div>',
      json: JSON.stringify({ body: 'leak', headings: [{ depth: 2 }], summary: '舊摘要' }),
      markdown: '---\nstatus: published\n---\n# T\n\nleak\n',
    });
    const errors = validateTakedownOutputs(input);
    expect(errors).toEqual(
      expect.arrayContaining([
        `GP-273 ${post.path}: HTML lacks <meta name="robots" content="noindex">`,
        `GP-273 ${post.path}: HTML still renders the article body container`,
        `GP-273 ${post.path}: post JSON body is not empty`,
        `GP-273 ${post.path}: post JSON headings are not empty`,
        `GP-273 ${post.path}: post JSON summary is not the neutral sentence`,
        `GP-273 ${post.path}: Markdown metadata is not status: taken-down`,
        `GP-273 ${post.path}: Markdown is not the tombstone content`,
      ])
    );
  });

  it('fails closed when a tombstone artifact is missing', () => {
    const input = clean();
    input.postArtifacts = new Map();
    expect(validateTakedownOutputs(input)).toEqual(
      expect.arrayContaining([
        `GP-273 ${post.path}: tombstone HTML is missing`,
        `GP-273 ${post.path}: post JSON is missing`,
        `GP-273 ${post.path}: tombstone Markdown is missing`,
      ])
    );
  });

  it('classifies listing pages and slices onward navigation from post pages', () => {
    for (const page of [
      'index.html',
      'en/index.html',
      'gu-log-picks/index.html',
      'mogu-picks/2/index.html',
      'en/tags/agents/index.html',
      'glossary/index.html',
      'reading-tracker/index.html',
    ]) {
      expect(isListingPage(page), page).toBe(true);
    }
    expect(isListingPage('posts/gp-1-demo/index.html')).toBe(false);
    const page =
      '<p><a href="/posts/in-body">body link</a></p><section class="post-onward-zone">' +
      '<a href="/posts/next">next</a></section><footer class="post-footer"><a href="/">home</a></footer>';
    expect(onwardNavigationHtml(page)).toContain('/posts/next');
    expect(onwardNavigationHtml(page)).not.toContain('/posts/in-body');
    expect(onwardNavigationHtml(page)).not.toContain('post-footer');
    expect(onwardNavigationHtml('<p>no onward zone</p>')).toBe('');
  });
});
