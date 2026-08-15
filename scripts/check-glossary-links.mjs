#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/data/glossary.json');

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

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
        anchor: linking.anchor || slugify(entry.term),
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

export function buildUnsafeMask(content) {
  const mask = new Array(content.length).fill(false);

  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end >= 0) {
      const after = content.indexOf('\n', end + 4);
      markRange(mask, 0, after >= 0 ? after + 1 : content.length);
    }
  }

  maskRegex(content, mask, /```[\s\S]*?```/g);
  maskRegex(content, mask, /`[^`\n]+`/g);
  maskRegex(content, mask, /!?\[[^\]\n]*\]\([^)\n]+\)/g);
  maskRegex(content, mask, /https?:\/\/[^\s)]+/g);

  const lines = content.split(/\n/);
  let offset = 0;
  let inMdxComponent = false;
  for (const line of lines) {
    const lineEnd = offset + line.length;
    const startsMdxComponent = /^\s*<[A-Z][\w.:-]*\b/.test(line);
    const endsMdxComponent = /\/?>\s*$/.test(line) && !/[{(]\s*$/.test(line);

    if (
      inMdxComponent ||
      startsMdxComponent ||
      /^\s*>/.test(line) ||
      /^\s*(import|export)\b/.test(line) ||
      /^\s*<\/?[A-Z][^>]*>\s*$/.test(line)
    ) {
      markRange(mask, offset, lineEnd);
      if (startsMdxComponent && !endsMdxComponent) inMdxComponent = true;
      if (inMdxComponent && endsMdxComponent) inMdxComponent = false;
    } else {
      let tagMatch;
      const tagRe = /<\/?[A-Za-z][^>]*>/g;
      while ((tagMatch = tagRe.exec(line)))
        markRange(mask, offset + tagMatch.index, offset + tagMatch.index + tagMatch[0].length);
    }
    offset = lineEnd + 1;
  }

  return mask;
}

// Canonical terminology has a wider reader-visible surface than link coverage:
// blockquotes and component children are prose, while only the surrounding MDX
// syntax is unsafe. Keep this mask separate so the long-standing link fixer does
// not start mutating quotations or component bodies.
export function buildCanonicalUnsafeMask(content) {
  const mask = new Array(content.length).fill(false);

  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end >= 0) {
      const after = content.indexOf('\n', end + 4);
      markRange(mask, 0, after >= 0 ? after + 1 : content.length);
    }
  }

  maskRegex(content, mask, /```[\s\S]*?```/g);
  maskRegex(content, mask, /~~~[\s\S]*?~~~/g);
  maskRegex(content, mask, /`[^`\n]+`/g);
  maskRegex(content, mask, /<!--[\s\S]*?-->/g);
  // MDX expressions are code. Only a standalone string/template literal is
  // statically guaranteed to render as reader-visible prose; strings nested
  // inside program logic remain syntax and stay masked.
  maskRegex(content, mask, /\{\/\*[\s\S]*?\*\/\}/g);
  const expressionRe = /\{(?!\/\*)[\s\S]*?\}/g;
  let expression;
  while ((expression = expressionRe.exec(content))) {
    markRange(mask, expression.index, expression.index + expression[0].length);
    const visibleLiteral = expression[0].match(/^\{\s*(?:(['"])([\s\S]*?)\1|`([\s\S]*?)`)\s*\}$/);
    if (visibleLiteral) {
      const value = visibleLiteral[2] ?? visibleLiteral[3] ?? '';
      const valueOffset = expression[0].indexOf(value);
      unmarkRange(
        mask,
        expression.index + valueOffset,
        expression.index + valueOffset + value.length
      );
    }
  }
  maskRegex(content, mask, /<[^>]*>/g);
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
    if (/^(?: {4,}|\t+)\S/.test(line)) markRange(mask, offset, offset + line.length);
    offset += line.length + 1;
  }

  return mask;
}

export function frontmatterReaderVisibleRanges(content) {
  if (!content.startsWith('---\n')) return [];
  const end = content.indexOf('\n---', 4);
  if (end < 0) return [];

  const ranges = [];
  const frontmatter = content.slice(4, end);
  const lines = frontmatter.split('\n');
  let offset = 4;
  let inTags = false;
  let inVisibleBlock = false;

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = keyMatch[2];
      inTags = key === 'tags' && value === '';
      inVisibleBlock =
        (key === 'title' || key === 'summary' || key === 'tags') &&
        /^[>|](?:[1-9][+-]?|[+-][1-9]?|)$/.test(value);
      if (
        (key === 'title' || key === 'summary' || key === 'tags') &&
        value !== '' &&
        !inVisibleBlock
      ) {
        const start = offset + line.indexOf(value);
        ranges.push({ start, end: start + value.length });
      }
    } else if (inVisibleBlock) {
      const value = line.trim();
      if (value !== '') {
        const start = offset + line.indexOf(value);
        ranges.push({ start, end: start + value.length });
      }
    } else if (inTags) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        const start = offset + line.indexOf(item[1]);
        ranges.push({ start, end: start + item[1].length });
      } else if (line.trim() !== '') {
        inTags = false;
      }
    }
    offset += line.length + 1;
  }

  return ranges;
}

