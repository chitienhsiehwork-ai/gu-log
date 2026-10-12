/**
 * 「只改連結」的證明（openspec: glossary-link-coverage〈只改 glossary 連結的修改 SHALL
 * 可機械證明並略過內容品質 gate〉）。
 *
 * 先驗證、再剝掉：glossary 連結換回連結文字，站內文章連結換成同一個佔位符，剝完的
 * 兩個版本要逐字相同（含 frontmatter，不 trim、不排序）。新增或改動的連結要先通過
 * 驗證，驗證不過就不算只改連結，文章照常接受內容品質 gate。新連結的位置照 checker 的
 * 放置規則（findSafeOccurrences），修正器寫連結也用同一條。
 *
 * pre-commit（scripts/check-staged-internal-post-links.mjs）與 PR content gate
 * （scripts/list-content-gate-posts.mjs）共用這一份，只差資料來源：前者讀 staged，
 * 後者讀 head。
 */
import path from 'node:path';
import matter from 'gray-matter';
import {
  buildUnsafeMask,
  findSafeOccurrences,
  isEnglishPost,
  parseFrontmatter,
  rangeIsSafe,
  resolveGlossaryLinkTarget,
} from '../check-glossary-links.mjs';

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
const GLOSSARY_LINK = /^\/(?:en\/)?glossary#/u;
const INTERNAL_POST_PREFIX = /^\/(?:en\/)?posts(?:\/|$)/u;
const CANONICAL_POST_LINK = /^\/(en\/)?posts\/([a-z0-9][a-z0-9-]*)\/$/u;
const CANONICAL_TICKET_ID = /^(GP|MP)-([1-9]\d*)$/u;
// Private-use code points never appear in prose, so the placeholder cannot collide with text.
const POST_LINK_PLACEHOLDER = '\uE000INTERNAL_POST_LINK\uE001';

/**
 * Replace glossary links with their text and internal post links with a placeholder.
 * Positions are recorded in the stripped text, keyed by `start:end`.
 */
function stripLinks(content) {
  const glossaryLinks = new Map();
  const postLinks = new Map();
  let text = '';
  let last = 0;
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    const [raw, label, href] = match;
    if (content[match.index - 1] === '!') continue;
    const isGlossary = GLOSSARY_LINK.test(href);
    if (!isGlossary && !INTERNAL_POST_PREFIX.test(href)) continue;
    text += content.slice(last, match.index);
    const start = text.length;
    text += isGlossary ? label : POST_LINK_PLACEHOLDER;
    const link = { start, end: text.length, label, href, raw };
    (isGlossary ? glossaryLinks : postLinks).set(`${start}:${link.end}`, link);
    last = match.index + raw.length;
  }
  return { text: text + content.slice(last), glossaryLinks, postLinks };
}

function isLinkableOccurrence(text, entry, link, mask) {
  return entry.matches.some((matchText) =>
    findSafeOccurrences(text, entry, matchText, { mask }).some(
      (occurrence) => occurrence.start === link.start && occurrence.end === link.end
    )
  );
}

function rejectPostLinks() {
  throw new Error('internal post links cannot be validated here');
}

/**
 * Whether `after` differs from `before` only by adding, removing or correcting glossary
 * links, or by retargeting internal post links to validated canonical posts.
 *
 * @param {string} before
 * @param {string} after
 * @param {{
 *   filePath: string,
 *   glossary: object[],
 *   validatePostLink?: (label: string, href: string) => void,
 * }} options `glossary` must be the same revision as `after`; `validatePostLink` throws
 *   when a changed internal post link does not resolve to its canonical target.
 */
