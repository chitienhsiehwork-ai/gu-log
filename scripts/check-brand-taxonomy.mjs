#!/usr/bin/env node
// 品牌改名（SP/CP → GP/MP、Clawd → Mogu）已在 2026-07 完成。
// 這支只擋「確定已退役、不該再回來」的舊名，掃 git 追蹤檔的路徑與內容。
// 記錄歷史或刻意保留舊名的檔案放 EXCLUDES，不用逐檔計數的 allowlist。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 結尾 `/` 是目錄前綴，開頭 `*` 是副檔名結尾，其餘是完整路徑。
const EXCLUDES = [
  'openspec/', // spec 與 archive 記錄改名契約與歷史
  'sources/',
  'scores/archive/',
  '.score-loop/progress/completed/',
  'quality/coverage-history.json',
  'tests/', // 舊名拒收、舊網址 redirect 的測試 fixture
  '*_test.go',
  'quality/brand-taxonomy-post-migration.json', // 舊網址 redirect 對照表
  'vercel.mjs', // 舊網址 redirect 實作
  '.github/workflows/deploy-smoke-test.yml', // 上線後驗 redirect
  'scripts/validate-posts.mjs', // 拒收舊 ticketId／schema key
  'scripts/frontmatter-scores.mjs',
  'src/content.config.ts',
  'src/data/post-authorship-notes.json', // 歷史作者紀錄
  'docs/shroomdog-editorial-feedback.md', // 逐字引用的修稿回饋
  'scripts/check-brand-taxonomy.mjs',
];

export const RETIRED = [
  /\bClawdNote\b|\bclawdNote\b|\bCLAWD_NOTE\w*|--color-clawd\b|\.clawd-prefix\b/g,
  /\bShroomClawd\b|\bClawd\b(?!\.rip\b)|\[!clawd\]/g,
  /\b(?:SP|CP)-(?:\d+|PENDING)\b|\b(?:sp|cp)-(?:\d+|pending)(?=[-./"')\s]|$)/gm,
  /\b(?:clawd-picks|shroom-picks|shroomdog-picks|Clawd Picks|ShroomDog Picks|Shroom Picks)\b/g,
  /\bsp-pipeline\b/g,
];

export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const re of RETIRED) {
      for (const m of line.matchAll(re)) hits.push({ line: i + 1, token: m[0] });
    }
  });
  return hits;
}

export const isExcluded = (file) =>
  EXCLUDES.some((x) =>
    x.endsWith('/')
      ? file.startsWith(x)
      : x.startsWith('*')
        ? file.endsWith(x.slice(1))
        : file === x
  );

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && !isExcluded(f));
  const found = [];
  for (const file of files) {
    for (const hit of scanText(file)) found.push(`${file} (path) ${hit.token}`);
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, file));
    } catch {
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) continue;
    for (const hit of scanText(buf.toString('utf8')))
      found.push(`${file}:${hit.line} ${hit.token}`);
  }
  for (const f of found) console.error(`退役品牌名：${f}`);
  console.log(`brand taxonomy check: ${found.length} 個退役品牌名（${files.length} 個檔案）`);
  if (found.length) process.exitCode = 1;
}
