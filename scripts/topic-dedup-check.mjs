#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = path.join(__dirname, '../src/content/posts');

const ENGLISH_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'been',
  'being',
  'from',
  'have',
  'into',
  'just',
  'more',
  'over',
  'says',
  'saying',
  'said',
  'that',
  'their',
  'them',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

const SOCIAL_DOMAINS = new Set(['x.com', 'twitter.com']);
const COMMON_HAN_FUNCTION_CHARS = new Set(['的', '了', '會', '來', '有', '在', '把', '被', '說']);

const SEMANTIC_PATTERNS = [
  [/anthropic|claude|openai|gemini|karpathy|figma|cursor/giu, null],
  [/(emotion|emotions|情緒)/giu, 'emotion'],
  [/(vector|vectors|向量)/giu, 'vector'],
  [/(behavior|behaviour|行為)/giu, 'behavior'],
  [/(assistant|助手)/giu, 'assistant'],
  [/(research|paper|論文|研究)/giu, 'research'],
  [/(interpretability|可解釋性)/giu, 'interpretability'],
  [/(safety|安全)/giu, 'safety'],
  [/(model|models|模型)/giu, 'model'],
  [/(agent|agents|agentic|代理)/giu, 'agent'],
];

function parseArgs(argv) {
  const args = { url: '', title: '', tags: '', ignoreFile: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!flag.startsWith('--')) {
      continue;
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === '--url') {
      args.url = value;
    } else if (flag === '--title') {
      args.title = value;
    } else if (flag === '--tags') {
      args.tags = value;
    } else if (flag === '--ignore-file') {
      args.ignoreFile = value;
    } else {
      throw new Error(`Unknown flag: ${flag}`);
    }

    index += 1;
  }

  if (!args.url || !args.title) {
    throw new Error(
      'Usage: node scripts/topic-dedup-check.mjs --url <source_url> --title <title> [--tags tag1,tag2]'
    );
  }

  return args;
}

function normalizeDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
}

function extractDomainTokens(domain) {
  return domain
    .split('.')
    .flatMap((part) => part.split('-'))
    .map((token) => normalizeEnglishToken(token))
    .filter(Boolean);
}

function normalizeEnglishToken(token) {
  const cleaned = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (cleaned.length <= 2 || ENGLISH_STOPWORDS.has(cleaned)) {
    return null;
  }

  if (cleaned.endsWith('ies') && cleaned.length > 4) {
    return `${cleaned.slice(0, -3)}y`;
  }

  if (cleaned.endsWith('s') && !cleaned.endsWith('ss') && cleaned.length > 3) {
    return cleaned.slice(0, -1);
  }

  return cleaned;
}

function extractKeywords(title) {
  const keywords = new Set();
  const latinTokens = title.match(/[\p{Script=Latin}\p{Number}]+/gu) ?? [];
  const hanTokens = title.match(/[\p{Script=Han}]{2,}/gu) ?? [];

  for (const [pattern, alias] of SEMANTIC_PATTERNS) {
    const matches = title.match(pattern) ?? [];
    for (const match of matches) {
      keywords.add(alias ?? match.toLowerCase());
    }
  }

  for (const token of latinTokens) {
    const normalized = normalizeEnglishToken(token);
    if (normalized) {
      keywords.add(normalized);
    }
  }

  if (keywords.size < 3) {
    for (const token of hanTokens) {
      // Fallback for Chinese-only titles that have few high-signal tokens.
      for (let index = 0; index < token.length - 1; index += 1) {
        const bigram = token.slice(index, index + 2);
        if (
          !COMMON_HAN_FUNCTION_CHARS.has(bigram[0]) &&
          !COMMON_HAN_FUNCTION_CHARS.has(bigram[1])
        ) {
          keywords.add(bigram);
        }
      }

      if (token.length <= 6) {
        keywords.add(token);
      }
    }
  }

  return keywords;
}

