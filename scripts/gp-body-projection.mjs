#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createProcessor } from '@mdx-js/mdx';

const allowlistedLink = /^(?:\/|\.\.\/|\.\/)*(?:en\/)?(?:glossary(?:#|\/)|posts\/)/;

function withoutFrontmatter(document) {
  if (!document.startsWith('---\n')) return document;
  const end = document.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('unterminated frontmatter');
  return document.slice(end + '\n---\n'.length);
}

function expandWholeLines(source, start, end) {
  let from = start;
  let to = end;
  while (from > 0 && source[from - 1] !== '\n') from -= 1;
  if (to < source.length && source[to] === '\n') to += 1;
  if (from >= 1 && source[from - 1] === '\n') from -= 1;
  return { start: from, end: to, replacement: '' };
}

function linkInnerSource(source, node) {
  if (!node.children?.length) throw new Error('allowlisted link has no child text');
  const first = node.children[0]?.position?.start?.offset;
  const last = node.children.at(-1)?.position?.end?.offset;
  if (!Number.isInteger(first) || !Number.isInteger(last)) {
    throw new Error('allowlisted link is missing parser positions');
  }
  return source.slice(first, last);
}

function collectPatches(source, node, patches) {
  if (node.type === 'mdxjsEsm' && /import\s+MoguNote\s+from\s+/.test(node.value ?? '')) {
    patches.push(expandWholeLines(source, node.position.start.offset, node.position.end.offset));
    return;
  }
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    if (node.name !== 'MoguNote') {
      throw new Error(`unknown MDX component in GP enrichment: ${node.name ?? '(fragment)'}`);
    }
    patches.push(expandWholeLines(source, node.position.start.offset, node.position.end.offset));
    return;
  }
  if (node.type === 'link' && allowlistedLink.test(node.url ?? '')) {
    patches.push({
      start: node.position.start.offset,
      end: node.position.end.offset,
      replacement: linkInnerSource(source, node),
    });
    return;
  }
  for (const child of node.children ?? []) collectPatches(source, child, patches);
}

/**
 * Return the canonical GP body bytes as a UTF-8 string. The MDX parser is used
 * only to locate allowlisted enrichment nodes; all other source bytes retain
 * their original spelling, spacing and order.
 */
export function projectGPBody(document) {
  const source = withoutFrontmatter(document);
  const tree = createProcessor({ format: 'mdx' }).parse(source);
  const patches = [];
  collectPatches(source, tree, patches);
  patches.sort((a, b) => a.start - b.start);
  for (let i = 1; i < patches.length; i += 1) {
    if (patches[i].start < patches[i - 1].end) throw new Error('overlapping enrichment nodes');
  }
  let projected = source;
  for (const patch of patches.toReversed()) {
    projected = projected.slice(0, patch.start) + patch.replacement + projected.slice(patch.end);
  }
  return projected;
}

export function projectionEnvelope(document) {
  const body = projectGPBody(document);
  return {
    version: 'gp-source-preservation/v1',
    body,
    sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    throw new Error('usage: node scripts/gp-body-projection.mjs <post.mdx>');
  }
  const document = await readFile(file, 'utf8');
  process.stdout.write(`${JSON.stringify(projectionEnvelope(document))}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`gp-body-projection: ${error.message}`);
    process.exitCode = 1;
  });
}
