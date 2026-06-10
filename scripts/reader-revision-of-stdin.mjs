#!/usr/bin/env node
/**
 * Read post content from stdin, print its reader-facing revision hash.
 *
 * Thin wrapper around computeReaderRevisionFromContent so the pre-commit
 * score gate can compare the staged vs HEAD reader-visible content of a post
 * without reimplementing the hashing. Backend-only frontmatter (scores,
 * translatedBy, pipeline, …) is excluded by the shared helper, so adding a
 * scores block does NOT count as a reader-visible change.
 */
import { computeReaderRevisionFromContent } from './build-reader-revision-manifest.mjs';

let data = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  process.stdout.write(computeReaderRevisionFromContent(data));
});