function parseTags(tagsValue) {
  const rawTags = Array.isArray(tagsValue)
    ? tagsValue.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
    : String(tagsValue || '')
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);

  const normalizedTags = new Set();

  for (const tag of rawTags) {
    normalizedTags.add(tag);

    for (const part of tag.split(/[-_/]+/)) {
      const normalizedPart = normalizeEnglishToken(part) ?? (part.length >= 2 ? part : null);
      if (normalizedPart) {
        normalizedTags.add(normalizedPart);
      }
    }
  }

  return [...normalizedTags];
}

function jaccardSimilarity(left, right) {
  const leftSet = left instanceof Set ? left : new Set(left);
  const rightSet = right instanceof Set ? right : new Set(right);

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function loadPublishedPosts(ignoreFile) {
  const ignoredBasename = ignoreFile ? path.basename(ignoreFile) : '';

  return fs
    .readdirSync(POSTS_DIR)
    .filter((file) => file.endsWith('.mdx') && !file.startsWith('en-'))
    .map((file) => {
      const filePath = path.join(POSTS_DIR, file);
      const raw = fs.readFileSync(filePath, 'utf8');
      const { data } = matter(raw);

      return {
        file,
        ticketId: data.ticketId,
        title: data.title,
        sourceUrl: data.sourceUrl,
        tags: parseTags(data.tags),
        deprecated: Boolean(data.deprecated),
      };
    })
    .filter(
      (post) =>
        post.file !== ignoredBasename &&
        post.ticketId &&
        post.title &&
        post.sourceUrl &&
        !post.deprecated
    );
}

function scoreAgainstPost(candidate, post) {
  const candidateTitleKeywords = extractKeywords(candidate.title);
  const postTitleKeywords = extractKeywords(post.title);
  const titleSimilarity = jaccardSimilarity(candidateTitleKeywords, postTitleKeywords);

  const candidateTags = new Set(candidate.tags);
  const postTags = new Set(post.tags);
  const tagSimilarity = jaccardSimilarity(candidateTags, postTags);

  const candidateDomain = normalizeDomain(candidate.url);
  const postDomain = normalizeDomain(post.sourceUrl);
  const exactDomainMatch = Boolean(
    candidateDomain &&
    postDomain &&
    candidateDomain === postDomain &&
    !SOCIAL_DOMAINS.has(candidateDomain)
  );
  const socialBrandMatch =
    SOCIAL_DOMAINS.has(candidateDomain) &&
    extractDomainTokens(postDomain).some((token) => candidateTitleKeywords.has(token));
  const domainMatch = exactDomainMatch || socialBrandMatch;

  const score = titleSimilarity * 0.5 + (tagSimilarity >= 0.5 ? 0.3 : 0) + (domainMatch ? 0.2 : 0);

  const reasons = [];
  if (titleSimilarity > 0) {
    reasons.push(`title_jaccard=${titleSimilarity.toFixed(3)}`);
  }
  if (tagSimilarity >= 0.5) {
    reasons.push(`tag_jaccard=${tagSimilarity.toFixed(3)}`);
  }
  if (domainMatch) {
    reasons.push(
      exactDomainMatch
        ? `source_domain=${candidateDomain}`
        : `source_domain=${postDomain} (brand match from title)`
    );
  }

  return {
    score,
    reasons,
  };
}

function getStatus(score) {
  if (score > 0.85) {
    return 'BLOCK';
  }

  if (score > 0.7) {
    return 'WARN';
  }

  return 'OK';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidate = {
    url: args.url,
    title: args.title,
    tags: parseTags(args.tags),
  };

  const posts = loadPublishedPosts(args.ignoreFile);
  let bestMatch = null;

  for (const post of posts) {
    const result = scoreAgainstPost(candidate, post);

    if (!bestMatch || result.score > bestMatch.score) {
      bestMatch = {
        score: result.score,
        ticketId: post.ticketId,
        title: post.title,
        reasons: result.reasons,
      };
    }
  }

  const score = Number((bestMatch?.score ?? 0).toFixed(3));
  const payload = {
    status: getStatus(score),
    score,
    match: bestMatch
      ? {
          ticketId: bestMatch.ticketId,
          title: bestMatch.title,
          reasons: bestMatch.reasons,
        }
      : null,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
}
