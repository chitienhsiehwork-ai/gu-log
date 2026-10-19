/**
 * 站內文章連結的驗證。「只改連結」的證明（scripts/check-glossary-links.mjs 的
 * isLinkOnlyChange）遇到新增或改動的站內文章連結，就用這裡建的 validatePostLink 檢查：網址是
 * canonical 格式，語言跟 slug 和目標文章一致，目標剛好一篇、ticketId 對得上檔名，連結文字是
 * 「ticketId: 標題」。
 *
 * pre-commit（scripts/check-staged-internal-post-links.mjs）從 staged index 列文章、讀文章，
 * PR content gate（scripts/list-content-gate-posts.mjs）從 head，其餘規則相同。
 */
import path from 'node:path';
import matter from 'gray-matter';

const CANONICAL_POST_LINK = /^\/(en\/)?posts\/([a-z0-9][a-z0-9-]*)\/$/u;
const CANONICAL_TICKET_ID = /^(GP|MP)-([1-9]\d*)$/u;

function targetForSlug(files, slug) {
  const candidates = files.filter((file) => path.basename(file, '.mdx').toLowerCase() === slug);
  if (candidates.length !== 1) {
    throw new Error(`canonical target ${slug} must resolve to exactly one post`);
  }
  const [target] = candidates;
  if (path.basename(target, '.mdx') !== slug) {
    throw new Error(`canonical target ${slug} must use an exact lowercase filename`);
  }
  return target;
}

/**
 * Build the internal post link validator for one revision of the posts.
 *
 * @param {{
 *   listPosts: () => string[],
 *   readPost: (file: string) => string,
 * }} source `listPosts` returns the post paths of that revision.
 */
export function createPostLinkValidator({ listPosts, readPost }) {
  let files;
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

    files ??= listPosts();
    const targetFile = targetForSlug(files, slug);
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