function isBoundaryChar(ch) {
  return !ch || !/[\p{L}\p{N}_-]/u.test(ch);
}

function rangeIsSafe(mask, start, end) {
  for (let i = start; i < end; i += 1) if (mask[i]) return false;
  return true;
}

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
    if (!isBoundaryChar(content[start - 1]) || !isBoundaryChar(content[end])) continue;
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

export function expectedHref(term, filePath, frontmatter) {
  return `${isEnglishPost(filePath, frontmatter) ? '/en/glossary' : '/glossary'}#${term.anchor}`;
}

export function checkContent(content, options = {}) {
  const filePath = options.filePath ?? 'post.mdx';
  const glossary = normalizeGlossary(options.glossary ?? loadGlossary());
  const termFilter = new Set(options.terms ?? []);
  const { data: frontmatter } = parseFrontmatter(content);
  const ignored = ignoredTerms(content, frontmatter);
  const mask = buildUnsafeMask(content);
  const occupied = new Array(content.length).fill(false);
  const violations = [];

  if (!isEnglishPost(filePath, frontmatter)) {
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
            expectedHref: `/glossary#${term.anchor}`,
          });
        }
      }
    }
  }

  for (const term of glossary) {
    if (termFilter.size && !termFilter.has(term.term)) continue;
    if (ignored.has(term.term)) continue;
    const href = expectedHref(term, filePath, frontmatter);
    if (hasCoverage(content, term, href)) continue;

    let first = null;
    for (const matchText of term.matches) {
      const occurrences = findSafeOccurrences(content, term, matchText, { mask });
      for (const occ of occurrences) {
        let overlaps = false;
        for (let i = occ.start; i < occ.end; i += 1) if (occupied[i]) overlaps = true;
        if (overlaps) continue;
        if (!first || occ.start < first.start) first = occ;
      }
    }
    if (!first) continue;
    markRange(occupied, first.start, first.end);
    violations.push({
      kind: 'missing-link',
      file: filePath,
      term: term.term,
      line: first.line,
      text: first.text,
      expectedHref: href,
      command: `node scripts/apply-glossary-links.mjs --term ${JSON.stringify(term.term)} ${JSON.stringify(filePath)}`,
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
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`, '--', pattern], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((p) => path.join(REPO_ROOT, p));
  } catch {
    return [];
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
      return isCanonicalTerminologyOnlyChange(before, after, glossary) ? 0 : 1;
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
  for (const file of files) violations.push(...checkFile(file, { glossary, terms }).violations);

  if (args.format === 'json') {
    io.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
  } else if (violations.length) {
    io.error(`❌ Glossary checks failed: ${violations.length} violation(s)`);
    for (const v of violations.slice(0, 200)) {
      if (v.kind === 'canonical-term') {
        io.error(
          `${path.relative(REPO_ROOT, v.file)}:${v.line} forbidden ${JSON.stringify(v.forbidden)} → ${v.canonicalTerm} (${v.expectedHref})`
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
