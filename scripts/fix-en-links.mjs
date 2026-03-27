#!/usr/bin/env node
// fix-en-links.mjs
// Rewrites broken ](/posts/en-...) links to ](/en/posts/en-...) in all MDX files.

import { readFileSync, writeFileSync } from "fs";
import { readdirSync } from "fs";
import { join } from "path";

const POSTS_DIR = new URL("../src/content/posts", import.meta.url).pathname;
const BROKEN_RE = /\]\(\/posts\/(en-[^)]+)\)/g;

let totalFiles = 0;
let fixedFiles = 0;
let totalLinks = 0;

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx"));

for (const file of files) {
  const filePath = join(POSTS_DIR, file);
  const original = readFileSync(filePath, "utf8");

  let count = 0;
  const fixed = original.replace(BROKEN_RE, (_, slug) => {
    count++;
    return `](/en/posts/${slug})`;
  });

  totalFiles++;

  if (count > 0) {
    writeFileSync(filePath, fixed, "utf8");
    fixedFiles++;
    totalLinks += count;
    console.log(`  fixed ${count} link(s): ${file}`);
  }
}

console.log(`\nDone. Fixed ${totalLinks} links across ${fixedFiles}/${totalFiles} files.`);
