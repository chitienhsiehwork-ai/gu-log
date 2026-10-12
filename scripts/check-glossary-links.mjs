#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { isScalar, isSeq, parseDocument } from 'yaml';
import { glossaryAnchor } from '../src/lib/glossary-anchor.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/data/glossary.json');

function parseArgs(argv) {
  const args = {
    files: [],
    terms: [],
    all: false,
    format: 'text',
    changedTermsBase: null,
    changedPostsBase: null,
    canonicalStagedFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--format') args.format = argv[++i];
    else if (arg === '--term') args.terms.push(argv[++i]);
    else if (arg === '--files') args.files.push(...argv[++i].split(/\s+/).filter(Boolean));
    else if (arg === '--changed-terms') args.changedTermsBase = argv[++i] ?? 'origin/main';
    else if (arg.startsWith('--changed-terms='))
      args.changedTermsBase = arg.slice('--changed-terms='.length);
    else if (arg === '--changed-posts') args.changedPostsBase = argv[++i] ?? 'origin/main';
    else if (arg.startsWith('--changed-posts='))
      args.changedPostsBase = arg.slice('--changed-posts='.length);
    else if (arg === '--check-canonical-staged-file') args.canonicalStagedFile = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/check-glossary-links.mjs [--all] [--term TERM...] [--files "a.mdx b.mdx"] [--changed-terms origin/main] [--changed-posts origin/main] [--format text|json] [--check-canonical-staged-file path]`
      );
      process.exit(0);
    } else args.files.push(arg);
  }
  return args;
}

export function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return { data: {}, bodyStart: 0, body: content };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { data: {}, bodyStart: 0, body: content };
  const raw = content.slice(4, end);
  const bodyStart = content.indexOf('\n', end + 4) + 1;
  const data = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value === '') {
      const list = [];
      let j = i + 1;
      while (j < lines.length) {
        const lm = lines[j].match(/^\s*-\s*(.+?)\s*$/);
        if (!lm) break;
        list.push(lm[1].replace(/^['"]|['"]$/g, ''));
        j += 1;
      }
      if (list.length) data[key] = list;
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, bodyStart, body: content.slice(bodyStart) };
}

export function isEnglishPost(filePath, frontmatter = {}) {
  const base = path.basename(filePath);
  return frontmatter.lang === 'en' || base.startsWith('en-');
}

export function loadGlossary(glossaryPath = GLOSSARY_PATH) {
  return JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
}

/**
 * The glossary as staged in `cwd`'s index, so pre-commit proofs validate links
 * against the same version as the staged post. Empty when the index has none.
 */
export function loadStagedGlossary(cwd = REPO_ROOT) {
  const spec = ':src/data/glossary.json';
  try {
    execFileSync('git', ['cat-file', '-e', spec], { cwd, stdio: 'ignore' });
  } catch {
    return [];
  }
  return JSON.parse(execFileSync('git', ['show', spec], { cwd, encoding: 'utf8' }));
}

export function normalizeGlossary(glossary) {
  return glossary
    .filter((entry) => entry && entry.term && entry.linking?.enabled !== false)
    .map((entry) => {
      const linking = entry.linking ?? {};
      if (
        Object.hasOwn(entry, 'forbiddenZhTw') &&
        (!Array.isArray(entry.forbiddenZhTw) ||
          entry.forbiddenZhTw.some(
            (value) => typeof value !== 'string' || value.trim().length === 0
          ))
      ) {
        throw new TypeError(`${entry.term}.forbiddenZhTw must be an array of non-empty strings`);
      }
      const matches =
        Array.isArray(linking.match) && linking.match.length ? linking.match : [entry.term];
      return {
        term: entry.term,
        anchor: glossaryAnchor(entry),
        matches: matches.filter(Boolean),
        caseSensitive: linking.caseSensitive !== false,
        forbiddenZhTw: Array.isArray(entry.forbiddenZhTw)
          ? entry.forbiddenZhTw.filter((value) => typeof value === 'string' && value.length > 0)
          : [],
      };
    })
    .filter((entry) => entry.matches.length)
    .sort(
      (a, b) =>
        Math.max(...b.matches.map((m) => m.length)) - Math.max(...a.matches.map((m) => m.length))
    );
}

function markRange(mask, start, end) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(mask.length, end);
  for (let i = safeStart; i < safeEnd; i += 1) mask[i] = true;
}

function unmarkRange(mask, start, end) {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(mask.length, end);
  for (let i = safeStart; i < safeEnd; i += 1) mask[i] = false;
}

function maskRegex(content, mask, re) {
  let match;
  while ((match = re.exec(content))) markRange(mask, match.index, match.index + match[0].length);
}

function frontmatterEnd(content) {
  if (!content.startsWith('---\n')) return 0;
  const end = content.indexOf('\n---', 4);
  if (end < 0) return 0;
  const after = content.indexOf('\n', end + 4);
  return after >= 0 ? after + 1 : content.length;
}

function isEscaped(content, index) {
  let backslashes = 0;
  while (content[index - 1 - backslashes] === '\\') backslashes += 1;
  return backslashes % 2 === 1;
}

function isBlankLineAt(content, lineStart) {
  const lineEnd = content.indexOf('\n', lineStart);
  return /^[ \t]*$/.test(content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd));
}

// A fence closes only with the same character at least as long as the opener, so a longer
// outer fence can wrap shorter ones; an unclosed fence runs to the end of the file.
// Indentation is not limited because list items indent their fences.
function fencedCodeRanges(content, from) {
  const ranges = [];
  let open = null;
  let offset = from;
  for (const line of content.slice(from).split('\n')) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      // A backtick fence's info string can't hold a backtick; such a line is inline code.
      if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
        open = { start: offset, char: fence[1][0], length: fence[1].length };
      }
    } else if (
      fence &&
      fence[1][0] === open.char &&
      fence[1].length >= open.length &&
      /^[ \t]*$/.test(fence[2])
    ) {
      ranges.push({ start: open.start, end: offset + line.length });
      open = null;
    }
    offset += line.length + 1;
  }
  if (open) ranges.push({ start: open.start, end: content.length });
  return ranges;
}

// End of the inline code span opening at `start`: the next backtick run of the same length
// in the same paragraph, or -1 when there is none and the backticks are plain text.
function codeSpanEnd(content, start, mask) {
  let i = start;
  while (content[i] === '`') i += 1;
  const length = i - start;
  while (i < content.length && !mask[i]) {
    if (content[i] === '`') {
      const run = i;
      while (content[i] === '`') i += 1;
      if (i - run === length) return i;
    } else {
      if (content[i] === '\n' && isBlankLineAt(content, i + 1)) return -1;
      i += 1;
    }
  }
  return -1;
}

// Index of the quote closing the JavaScript string that opens at `start`. A quote that never
// closes (for ' and ", not on its own line: an apostrophe in JSX text) starts no string, so
// `start` comes back and the quote reads as a plain character.
function stringEnd(content, start, multiline) {
  const quote = content[start];
  for (let i = start + 1; i < content.length; i += 1) {
    if (content[i] === quote) return i;
    if (content[i] === '\\') i += 1;
    else if (content[i] === '\n' && !multiline) break;
  }
  return start;
}

// End of the MDX expression `{…}` opening at `start`, or -1: braces balance outside
// JavaScript strings and comments.
function expressionEnd(content, start) {
  let depth = 0;
  for (let i = start; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (char === '/' && content[i + 1] === '*') {
      i = content.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i += 1;
    } else if (char === '"' || char === "'" || char === '`') {
      i = stringEnd(content, i, char === '`');
    }
  }
  return -1;
}

// End of the JSX tag opening at `start` (`<div …>`, `</div>`, `<>`), or -1: attribute
// strings and `{…}` values may hold `>` and span lines.
function tagEnd(content, start) {
  for (let i = start + 1; i < content.length; i += 1) {
    const char = content[i];
    if (char === '>') return i + 1;
    if (char === '{') {
      const end = expressionEnd(content, i);
      if (end < 0) return -1;
      i = end - 1;
    } else if (char === '"' || char === "'") {
      i = stringEnd(content, i, true);
    }
  }
  return -1;
}

/**
 * Frontmatter and code (fenced blocks and inline code spans), where link syntax is text.
 * Inline code is read in source order together with MDX expressions and JSX tags, as the
 * MDX parser does: whichever starts first wins, so a `{` inside code is text and a backtick
 * inside `{…}` or an attribute is JavaScript. Those ranges come back too, so the other
 * masks build on this one instead of scanning again.
 */
function frontmatterAndCodeMask(content) {
  const mask = new Array(content.length).fill(false);
  const bodyStart = frontmatterEnd(content);
  markRange(mask, 0, bodyStart);
  for (const fence of fencedCodeRanges(content, bodyStart)) markRange(mask, fence.start, fence.end);

  const found = { code: [], expressions: [], tags: [] };
  for (let i = bodyStart; i < content.length; i += 1) {
    if (mask[i]) continue;
    const char = content[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    let kind = null;
    let end = -1;
    if (char === '`') [kind, end] = ['code', codeSpanEnd(content, i, mask)];
    else if (char === '{') [kind, end] = ['expressions', expressionEnd(content, i)];
    else if (char === '<' && /[A-Za-z/>]/.test(content[i + 1] ?? '')) {
      [kind, end] = ['tags', tagEnd(content, i)];
    }
    if (end > i) {
      found[kind].push({ start: i, end });
      i = end - 1;
    } else {
      // A backtick run with no closing run is text as a whole.
      while (char === '`' && content[i + 1] === '`') i += 1;
    }
  }
  for (const span of found.code) markRange(mask, span.start, span.end);
  return { mask, expressions: found.expressions, tags: found.tags };
}

function closingBracket(content, open, mask) {
  let depth = 0;
  for (let i = open; i < content.length; i += 1) {
    const char = content[i];
    if (mask[i]) continue;
    if (char === '\n' && isBlankLineAt(content, i + 1)) return -1;
    if ((char !== '[' && char !== ']') || isEscaped(content, i)) continue;
    depth += char === '[' ? 1 : -1;
    if (depth === 0) return i;
  }
  return -1;
}

function closingParen(content, open) {
  let depth = 0;
  for (let i = open; i < content.length && content[i] !== '\n'; i += 1) {
    if (content[i] === '\\') i += 1;
    else if (content[i] === '(') depth += 1;
    else if (content[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Links and images, text and destination both: a link inside another link's text does not
// render. The text may wrap onto the next line, but not past a blank line.
function linkRanges(content, mask) {
  const ranges = [];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== '[' || mask[i] || isEscaped(content, i)) continue;
    const close = closingBracket(content, i, mask);
    const end = close >= 0 && content[close + 1] === '(' ? closingParen(content, close + 1) : -1;
    if (end < 0) continue;
    ranges.push({ start: content[i - 1] === '!' ? i - 1 : i, end });
    i = end - 1;
  }
  return ranges;
}

/**
 * Where a glossary link must not go: frontmatter, code, MDX expressions, JSX tags and the
 * text of other links (an `<a>` element's content included), autolinks, blockquotes,
 * import/export lines and lines that open an MDX component. findSafeOccurrences adds the
 * characters a link can't touch; together they are the one placement rule.
 */
export function buildUnsafeMask(content) {
  const { mask, expressions, tags } = frontmatterAndCodeMask(content);
  for (const range of [...expressions, ...tags]) markRange(mask, range.start, range.end);
  for (const [index, tag] of tags.entries()) {
    if (!/^<a[\s>]/.test(content.slice(tag.start, tag.end))) continue;
    const close = tags
      .slice(index + 1)
      .find((other) => /^<\/a\s*>$/.test(content.slice(other.start, other.end)));
    if (close) markRange(mask, tag.start, close.end);
  }
  for (const link of linkRanges(content, mask)) markRange(mask, link.start, link.end);
  maskRegex(content, mask, /(?:https?:\/\/|www\.)[^\s)]+/g);
  maskRegex(content, mask, /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g);

  let offset = 0;
  for (const line of content.split('\n')) {
    if (/^\s*(?:<[A-Z]|>|(?:import|export)\b)/.test(line)) {
      markRange(mask, offset, offset + line.length);
    }
    offset += line.length + 1;
  }
  return mask;
}

// Canonical terminology has a wider reader-visible surface than link coverage:
// blockquotes and component children are prose, while only the surrounding MDX
// syntax is unsafe. Keep this mask separate so the long-standing link fixer does
// not start mutating quotations or component bodies.
export function buildCanonicalUnsafeMask(content) {
  const { mask, expressions, tags } = frontmatterAndCodeMask(content);
  maskRegex(content, mask, /<!--[\s\S]*?-->/g);
  // MDX expressions are code. Only a standalone string/template literal is
  // statically guaranteed to render as reader-visible prose; strings nested
  // inside program logic (and `{/* comments */}`) remain syntax and stay masked.
  for (const expression of expressions) {
    const raw = content.slice(expression.start, expression.end);
    const visibleLiteral = raw.match(/^\{\s*(?:(['"])([\s\S]*?)\1|`([\s\S]*?)`)\s*\}$/);
    let visibleRange = null;
    if (visibleLiteral) {
      const value = visibleLiteral[2] ?? visibleLiteral[3] ?? '';
      const valueOffset = raw.indexOf(value);
      visibleRange = {
        start: expression.start + valueOffset,
        end: expression.start + valueOffset + value.length,
      };
      if (!rangeIsSafe(mask, visibleRange.start, visibleRange.end)) visibleRange = null;
    }
    markRange(mask, expression.start, expression.end);
    if (visibleRange) unmarkRange(mask, visibleRange.start, visibleRange.end);
  }
  for (const tag of tags) markRange(mask, tag.start, tag.end);
  maskRegex(content, mask, /https?:\/\/[^\s)]+/g);

  const linkRe = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  let link;
  while ((link = linkRe.exec(content))) {
    const destinationOffset = link[0].lastIndexOf('](') + 2;
    markRange(
      mask,
      link.index + destinationOffset,
      link.index + destinationOffset + link[1].length
    );
  }

  const lines = content.split(/\n/);
  let offset = 0;
  for (const line of lines) {
    if (/^\s*(import|export)\b/.test(line)) markRange(mask, offset, offset + line.length);
    offset += line.length + 1;
  }

  return mask;
}

export function frontmatterReaderVisibleRanges(content) {
  if (!content.startsWith('---\n')) return [];
  const end = content.indexOf('\n---', 4);
  if (end < 0) return [];

  const frontmatter = content.slice(4, end);
  const document = parseDocument(frontmatter);
  if (document.errors.length > 0) throw document.errors[0];

  const ranges = [];
  const addScalar = (node) => {
    if (!isScalar(node) || !node.range) return;
    ranges.push({ start: 4 + node.range[0], end: 4 + node.range[1] });
  };

  addScalar(document.get('title', true));
  addScalar(document.get('summary', true));
  const tags = document.get('tags', true);
  if (isSeq(tags)) {
    for (const item of tags.items) addScalar(item);
  } else {
    addScalar(tags);
  }

  return ranges;
}

function isBoundaryChar(ch) {
  return !ch || !/[\p{L}\p{N}_-]/u.test(ch);
}

export function rangeIsSafe(mask, start, end) {
  for (let i = start; i < end; i += 1) if (mask[i]) return false;
  return true;
}

// `*`, `_` or `~` next to the term are emphasis or strikethrough delimiters that the link
// syntax would pull apart. Before the term, `\` would escape the `[` and `!` would turn the
// link into an image.
const GLUED_BEFORE = /[*_~\\!]/u;
const GLUED_AFTER = /[*_~]/u;

/**
 * Occurrences of `matchText` a glossary link can wrap: the placement rule the checker, the
 * fixer and the link-only proof share. Outside buildUnsafeMask, on word boundaries, and not
 * touching the characters above, judged on what a reader sees next to the term
 * (visibleNeighbors). When the first occurrence can't take a link, the next one that can is
 * first in the list.
 */
export function findSafeOccurrences(content, term, matchText, options = {}) {
  const mask = options.mask ?? buildUnsafeMask(content);
  const flags = term.caseSensitive ? 'g' : 'gi';
  const re = new RegExp(matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  const out = [];
  let match;
  while ((match = re.exec(content))) {
    const start = match.index;
    const end = start + match[0].length;
    if (!rangeIsSafe(mask, start, end)) continue;
    const { before, after } = visibleNeighbors(content, start, end);
    if (!isBoundaryChar(before) || !isBoundaryChar(after)) continue;
    if (GLUED_BEFORE.test(before) || GLUED_AFTER.test(after)) continue;
    const line = content.slice(0, start).split('\n').length;
    out.push({ start, end, text: match[0], line });
  }
  return out;
}

function findOccurrencesInRanges(content, matchText, ranges) {
  const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const occurrences = [];
  let match;
  while ((match = re.exec(content))) {
    const start = match.index;
    const end = start + match[0].length;
    if (!ranges.some((range) => start >= range.start && end <= range.end)) continue;
    occurrences.push({
      start,
      end,
      text: match[0],
      line: content.slice(0, start).split('\n').length,
    });
  }
  return occurrences;
}

export function findCanonicalOccurrences(content, matchText) {
  const mask = buildCanonicalUnsafeMask(content);
  const bodyRanges = [];
  let rangeStart = null;
  for (let i = 0; i <= mask.length; i += 1) {
    if (i < mask.length && !mask[i] && rangeStart === null) rangeStart = i;
    if ((i === mask.length || mask[i]) && rangeStart !== null) {
      bodyRanges.push({ start: rangeStart, end: i });
      rangeStart = null;
    }
  }
  return [
    ...findOccurrencesInRanges(content, matchText, bodyRanges),
    ...findOccurrencesInRanges(content, matchText, frontmatterReaderVisibleRanges(content)),
  ].sort((a, b) => a.start - b.start);
}

function hasCoverage(content, term, href) {
  for (const matchText of term.matches) {
    const escapedText = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\[${escapedText}\\]\\(${escapedHref}\\)`,
      term.caseSensitive ? '' : 'i'
    );
    if (re.test(content)) return true;
  }
  return false;
}

function ignoredTerms(content, frontmatter) {
  const ignored = new Set();
  const fmIgnore = frontmatter.glossaryIgnore;
  if (Array.isArray(fmIgnore)) for (const t of fmIgnore) ignored.add(t);
  const re = /<!--\s*glossary-ignore\s+([^>]+?)\s*-->/g;
  let match;
  while ((match = re.exec(content))) {
    for (const part of match[1].split(/[,;]/)) {
      const t = part.trim();
      if (t) ignored.add(t);
    }
  }
  return ignored;
}

/** The glossary link to an anchor for a post in this language. */
export function expectedHref(anchor, english) {
  return `${english ? '/en/glossary' : '/glossary'}#${anchor}`;
}

// A Markdown link as posts write it; captures the text and the href. Neither holds a `[`:
// a bracket that opens no link (`[Kubernetes] 是…`, `arr[` in code) is not part of the next
// link, and a link left open (`[文件](官網…`) does not swallow the next one. Global: use matchAll.
export const MARKDOWN_LINK = /\[([^[\]\n]+)\]\(([^[)\n]+)\)/gu;
// A glossary href; captures the /en prefix and the anchor.
export const GLOSSARY_HREF = /^\/(en\/)?glossary#(.*)$/u;
// An internal post link's href.
export const INTERNAL_POST_PREFIX = /^\/(?:en\/)?posts(?:\/|$)/u;

// A glossary link right next to a term shows its text there, so that text, not the link's `)`
// or `[`, is what a reader sees beside the term. The link-only proof judges the post with
// glossary links taken out, images aside, and the checker has to see the same neighbors.
const LINK_ENDING_HERE = new RegExp(`(?<!!)${MARKDOWN_LINK.source}$`, 'u');
const LINK_STARTING_HERE = new RegExp(`^${MARKDOWN_LINK.source}`, 'u');

function visibleNeighbors(content, start, end) {
  let before = content[start - 1] ?? '';
  let after = content[end] ?? '';
  if (before === ')') {
    const link = LINK_ENDING_HERE.exec(
      content.slice(content.lastIndexOf('\n', start - 1) + 1, start)
    );
    if (link && GLOSSARY_HREF.test(link[2])) before = link[1].at(-1);
  }
  if (after === '[') {
    const link = LINK_STARTING_HERE.exec(content.slice(end));
    if (link && GLOSSARY_HREF.test(link[2])) after = link[1][0];
  }
  return { before, after };
}

const markdown = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);

// The mdast a reader gets, with links the proof has dealt with taken out: a glossary link
// becomes its children, an internal post link one placeholder node. Adjacent text merges,
// and positions go (with `data`, where MDX keeps its estree and that tree's offsets).
function readerChildren(children) {
  const out = [];
  for (const child of children) {
    let nodes;
    if (child.type === 'link' && GLOSSARY_HREF.test(child.url)) {
      nodes = readerChildren(child.children);
    } else if (child.type === 'link' && INTERNAL_POST_PREFIX.test(child.url)) {
      nodes = [{ type: 'internalPostLink' }];
    } else {
      nodes = [readerTree(child)];
    }
    for (const node of nodes) {
      const previous = out.at(-1);
      if (node.type === 'text' && previous?.type === 'text') {
        out[out.length - 1] = { type: 'text', value: previous.value + node.value };
      } else {
        out.push(node);
      }
    }
  }
  return out;
}

function readerTree(value) {
  if (Array.isArray(value)) return value.map(readerTree);
  if (!value || typeof value !== 'object') return value;
  const node = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'position' || key === 'data') continue;
    node[key] = key === 'children' ? readerChildren(child) : readerTree(child);
  }
  return node;
}

/**
 * Whether two versions of a post parse, with the site's parser, to the same structure once
 * glossary links become their text and internal post links one placeholder: the link-only
 * proof's last step. Only the body is parsed; a body that does not parse proves nothing.
 */
export function hasSameReaderStructure(before, after) {
  try {
    return isDeepStrictEqual(
      readerTree(markdown.parse(parseFrontmatter(before).body)),
      readerTree(markdown.parse(parseFrontmatter(after).body))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve a glossary link target for a post: the path must follow the post language
 * and the anchor must belong to an enabled entry (case-sensitive). Returns
 * `{ entry }` with the normalized entry, or `{ error }` explaining the rejection.
 */
export function resolveGlossaryLinkTarget(href, { english, glossary }) {
  const anchor = GLOSSARY_HREF.exec(href)?.[2];
  if (anchor === undefined) return { error: `${JSON.stringify(href)} is not a glossary link` };
  if (href !== expectedHref(anchor, english)) {
    return { error: `${href} must be ${expectedHref(anchor, english)} for this post` };
  }
  const target = glossary.find((entry) => entry?.term && glossaryAnchor(entry) === anchor);
  if (!target) return { error: `no glossary entry has anchor #${anchor}` };
  const [entry] = normalizeGlossary([target]);
  if (!entry) return { error: `${target.term} has automatic linking disabled` };
  return { entry };
}

/**
 * Glossary links that lead nowhere: the anchor must belong to some entry (entries with
 * automatic linking disabled still exist; case must match), and the path must follow
 * the post language.
 */
export function checkLinkTargets(content, options = {}) {
  const filePath = options.filePath ?? 'post.mdx';
  const glossary = options.glossary ?? loadGlossary();
  const anchors = new Set(glossary.filter((entry) => entry?.term).map(glossaryAnchor));
  const english = isEnglishPost(filePath, parseFrontmatter(content).data);
  const { mask } = frontmatterAndCodeMask(content);
  const violations = [];
  for (const match of content.matchAll(MARKDOWN_LINK)) {
    const glossaryLink = GLOSSARY_HREF.exec(match[2]);
    if (!glossaryLink || mask[match.index]) continue;
    const [href, , anchor] = glossaryLink;
    const line = content.slice(0, match.index).split('\n').length;
    if (!anchors.has(anchor)) {
      violations.push({ kind: 'dead-anchor', file: filePath, line, href, anchor });
    } else if (href !== expectedHref(anchor, english)) {
      violations.push({
        kind: 'wrong-language',
        file: filePath,
        line,
        href,
        anchor,
        expectedHref: expectedHref(anchor, english),
      });
    }
  }
  return { violations };
}

/** `related` names that are not glossary entries. */
export function findMissingRelated(glossary) {
  const terms = new Set(glossary.map((entry) => entry?.term));
  const violations = [];
  for (const entry of glossary) {
    for (const name of Array.isArray(entry?.related) ? entry.related : []) {
      if (!terms.has(name)) {
        violations.push({
          kind: 'missing-related',
          file: GLOSSARY_PATH,
          term: entry.term,
          missing: name,
        });
      }
    }
  }
  return violations;
}

/** `content` with the text of each link (`{ start, end, text, href }`) wrapped in it. */
export function writeGlossaryLinks(content, links) {
  let output = '';
  let last = 0;
  for (const link of [...links].sort((a, b) => a.start - b.start)) {
    output += `${content.slice(last, link.start)}[${link.text}](${link.href})`;
    last = link.end;
  }
  return output + content.slice(last);
}

/**
 * The links the checker reports missing and the fixer writes: for each term the post
 * neither links nor ignores, its first occurrence that findSafeOccurrences allows, that a
 * longer term has not claimed, and that keeps the structure. Each candidate is written in
 * after the links picked before it and must parse the same as the post without it
 * (hasSameReaderStructure, the link-only proof's last step); if not, the next occurrence
 * gets its turn. That catches syntax the mask does not know, such as reference links,
 * definitions and footnotes, and the same at every step means the fixer's post parses the
 * same as the original.
 *
 * @param {string} content
 * @param {ReturnType<typeof normalizeGlossary>} glossary normalized entries
 * @param {{ filePath: string, terms?: string[] }} options
 */
export function missingGlossaryLinks(content, glossary, { filePath, terms = [] }) {
  const termFilter = new Set(terms);
  const { data: frontmatter } = parseFrontmatter(content);
  const english = isEnglishPost(filePath, frontmatter);
  const ignored = ignoredTerms(content, frontmatter);
  const mask = buildUnsafeMask(content);
  const occupied = new Array(content.length).fill(false);
  const links = [];
  let linked = content;

  for (const term of glossary) {
    if (termFilter.size && !termFilter.has(term.term)) continue;
    if (ignored.has(term.term)) continue;
    const href = expectedHref(term.anchor, english);
    if (hasCoverage(content, term, href)) continue;

    const occurrences = term.matches
      .flatMap((matchText) => findSafeOccurrences(content, term, matchText, { mask }))
      .filter((occurrence) => rangeIsSafe(occupied, occurrence.start, occurrence.end))
      .sort((a, b) => a.start - b.start);
    for (const occurrence of occurrences) {
      const link = { ...occurrence, term: term.term, href };
      const withLink = writeGlossaryLinks(content, [...links, link]);
      if (!hasSameReaderStructure(linked, withLink)) continue;
      markRange(occupied, link.start, link.end);
      links.push(link);
      linked = withLink;
      break;
    }
  }
  return links;
}

export function checkContent(content, options = {}) {
  const filePath = options.filePath ?? 'post.mdx';
  const glossary = normalizeGlossary(options.glossary ?? loadGlossary());
  const termFilter = new Set(options.terms ?? []);
  const violations = [];

  if (!isEnglishPost(filePath, parseFrontmatter(content).data)) {
    for (const term of glossary) {
      if (termFilter.size && !termFilter.has(term.term)) continue;
      for (const forbidden of term.forbiddenZhTw) {
        for (const occurrence of findCanonicalOccurrences(content, forbidden)) {
          violations.push({
            kind: 'canonical-term',
            file: filePath,
            term: term.term,
            canonicalTerm: term.term,
            forbidden,
            line: occurrence.line,
            text: occurrence.text,
            expectedHref: expectedHref(term.anchor, false),
          });
        }
      }
    }
  }

  for (const link of missingGlossaryLinks(content, glossary, { filePath, terms: options.terms })) {
    violations.push({
      kind: 'missing-link',
      file: filePath,
      term: link.term,
      line: link.line,
      text: link.text,
      expectedHref: link.href,
      command: `node scripts/apply-glossary-links.mjs --term ${JSON.stringify(link.term)} ${JSON.stringify(filePath)}`,
    });
  }
  return { violations };
}

export function checkFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  return checkContent(content, { ...options, filePath });
}

export function listPostFiles() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs
    .readdirSync(POSTS_DIR)
    .filter((name) => name.endsWith('.mdx'))
    .map((name) => path.join(POSTS_DIR, name));
}

function gitChangedFiles(base, pattern = 'src/content/posts') {
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--end-of-options', `${base}...HEAD`, '--', pattern],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((p) => path.join(REPO_ROOT, p));
  } catch {
    throw new Error(`Could not enumerate changed posts from Git base ${JSON.stringify(base)}`);
  }
}

export function changedGlossaryTermsFromEntries(before, after) {
  const beforeMap = new Map(before.map((entry) => [entry.term, JSON.stringify(entry)]));
  return after
    .filter((entry) => beforeMap.get(entry.term) !== JSON.stringify(entry))
    .map((entry) => entry.term);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCanonicalGlossaryLinks(content, glossary) {
  let normalized = String(content);
  for (const entry of normalizeGlossary(glossary)) {
    const canonicalLink = new RegExp(
      `\\[(${escapeRegExp(entry.term)})\\]\\(\\/glossary#${escapeRegExp(entry.anchor)}\\)`,
      'gi'
    );
    normalized = normalized.replace(canonicalLink, '$1');
  }
  return normalized;
}

export function normalizeCanonicalTerminology(content, glossary = loadGlossary()) {
  let normalized = stripCanonicalGlossaryLinks(content, glossary);

  for (const [entryIndex, entry] of normalizeGlossary(glossary).entries()) {
    for (const forbidden of entry.forbiddenZhTw) {
      const term = escapeRegExp(entry.term);
      const old = escapeRegExp(forbidden);
      const sentinel = `\uE000${entryIndex}\uE001`;
      normalized = normalized.replace(
        new RegExp(`${term}\\s*[（(]\\s*${old}\\s*[）)]`, 'gi'),
        sentinel
      );
      normalized = normalized.replace(new RegExp(old, 'g'), sentinel);

      // Add only the spaces required at the exact replacement site. Existing
      // canonical terms elsewhere are never normalized, so unrelated spacing
      // edits cannot hitch a ride on a legitimate terminology migration.
      normalized = normalized.replaceAll(sentinel, (_match, offset, whole) => {
        const left = whole[offset - 1] ?? '';
        const right = whole[offset + sentinel.length] ?? '';
        const beforeSpace = /\p{Script=Han}/u.test(left) ? ' ' : '';
        const afterSpace = /\p{Script=Han}/u.test(right) ? ' ' : '';
        return `${beforeSpace}${entry.term}${afterSpace}`;
      });
    }
  }
  return normalized;
}

function glossaryLinks(line) {
  return line.match(/\[[^\]\n]+\]\(\/(?:en\/)?glossary#[^)\n]+\)/g) ?? [];
}

function multiset(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function isCanonicalTerminologyOnlyChange(before, after, glossary = loadGlossary()) {
  if (before === after) return false;
  const entries = normalizeGlossary(glossary).filter((entry) => entry.forbiddenZhTw.length > 0);
  const beforeLines = String(before).split('\n');
  const afterLines = String(after).split('\n');
  if (beforeLines.length !== afterLines.length) return false;
  let sawReplacement = false;

  for (let index = 0; index < beforeLines.length; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    const beforeLinks = multiset(glossaryLinks(beforeLine));
    const afterLinks = multiset(glossaryLinks(afterLine));

    for (const entry of entries) {
      for (const forbidden of entry.forbiddenZhTw) {
        const pattern = new RegExp(escapeRegExp(forbidden), 'g');
        const beforeCount = beforeLine.match(pattern)?.length ?? 0;
        const afterCount = afterLine.match(pattern)?.length ?? 0;
        if (afterCount > beforeCount) return false;
        if (afterCount < beforeCount) sawReplacement = true;
      }
    }

    // This exemption is directional: existing links cannot be removed or
    // changed. A newly added wrapper must belong to the same glossary entry
    // as a forbidden term replaced on this exact source line.
    for (const [link, count] of beforeLinks) {
      if ((afterLinks.get(link) ?? 0) < count) return false;
    }

    for (const [link, count] of afterLinks) {
      const added = count - (beforeLinks.get(link) ?? 0);
      if (added <= 0) continue;

      const entry = entries.find(
        (candidate) => link === `[${candidate.term}](/glossary#${candidate.anchor})`
      );
      if (!entry) return false;

      const forbiddenCount = entry.forbiddenZhTw.reduce((total, forbidden) => {
        const matches = beforeLine.match(new RegExp(escapeRegExp(forbidden), 'g'));
        return total + (matches?.length ?? 0);
      }, 0);
      if (added > forbiddenCount) return false;
    }

    if (
      normalizeCanonicalTerminology(beforeLine, glossary) !==
      stripCanonicalGlossaryLinks(afterLine, glossary)
    ) {
      return false;
    }
  }

  return sawReplacement;
}

function changedGlossaryTerms(base, glossary) {
  try {
    const show = (ref) => {
      try {
        return execFileSync('git', ['show', `${ref}:src/data/glossary.json`], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
      } catch {
        return '[]';
      }
    };
    const before = JSON.parse(show(base));
    const after = glossary;
    return changedGlossaryTermsFromEntries(before, after);
  } catch {
    return [];
  }
}

export function runCLI(argv, io = { log: console.log, error: console.error }) {
  const args = parseArgs(argv);
  const glossary = loadGlossary();
  if (args.canonicalStagedFile) {
    const file = args.canonicalStagedFile;
    if (path.isAbsolute(file) || file.split('/').includes('..')) return 2;
    try {
      const before = execFileSync('git', ['show', `HEAD:${file}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      const after = execFileSync('git', ['show', `:${file}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return isCanonicalTerminologyOnlyChange(before, after, loadStagedGlossary()) ? 0 : 1;
    } catch {
      return 1;
    }
  }
  let files = args.files.map((f) => path.resolve(f));
  let terms = args.terms;

  if (args.all || (!files.length && !args.changedPostsBase)) files = listPostFiles();
  if (args.changedPostsBase) files.push(...gitChangedFiles(args.changedPostsBase));
  if (args.changedTermsBase) {
    terms = [...new Set([...terms, ...changedGlossaryTerms(args.changedTermsBase, glossary)])];
    if (!files.length) files = listPostFiles();
  }
  files = [...new Set(files)].filter((f) => f.endsWith('.mdx') && fs.existsSync(f));

  const violations = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    violations.push(
      ...checkContent(content, { filePath: file, glossary, terms }).violations,
      ...checkLinkTargets(content, { filePath: file, glossary }).violations
    );
  }
  violations.push(...findMissingRelated(glossary));

  if (args.format === 'json') {
    io.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length) {
    io.error(`❌ Glossary checks failed: ${violations.length} violation(s)`);
    for (const v of violations.slice(0, 200)) {
      if (v.kind === 'canonical-term') {
        io.error(
          `${path.relative(REPO_ROOT, v.file)}:${v.line} forbidden ${JSON.stringify(v.forbidden)} → ${v.canonicalTerm} (${v.expectedHref})`
        );
      } else if (v.kind === 'dead-anchor') {
        io.error(
          `${path.relative(REPO_ROOT, v.file)}:${v.line} ${v.href} → no glossary entry has #${v.anchor} (anchors are case-sensitive)`
        );
        io.error('  fix: point it at an existing anchor, or remove the link and keep its text');
      } else if (v.kind === 'wrong-language') {
        io.error(`${path.relative(REPO_ROOT, v.file)}:${v.line} ${v.href} → ${v.expectedHref}`);
        io.error("  fix: link the glossary in the post's language");
      } else if (v.kind === 'missing-related') {
        io.error(
          `${path.relative(REPO_ROOT, v.file)}: ${v.term} lists related ${JSON.stringify(v.missing)}, which is not a glossary entry`
        );
      } else {
        io.error(`${path.relative(REPO_ROOT, v.file)}:${v.line} ${v.term} → ${v.expectedHref}`);
        io.error(`  fix: ${v.command}`);
      }
    }
    if (violations.length > 200) io.error(`... ${violations.length - 200} more`);
  } else {
    io.log(
      `✓ glossary link coverage clean (${files.length} file(s) checked${terms.length ? `, terms: ${terms.join(', ')}` : ''})`
    );
  }
  return violations.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(runCLI(process.argv.slice(2)));
