#!/usr/bin/env node

import { POST_JSON_V2_KEYS } from './lib/post-json-v2-contract.mjs';

const SMOKE_EXPECTATIONS = Object.freeze({
  'zh-tw': {
    title: '為什麼 90% 的技術文章你看不完？因為寫的人根本不在乎你',
    source: 'example.com',
    sourceUrl: 'https://example.com/original-article',
    markdownSentinels: [
      '2017 年，Google 發了一篇論文叫 “Attention is All You Need”。',
      '## 認知負荷：你的腦袋不是 GPU',
      '[Andrej Karpathy](https://gu-log.vercel.app/glossary#andrej-karpathy)',
    ],
    rawBodySentinels: ['<MoguNote>', '<Toggle title="為什麼比喻這麼有效？認知科學的解釋">'],
  },
  en: {
    title: "Why You Can't Finish 90% of Tech Articles (It's Not You, It's Them)",
    source: 'example.com',
    sourceUrl: 'https://example.com/original-article',
    markdownSentinels: [
      'In 2017, Google dropped a paper called “Attention is All You Need.”',
      '## Cognitive Load: Your Brain Is Not a GPU',
      '[Andrej Karpathy](https://gu-log.vercel.app/en/glossary#andrej-karpathy)',
    ],
    rawBodySentinels: [
      '<MoguNote>',
      '<Toggle title="Why analogies work so well — the cognitive science explanation">',
    ],
  },
});

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    siteOrigin: 'https://gu-log.vercel.app',
    zhSlug: 'gp-1-20260128-demo',
    enSlug: 'en-gp-1-20260128-demo',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--base-url') args.baseUrl = value;
    if (argv[index] === '--site-origin') args.siteOrigin = value;
    if (argv[index] === '--zh-slug') args.zhSlug = value;
    if (argv[index] === '--en-slug') args.enSlug = value;
  }
  if (!args.baseUrl) {
    throw new Error(
      'usage: node scripts/verify-post-markdown-deployment.mjs --base-url <deployment-url>'
    );
  }
  args.baseUrl = new URL(args.baseUrl).href.replace(/\/$/, '');
  args.siteOrigin = new URL(args.siteOrigin).origin;
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function contentType(response) {
  return response.headers.get('content-type') ?? '';
}

function linkAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/\b([A-Za-z:-]+)(?:=(["'])(.*?)\2)?/g)].map((match) => [
      match[1].toLowerCase(),
      match[3] ?? '',
    ])
  );
}

export function markdownAlternateUrls(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => linkAttributes(match[0]))
    .filter(
      (attributes) =>
        attributes.rel?.split(/\s+/).includes('alternate') && attributes.type === 'text/markdown'
    )
    .map((attributes) => attributes.href);
}

