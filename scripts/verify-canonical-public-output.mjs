#!/usr/bin/env node

/**
 * Canonical-only build-artifact gate (OpenSpec restore-public-rebrand-redirects
 * task 2.2). Builds the legacy public source-path set independently from the
 * migration manifest and vercel.mjs's listing constants (not from
 * buildRedirectConfig's output), then checks that no legacy article/listing
 * URL leaks into `pnpm run build`'s actual output: dist/sitemap*.xml,
 * dist/rss.xml, dist/search-index*.json, and URL-bearing attributes
 * (href/src/content) in rendered HTML. It also pins the public structural
 * contract for the sitemap index, RSS feed, and all three search indexes.
 * Only URL-bearing fields/attributes are scanned for legacy paths -- prose
 * that merely mentions a retired name is not a finding. Fails closed if
 * dist/, any required artifact, or a required artifact field is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTING_SERIES, LANG_PREFIXES } from '../vercel.mjs';
import { getNeutralSummary, getTombstoneCopy } from '../src/lib/tombstone-copy.mjs';
import { listTakenDownPosts } from './lib/taken-down-posts.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MANIFEST_PATH = path.join(ROOT, 'quality/brand-taxonomy-post-migration.json');
const DIST_DIR = path.join(ROOT, 'dist');
const SITE_ORIGIN = 'https://gu-log.vercel.app';

function articlePath(lang, slug) {
  return lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`;
}

export function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/** Independent ground truth for "legacy public source path", built directly
 * from the migration manifest + the listing constants -- not from
 * buildRedirectConfig's output -- so this gate can't be fooled by a bug in
 * the redirect config it's meant to check against. */
export function buildLegacySurfaces(manifest) {
  const exactArticlePaths = new Set();
  for (const entry of manifest.entries) {
    exactArticlePaths.add(articlePath(entry.lang, entry.oldSlug));
  }
  const listingPrefixes = [];
  for (const { oldBase } of LISTING_SERIES) {
    for (const prefix of LANG_PREFIXES) {
      listingPrefixes.push(`${prefix}/${oldBase}`);
    }
  }
  return { exactArticlePaths, listingPrefixes };
}