export function isLinkOnlyChange(
  before,
  after,
  { filePath, glossary, validatePostLink = rejectPostLinks }
) {
  const previous = stripLinks(before);
  const current = stripLinks(after);
  if (current.text !== previous.text) return false;

  const english = isEnglishPost(filePath, parseFrontmatter(after).data);
  const mask = buildUnsafeMask(current.text);

  for (const [key, link] of current.glossaryLinks) {
    const old = previous.glossaryLinks.get(key);
    if (old?.href === link.href) continue;
    if (!rangeIsSafe(mask, link.start, link.end)) return false;
    const { entry } = resolveGlossaryLinkTarget(link.href, { english, glossary });
    if (!entry) return false;
    // A new wrapper must cover text the checker itself links to this entry, at a spot the
    // placement rule allows; a link whose target is corrected keeps the text it already had.
    if (!old && !isLinkableOccurrence(current.text, entry, link, mask)) return false;
  }

  // Unwrapping is only link maintenance where a real link could live, not inside code.
  for (const [key, link] of previous.glossaryLinks) {
    if (!current.glossaryLinks.has(key) && !rangeIsSafe(mask, link.start, link.end)) return false;
  }

  for (const [key, link] of current.postLinks) {
    if (previous.postLinks.get(key)?.raw === link.raw) continue;
    try {
      validatePostLink(link.label, link.href);
    } catch {
      return false;
    }
  }
  return true;
}

function targetForSlug(records, slug) {
  const candidates = records.filter(
    ({ file }) => path.basename(file, '.mdx').toLowerCase() === slug
  );
  if (candidates.length !== 1) {
    throw new Error(`canonical target ${slug} must resolve to exactly one post`);
  }
  const [target] = candidates;
  if (target.stage !== '0') {
    throw new Error(`canonical target ${slug} is unmerged in the staged index`);
  }
  if (path.basename(target.file, '.mdx') !== slug) {
    throw new Error(`canonical target ${slug} must use an exact lowercase filename`);
  }
  return target.file;
}

/**
 * Build the internal post link validator for one revision of the posts.
 *
 * @param {{
 *   listPosts: () => Array<{ file: string, stage: string }>,
 *   readPost: (file: string) => string,
 * }} source
 */
export function createPostLinkValidator({ listPosts, readPost }) {
  let records;
  return function validatePostLink(label, url) {
    const match = CANONICAL_POST_LINK.exec(url);
    if (!match) {
      throw new Error(`internal post URL is not canonical: ${url}`);
    }

    const expectedLang = match[1] ? 'en' : 'zh-tw';
    const slug = match[2];
    if ((expectedLang === 'en') !== slug.startsWith('en-')) {
      throw new Error(`internal post URL locale does not match its slug: ${url}`);
    }

    records ??= listPosts();
    const targetFile = targetForSlug(records, slug);
    let frontmatter;
    try {
      frontmatter = matter(readPost(targetFile)).data;
    } catch (error) {
      throw new Error(`cannot parse target frontmatter for ${targetFile}`, { cause: error });
    }

    if (!frontmatter || typeof frontmatter !== 'object') {
      throw new Error(`target frontmatter must be a mapping: ${targetFile}`);
    }
    const { ticketId, title, lang } = frontmatter;
    if (lang !== expectedLang) {
      throw new Error(`target lang does not match URL locale: ${targetFile}`);
    }
    if (typeof ticketId !== 'string' || ticketId.length === 0) {
      throw new Error(`target ticketId is missing or malformed: ${targetFile}`);
    }
    if (typeof title !== 'string' || title.length === 0) {
      throw new Error(`target title is missing or malformed: ${targetFile}`);
    }

    const ticketMatch = CANONICAL_TICKET_ID.exec(ticketId);
    if (!ticketMatch) {
      throw new Error(`target ticketId is not canonical: ${targetFile}`);
    }
    const localizedSlug = expectedLang === 'en' ? slug.slice('en-'.length) : slug;
    const expectedSlugPrefix = `${ticketMatch[1].toLowerCase()}-${ticketMatch[2]}-`;
    if (!localizedSlug.startsWith(expectedSlugPrefix)) {
      throw new Error(`target ticketId does not match its filename and slug: ${targetFile}`);
    }

    const expectedLabel = `${ticketId}: ${title}`;
    if (label !== expectedLabel) {
      throw new Error(
        `internal post label ${JSON.stringify(label)} must equal ${JSON.stringify(expectedLabel)}`
      );
    }
  };
}