export function parseMarkdownFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('Markdown frontmatter is missing');
  const data = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error(`Markdown frontmatter has an invalid line: ${line}`);
    const key = line.slice(0, separator);
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue === 'null') data[key] = null;
    else if (/^\d+$/.test(rawValue)) data[key] = Number(rawValue);
    else data[key] = rawValue.replace(/^(['"])(.*)\1$/, '$2');
  }
  return data;
}

async function fetchChecked(url, options, expectedType) {
  const response = await fetch(url, { redirect: 'follow', ...options });
  assert(response.ok, `${url}: expected success, got ${response.status}`);
  assert(
    expectedType.test(contentType(response)),
    `${url}: unexpected Content-Type ${JSON.stringify(contentType(response))}`
  );
  return response;
}

async function verifyPost({ baseUrl, siteOrigin, slug, lang }) {
  const expected = SMOKE_EXPECTATIONS[lang];
  const canonicalPath = lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`;
  const requestUrl = `${baseUrl}${canonicalPath}`;
  const canonicalUrl = `${siteOrigin}${canonicalPath}`;
  const markdownUrl = `${baseUrl}${canonicalPath}.md`;
  const alternateUrl = `${canonicalUrl}.md`;
  const jsonUrl = `${baseUrl}/api/posts/${slug}.json`;

  const htmlResponse = await fetchChecked(requestUrl, {}, /^text\/html\b/i);
  const html = await htmlResponse.text();
  assert(
    JSON.stringify(markdownAlternateUrls(html)) === JSON.stringify([alternateUrl]),
    `${requestUrl}: expected exactly one matching Markdown alternate`
  );

  const markdownResponse = await fetchChecked(
    markdownUrl,
    {},
    /^text\/markdown\s*;\s*charset=utf-8\b/i
  );
  const markdown = await markdownResponse.text();
  const metadata = parseMarkdownFrontmatter(markdown);
  assert(metadata.schemaVersion === 1, `${markdownUrl}: schemaVersion must be 1`);
  assert(metadata.slug === slug, `${markdownUrl}: slug mismatch`);
  assert(metadata.lang === lang, `${markdownUrl}: lang mismatch`);
  assert(metadata.canonicalUrl === canonicalUrl, `${markdownUrl}: canonicalUrl mismatch`);
  assert(metadata.title === expected.title, `${markdownUrl}: title fidelity mismatch`);
  assert(metadata.source === expected.source, `${markdownUrl}: source fidelity mismatch`);
  assert(metadata.sourceUrl === expected.sourceUrl, `${markdownUrl}: sourceUrl fidelity mismatch`);
  assert((markdown.match(/^# /gm) ?? []).length === 1, `${markdownUrl}: expected one H1`);
  for (const sentinel of expected.markdownSentinels) {
    assert(markdown.includes(sentinel), `${markdownUrl}: missing body sentinel ${sentinel}`);
  }
  assert(!/[\u2060\u00a0]/u.test(markdown), `${markdownUrl}: rendered Unicode controls leaked`);
  assert(!/^\s*import\s/m.test(markdown), `${markdownUrl}: MDX import leaked`);
  assert(!/<script\b/i.test(markdown), `${markdownUrl}: script leaked`);

  const jsonResponse = await fetchChecked(jsonUrl, {}, /^application\/json\b/i);
  const json = await jsonResponse.json();
  assert(
    JSON.stringify(Object.keys(json).sort()) === JSON.stringify(POST_JSON_V2_KEYS),
    `${jsonUrl}: JSON v2 top-level keys changed`
  );
  assert(json.schemaVersion === 2 && json.slug === slug, `${jsonUrl}: JSON v2 identity mismatch`);
  assert(
    json.title === expected.title &&
      json.source === expected.source &&
      json.sourceUrl === expected.sourceUrl,
    `${jsonUrl}: JSON v2 metadata fidelity mismatch`
  );
  for (const sentinel of expected.rawBodySentinels) {
    assert(json.body?.includes(sentinel), `${jsonUrl}: missing raw body sentinel ${sentinel}`);
  }

  const phaseOneAcceptResponse = await fetchChecked(
    requestUrl,
    { headers: { Accept: 'text/markdown' } },
    /^text\/html\b/i
  );
  assert(
    (await phaseOneAcceptResponse.text()).includes('<article'),
    `${requestUrl}: phase-one Accept request must preserve canonical HTML`
  );

  return { requestUrl, canonicalUrl, markdownUrl, jsonUrl };
}

async function verifyDeployment(args) {
  const results = [];
  results.push(
    await verifyPost({
      baseUrl: args.baseUrl,
      siteOrigin: args.siteOrigin,
      slug: args.zhSlug,
      lang: 'zh-tw',
    })
  );
  results.push(
    await verifyPost({
      baseUrl: args.baseUrl,
      siteOrigin: args.siteOrigin,
      slug: args.enSlug,
      lang: 'en',
    })
  );
  console.log(`Post Markdown deployment smoke passed: ${JSON.stringify(results)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyDeployment(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`Post Markdown deployment smoke failed: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