export function isLegacyUrlPath(urlPath, legacy) {
  if (legacy.exactArticlePaths.has(urlPath)) return true;
  return legacy.listingPrefixes.some(
    (prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`)
  );
}

function toPath(urlString) {
  if (typeof urlString !== 'string' || urlString.length === 0) return null;
  try {
    const resolved = new URL(urlString, SITE_ORIGIN);
    if (resolved.origin !== SITE_ORIGIN) return null;
    const pathname = resolved.pathname;
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  } catch {
    return null;
  }
}

function findFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (predicate(entry.name)) out.push(full);
    }
  }
  return out;
}

const LOC_RE = /<loc>([^<]+)<\/loc>/g;
const LINK_RE = /<link>([^<]+)<\/link>/g;
const GUID_RE = /<guid[^>]*>([^<]+)<\/guid>/g;
const ATTR_RE = /\b(?:href|src|content)="([^"]*)"/g;
const REQUIRED_SEARCH_INDEXES = [
  'search-index.json',
  'search-index.zh-tw.json',
  'search-index.en.json',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectSearchIdentities(name, items, errors) {
  const identities = new Set();
  for (const item of items) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !['zh-tw', 'en'].includes(item.lang) ||
      !isNonEmptyString(item.slug)
    ) {
      continue;
    }

    const identity = JSON.stringify([item.lang, item.slug]);
    if (identities.has(identity)) {
      errors.push(`${name} contains duplicate identity lang=${item.lang} slug=${item.slug}`);
    }
    identities.add(identity);
  }
  return identities;
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** Validate the stable public shape of generated artifacts without needing a
 * server. Inputs stay text-based so unit tests can exercise malformed JSON as
 * well as structurally invalid data. */
export function validateArtifactContracts({ sitemaps, rss, searchIndexes }) {
  const errors = [];
  const sitemapIndex = sitemaps.find(({ name }) => name === 'sitemap-index.xml');

  if (!sitemapIndex) {
    errors.push('missing sitemap-index.xml');
  } else {
    if (!/<sitemapindex\b/i.test(sitemapIndex.content)) {
      errors.push('sitemap-index.xml must contain a <sitemapindex> root');
    }
    if (
      !/<sitemap\b/i.test(sitemapIndex.content) ||
      !/<loc>[^<]+<\/loc>/i.test(sitemapIndex.content)
    ) {
      errors.push('sitemap-index.xml must list at least one <sitemap> with a non-empty <loc>');
    }
  }

  if (!/<rss\b[^>]*\bversion=["']2\.0["'][^>]*>/i.test(rss.content)) {
    errors.push('rss.xml must contain an RSS 2.0 root');
  }
  const channel = rss.content.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i)?.[1];
  if (!channel) {
    errors.push('rss.xml must contain a <channel>');
  } else {
    const channelMetadata = channel.replace(/<item\b[^>]*>[\s\S]*?<\/item>/gi, '');
    for (const tag of ['title', 'link', 'description']) {
      if (!new RegExp(`<${tag}>[^<]+<\\/${tag}>`, 'i').test(channelMetadata)) {
        errors.push(`rss.xml channel must contain a non-empty <${tag}>`);
      }
    }

    const firstItem = channel.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i)?.[1];
    if (!firstItem) {
      errors.push('rss.xml must contain at least one <item>');
    } else {
      for (const tag of ['title', 'link', 'pubDate']) {
        if (!new RegExp(`<${tag}>[^<]+<\\/${tag}>`, 'i').test(firstItem)) {
          errors.push(`rss.xml first item must contain a non-empty <${tag}>`);
        }
      }
    }
  }

  const indexesByName = new Map(searchIndexes.map((index) => [index.name, index.content]));
  const parsedIndexes = new Map();
  for (const name of REQUIRED_SEARCH_INDEXES) {
    const content = indexesByName.get(name);
    if (content === undefined) {
      errors.push(`missing ${name}`);
      continue;
    }
    try {
      const items = JSON.parse(content);
      if (!Array.isArray(items) || items.length === 0) {
        errors.push(`${name} must be a non-empty JSON array`);
        continue;
      }
      parsedIndexes.set(name, items);
    } catch {
      errors.push(`${name} must contain valid JSON`);
    }
  }

  for (const [name, items] of parsedIndexes) {
    for (const [index, item] of items.entries()) {
      const label = `${name}[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      if (!isNonEmptyString(item.slug)) errors.push(`${label}.slug must be a non-empty string`);
      if (!isNonEmptyString(item.title)) errors.push(`${label}.title must be a non-empty string`);
      if (
        !Object.hasOwn(item, 'ticketId') ||
        (item.ticketId !== null && !isNonEmptyString(item.ticketId))
      ) {
        errors.push(`${label}.ticketId must be a string or null`);
      }
      if (!['zh-tw', 'en'].includes(item.lang)) {
        errors.push(`${label}.lang must be zh-tw or en`);
      }
    }
  }

  const identitiesByName = new Map();
  for (const [name, items] of parsedIndexes) {
    identitiesByName.set(name, collectSearchIdentities(name, items, errors));
  }

  for (const lang of ['zh-tw', 'en']) {
    const name = `search-index.${lang}.json`;
    const items = parsedIndexes.get(name);
    if (items?.some((item) => item?.lang !== lang)) {
      errors.push(`${name} must contain only lang=${lang} entries`);
    }

    const combinedItems = parsedIndexes.get('search-index.json');
    const localizedIdentities = identitiesByName.get(name);
    if (combinedItems && localizedIdentities) {
      const combinedIdentities = collectSearchIdentities(
        'search-index.json',
        combinedItems.filter((item) => item?.lang === lang),
        []
      );
      if (!setsEqual(combinedIdentities, localizedIdentities)) {
        errors.push(`${name} membership must match search-index.json lang=${lang}`);
      }
    }
  }

  const combined = parsedIndexes.get('search-index.json');
  if (combined) {
    const langs = new Set(combined.map((item) => item?.lang));
    for (const lang of ['zh-tw', 'en']) {
      if (!langs.has(lang))
        errors.push(`search-index.json must contain at least one lang=${lang} entry`);
    }
  }

  return errors;
}

// ─── Taken-down posts (openspec: post-takedown) ─────────────────────
// Ground truth comes from the MDX frontmatter (status: taken-down), not from
// the build: a tombstone URL must not appear in sitemap / RSS / search / JSON
// feed or in listing and onward navigation; its own HTML, JSON and Markdown
// must carry only tombstone content.
const LISTING_PAGE_PATTERN =
  /^(?:en\/)?(?:index\.html|(?:gu-log-picks|mogu-picks|shroomdog-originals|level-up|tags|glossary|reading-tracker)\/.*index\.html)$/;
const ONWARD_ZONE_START = 'class="post-onward-zone"';
const ONWARD_ZONE_END = '<footer class="post-footer"';

/** Listing pages (home, series, tags, glossary, reading tracker) by dist-relative path. */
export function isListingPage(distRelativePath) {
  return LISTING_PAGE_PATTERN.test(distRelativePath.split(path.sep).join('/'));
}

/** The onward navigation (series / related / prev-next) slice of a post page. */
export function onwardNavigationHtml(html) {
  const start = html.indexOf(ONWARD_ZONE_START);
  if (start === -1) return '';
  const end = html.indexOf(ONWARD_ZONE_END, start);
  return html.slice(start, end === -1 ? undefined : end);
}

/**
 * Every public output must treat taken-down posts as tombstones only.
 * @param {{
 *   takenDownPosts: Array<{ id: string, lang: string, path: string, ticketId?: string }>,
 *   sitemaps?: Array<{ name: string, content: string }>,
 *   rss?: { content: string },
 *   searchIndexes?: Array<{ name: string, content: string }>,
 *   feed?: { content: string } | null,
 *   postArtifacts?: Map<string, { html?: string | null, json?: string | null, markdown?: string | null }>,
 *   navigationPages?: Array<{ name: string, content: string }>,
 * }} input
 * @returns {string[]}
 */
export function validateTakedownOutputs({
  takenDownPosts,
  sitemaps = [],
  rss = { content: '' },
  searchIndexes = [],
  feed = null,
  postArtifacts = new Map(),
  navigationPages = [],
}) {
  const errors = [];
  const byPath = new Map(takenDownPosts.map((post) => [post.path, post]));
  const describe = (post) => `${post.ticketId || '?'} ${post.path}`;
  const flagUrl = (surface, value) => {
    const urlPath = toPath(value);
    const post = urlPath ? byPath.get(urlPath) : undefined;
    if (post) errors.push(`${surface}: lists taken-down post ${describe(post)}`);
  };
  const postPathOf = (lang, slug) => (lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`);

  for (const { name, content } of sitemaps) {
    for (const url of scanXmlLike(content, [LOC_RE])) flagUrl(name, url);
  }
  for (const url of scanXmlLike(rss.content, [LINK_RE, GUID_RE])) flagUrl('rss.xml', url);
  for (const { name, content } of searchIndexes) {
    let items;
    try {
      items = JSON.parse(content);
    } catch {
      errors.push(`${name}: invalid JSON`);
      continue;
    }
    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item?.slug === 'string') flagUrl(name, postPathOf(item.lang, item.slug));
    }
  }
  if (feed) {
    let articles = [];
    try {
      articles = JSON.parse(feed.content).articles ?? [];
    } catch {
      errors.push('api/feed.json: invalid JSON');
    }
    for (const article of articles) {
      if (typeof article?.url === 'string') flagUrl('api/feed.json', article.url);
      if (typeof article?.slug === 'string') {
        flagUrl('api/feed.json', postPathOf(article.lang, article.slug));
      }
    }
  }
  for (const { name, content } of navigationPages) {
    const seen = new Set();
    for (const url of scanHtmlAttrs(content)) {
      const urlPath = toPath(url);
      if (!urlPath || seen.has(urlPath)) continue;
      seen.add(urlPath);
      flagUrl(name, url);
    }
  }

  for (const post of takenDownPosts) {
    const label = describe(post);
    const artifacts = postArtifacts.get(post.path) ?? {};
    const { html, json, markdown } = artifacts;
    let copy = null;
    try {
      copy = getTombstoneCopy({ ticketId: post.ticketId, lang: post.lang });
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }

    if (typeof html !== 'string') {
      errors.push(`${label}: tombstone HTML is missing`);
    } else {
      if (!html.includes('data-post-status="taken-down"')) {
        errors.push(`${label}: HTML lacks the taken-down article marker`);
      }
      const tombstones = html.match(/\bdata-post-tombstone\b/g)?.length ?? 0;
      if (tombstones !== 1)
        errors.push(`${label}: HTML must render one tombstone, found ${tombstones}`);
      if (!/<meta name="robots" content="noindex"\s*\/?>/.test(html)) {
        errors.push(`${label}: HTML lacks <meta name="robots" content="noindex">`);
      }
      if (/class="[^"]*\bpost-content\b/.test(html)) {
        errors.push(`${label}: HTML still renders the article body container`);
      }
    }

    if (typeof json !== 'string') {
      errors.push(`${label}: post JSON is missing`);
    } else {
      try {
        const data = JSON.parse(json);
        if (data.body !== '') errors.push(`${label}: post JSON body is not empty`);
        if (!Array.isArray(data.headings) || data.headings.length !== 0) {
          errors.push(`${label}: post JSON headings are not empty`);
        }
        if (
          copy &&
          data.summary !== getNeutralSummary({ ticketId: post.ticketId, lang: post.lang })
        ) {
          errors.push(`${label}: post JSON summary is not the neutral sentence`);
        }
      } catch {
        errors.push(`${label}: post JSON is invalid`);
      }
    }

    if (typeof markdown !== 'string') {
      errors.push(`${label}: tombstone Markdown is missing`);
    } else {
      if (!/^status: taken-down$/m.test(markdown)) {
        errors.push(`${label}: Markdown metadata is not status: taken-down`);
      }
      if (copy && (!markdown.includes(copy.cardLabel) || !markdown.includes(copy.stoneEpitaph))) {
        errors.push(`${label}: Markdown is not the tombstone content`);
      }
    }
  }

  return errors;
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

function scanXmlLike(content, patterns) {
  const urls = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      urls.push(match[1]);
    }
  }
  return urls;
}

function scanHtmlAttrs(content) {
  const urls = [];
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function checkUrls(urls, legacy, sourceLabel, violations) {
  for (const raw of urls) {
    const urlPath = toPath(raw);
    if (urlPath && isLegacyUrlPath(urlPath, legacy)) {
      violations.push({ source: sourceLabel, url: raw, path: urlPath });
    }
  }
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `FAIL: ${path.relative(ROOT, DIST_DIR)} does not exist. Run "pnpm run build" before this gate.`
    );
    process.exitCode = 1;
    return;
  }

  const sitemapFiles = findFiles(DIST_DIR, (name) => /^sitemap.*\.xml$/.test(name));
  const rssPath = path.join(DIST_DIR, 'rss.xml');
  const searchIndexFiles = findFiles(DIST_DIR, (name) => /^search-index.*\.json$/.test(name));
  const htmlFiles = findFiles(DIST_DIR, (name) => name.endsWith('.html'));

  const missing = [];
  if (sitemapFiles.length === 0) missing.push('dist/sitemap*.xml');
  if (!fs.existsSync(rssPath)) missing.push('dist/rss.xml');
  if (searchIndexFiles.length === 0) missing.push('dist/search-index*.json');
  if (htmlFiles.length === 0) missing.push('dist/**/*.html');

  if (missing.length > 0) {
    console.error(`FAIL: missing required build artifacts: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const artifactContractErrors = validateArtifactContracts({
    sitemaps: sitemapFiles.map((file) => ({
      name: path.basename(file),
      content: fs.readFileSync(file, 'utf8'),
    })),
    rss: { name: 'rss.xml', content: fs.readFileSync(rssPath, 'utf8') },
    searchIndexes: searchIndexFiles.map((file) => ({
      name: path.basename(file),
      content: fs.readFileSync(file, 'utf8'),
    })),
  });
  if (artifactContractErrors.length > 0) {
    console.error('FAIL: generated public artifact contract violations:');
    for (const error of artifactContractErrors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  const legacy = buildLegacySurfaces(manifest);
  const violations = [];

  for (const file of sitemapFiles) {
    const content = fs.readFileSync(file, 'utf8');
    checkUrls(scanXmlLike(content, [LOC_RE]), legacy, path.relative(ROOT, file), violations);
  }

  const rssContent = fs.readFileSync(rssPath, 'utf8');
  checkUrls(
    scanXmlLike(rssContent, [LINK_RE, GUID_RE]),
    legacy,
    path.relative(ROOT, rssPath),
    violations
  );

  for (const file of searchIndexFiles) {
    const items = JSON.parse(fs.readFileSync(file, 'utf8'));
    const label = path.relative(ROOT, file);
    for (const item of items) {
      if (typeof item.slug === 'string') {
        const derivedUrl = item.lang === 'en' ? `/en/posts/${item.slug}` : `/posts/${item.slug}`;
        checkUrls([derivedUrl], legacy, `${label}#slug=${item.slug}`, violations);
      }
      if (typeof item.sourceUrl === 'string') {
        checkUrls([item.sourceUrl], legacy, `${label}#sourceUrl`, violations);
      }
    }
  }

  const navigationPages = [];
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    checkUrls(scanHtmlAttrs(content), legacy, path.relative(ROOT, file), violations);
    const distRelative = path.relative(DIST_DIR, file);
    if (isListingPage(distRelative)) {
      navigationPages.push({ name: `dist/${distRelative}`, content });
    } else {
      const onward = onwardNavigationHtml(content);
      if (onward) navigationPages.push({ name: `dist/${distRelative}#onward`, content: onward });
    }
  }

  const takenDownPosts = listTakenDownPosts();
  const takedownErrors = validateTakedownOutputs({
    takenDownPosts,
    sitemaps: sitemapFiles.map((file) => ({
      name: path.relative(ROOT, file),
      content: fs.readFileSync(file, 'utf8'),
    })),
    rss: { content: fs.readFileSync(rssPath, 'utf8') },
    searchIndexes: searchIndexFiles.map((file) => ({
      name: path.relative(ROOT, file),
      content: fs.readFileSync(file, 'utf8'),
    })),
    feed: { content: readIfExists(path.join(DIST_DIR, 'api/feed.json')) ?? '{"articles":[]}' },
    postArtifacts: new Map(
      takenDownPosts.map((post) => [
        post.path,
        {
          html: readIfExists(path.join(DIST_DIR, post.path, 'index.html')),
          json: readIfExists(path.join(DIST_DIR, 'api/posts', `${post.id}.json`)),
          markdown: readIfExists(path.join(DIST_DIR, `${post.path}.md`)),
        },
      ])
    ),
    navigationPages,
  });
  if (violations.length > 0) {
    console.error(`FAIL: ${violations.length} legacy public URL(s) found in build output:`);
    for (const violation of violations.slice(0, 50)) {
      console.error(`  ${violation.source}: ${violation.url}`);
    }
    if (violations.length > 50) {
      console.error(`  ... ${violations.length - 50} more`);
    }
    process.exitCode = 1;
  }

  if (takedownErrors.length > 0) {
    console.error(`FAIL: ${takedownErrors.length} taken-down post leak(s) in build output:`);
    for (const error of takedownErrors.slice(0, 50)) console.error(`  ${error}`);
    if (takedownErrors.length > 50) console.error(`  ... ${takedownErrors.length - 50} more`);
    process.exitCode = 1;
  }

  if (process.exitCode === 1) return;

  console.log(
    `OK: public artifact contracts + canonical URLs -- ${sitemapFiles.length} sitemap file(s), rss.xml, ${searchIndexFiles.length} search-index file(s), ${htmlFiles.length} HTML file(s) checked, 0 legacy public URLs found, ${takenDownPosts.length} taken-down post(s) verified as tombstones.`
  );
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
