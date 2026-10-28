#!/usr/bin/env node
/**
 * reclassify-post.mjs — 把已上線的文章在 GP 與 MP 之間搬（openspec gp-signature-picks）。
 *
 *   node scripts/reclassify-post.mjs <ticketId> <GP|MP>
 *
 * ShroomDog 指定一篇已上線的 MP 當招牌時，用它升格成 GP；GP 改回 MP 也用它。GP 號只從這裡配出。
 *
 * 所有拒絕條件都在動手前檢查完，被拒絕時什麼都不改：目標不存在、不是 GP 或 MP、還沒上線
 * （PENDING）、已下架、已在目標系列，或移到 GP 卻沒通過 publish bar（分數用 `yaml` 解析，交給
 * src/utils/tribunal-scores.ts 的 meetsPublishBar 判斷）。GP 改回 MP 不看 publish bar。
 *
 * 通過檢查後：
 *   1. 取目標系列 counter 的 next 當新號，counter 推進
 *   2. 每個語言檔 `git mv` 成新檔名（日期與標題 slug 不變），frontmatter 的 ticketId 換成新號
 *   3. quality/brand-taxonomy-post-migration.json 每個舊網址加一筆；newSlug 原本指向這篇的項目
 *      （例如 SP 時代的別名）直接改指新 slug，counts 用 vercel.mjs 的 deriveManifestCounts 重算
 *   4. src/ 裡連到它的網址改成新 slug；Markdown 連結文字裡的舊 ticket 換成新 ticket，
 *      「ticket: 標題」的連結因此符合 pre-commit「只改連結」的證明；別篇的 deprecatedBy 也換新號
 *   5. 跑 scripts/validate-posts.mjs 驗新檔，失敗就以非 0 結束並印出 validator 的輸出
 *
 * 操作的是目前所在的 git repo。不 commit：看過 diff 再 commit，commit 後
 * `pnpm run versions:check` 沒過就重建兩份 version manifest 一起 commit。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import YAML from 'yaml';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = 'src/content/posts';
const COUNTER_FILE = 'scripts/article-counter.json';
const MANIFEST_FILE = 'quality/brand-taxonomy-post-migration.json';
// 由 git 歷史與文章內容產生，commit 後重建，這裡不改。
const GENERATED = new Set(['src/data/post-versions.json', 'src/data/post-reader-revisions.json']);
const TICKET = /^(GP|MP)-([1-9]\d*)$/;
const TARGETS = ['GP', 'MP'];

export class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function frontmatterOf(content, file) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (block === undefined) refuse(`${file}：讀不到 frontmatter`);
  try {
    return YAML.parse(block) ?? {};
  } catch (error) {
    refuse(`${file}：frontmatter 解析失敗（${error.message}）`);
  }
}

/** 換掉 frontmatter 裡 `key: <ticket>` 那一行的值，引號照舊。 */
function swapFrontmatterTicket(content, key, from, to) {
  const line = new RegExp(`^(${key}:[ \\t]*)(["']?)${escape(from)}\\2([ \\t]*)$`, 'm');
  const end = content.indexOf('\n---', 3);
  const head = content.slice(0, end);
  if (!content.startsWith('---') || end < 0 || !line.test(head)) return content;
  return head.replace(line, `$1$2${to}$2$3`) + content.slice(end);
}

/**
 * 改寫一份文字裡指向舊 slug 的網址；Markdown 連結的文字裡出現舊 ticket 就換成新 ticket。
 * @param {Map<string, string>} slugs 舊 slug → 新 slug
 */
export function retargetLinks(content, slugs, oldTicket, newTicket) {
  if (slugs.size === 0) return content;
  const alternatives = [...slugs.keys()].map(escape).join('|');
  const pathRe = new RegExp(`(/(?:en/)?posts/)(${alternatives})(?![a-z0-9-])`, 'g');
  const ticketRe = new RegExp(`(?<![A-Za-z0-9-])${escape(oldTicket)}(?![0-9])`, 'g');
  const linked = content.replace(/\[([^[\]\n]+)\]\(([^()\s]+)\)/g, (raw, label, href) => {
    const next = href.replace(pathRe, (_, prefix, slug) => prefix + slugs.get(slug));
    return next === href ? raw : `[${label.replace(ticketRe, newTicket)}](${next})`;
  });
  return linked.replace(pathRe, (_, prefix, slug) => prefix + slugs.get(slug));
}

/** 這個 ticket 的所有語言檔；檔名與 ticketId 對不上就拒絕。 */
function findTicketFiles(root, ticket) {
  const [series, number] = ticket.split('-');
  const nameRe = new RegExp(`^(en-)?${series.toLowerCase()}-${number}-(.+)\\.mdx$`);
  const ticketLine = new RegExp(`^ticketId:[ \\t]*["']?${escape(ticket)}["']?[ \\t]*$`, 'm');
  const files = [];
  for (const name of fs.readdirSync(path.join(root, POSTS_DIR)).sort()) {
    if (!name.endsWith('.mdx')) continue;
    const named = nameRe.exec(name);
    const content = fs.readFileSync(path.join(root, POSTS_DIR, name), 'utf8');
    if (!named && !ticketLine.test(content)) continue;
    const data = frontmatterOf(content, name);
    if (!named || data.ticketId !== ticket) {
      refuse(`${name} 的檔名跟 ticketId（${data.ticketId}）對不上，先修好再改系列`);
    }
    files.push({ name, lang: named[1] ? 'en' : 'zh-tw', rest: named[2], content, data });
  }
  return files.sort((a, b) => (a.lang === 'en') - (b.lang === 'en')); // 繁中在前
}

export async function planReclassification(root, ticket, target) {
  if (!TARGETS.includes(target)) refuse(`目標系列只能是 GP 或 MP，收到 ${target}`);
  if (/-PENDING$/i.test(ticket)) refuse(`${ticket} 還沒上線；先發布，再改系列`);
  if (!TICKET.test(ticket)) refuse(`${ticket} 不是 GP 或 MP 的已上線 ticket（只能搬 GP-N、MP-N）`);
  const series = ticket.split('-')[0];
  if (series === target) refuse(`${ticket} 已經是 ${target}`);

  const files = findTicketFiles(root, ticket);
  if (files.length === 0) refuse(`找不到 ${ticket} 的文章檔`);
  if (new Set(files.map((file) => file.lang)).size !== files.length) {
    refuse(`${ticket} 同一個語言有不只一個檔：${files.map((file) => file.name).join('、')}`);
  }
  for (const file of files) {
    if (file.data.status === 'taken-down') refuse(`${file.name} 已下架，墓碑留在原處`);
    if (swapFrontmatterTicket(file.content, 'ticketId', ticket, ticket + '-') === file.content) {
      refuse(`${file.name}：frontmatter 裡找不到可以替換的 ticketId 那一行`);
    }
    try {
      git(root, ['ls-files', '--error-unmatch', '--', `${POSTS_DIR}/${file.name}`]);
    } catch {
      refuse(`${file.name} 不在 git 裡，不是已上線的文章`);
    }
  }
  if (target === 'GP') {
    const url = pathToFileURL(path.join(CODE_ROOT, 'src/utils/tribunal-scores.ts')).href;
    const { meetsPublishBar } = await tsImport(url, import.meta.url);
    for (const file of files) {
      if (!meetsPublishBar(file.data.scores)) {
        refuse(
          `${file.name} 沒通過 publish bar（meetsPublishBar）：要先通過 publish bar 才能成為 GP`
        );
      }
    }
  }

  const counter = JSON.parse(fs.readFileSync(path.join(root, COUNTER_FILE), 'utf8'));
  const next = counter[target]?.next;
  if (!Number.isInteger(next) || next < 1) refuse(`${COUNTER_FILE} 的 ${target}.next 不是正整數`);
  const newTicket = `${target}-${next}`;
  if (findTicketFiles(root, newTicket).length > 0) refuse(`${newTicket} 已經有文章`);

  const moves = files.map((file) => {
    const prefix = file.lang === 'en' ? 'en-' : '';
    const newName = `${prefix}${target.toLowerCase()}-${next}-${file.rest}.mdx`;
    if (fs.existsSync(path.join(root, POSTS_DIR, newName))) refuse(`${newName} 已經存在`);
    return { ...file, newName, oldSlug: file.name.slice(0, -4), newSlug: newName.slice(0, -4) };
  });

  // vercel.mjs 載入時就從 cwd 讀遷移清單驗一次，所以先切到 repo 根目錄。
  process.chdir(root);
  const { buildRedirectConfig, deriveManifestCounts } = await import(
    pathToFileURL(path.join(CODE_ROOT, 'vercel.mjs')).href
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_FILE), 'utf8'));
  for (const move of moves) {
    for (const entry of manifest.entries) {
      if (entry.lang !== move.lang || entry.newSlug !== move.oldSlug) continue;
      Object.assign(entry, {
        newTicketId: newTicket,
        newFilename: move.newName,
        newSlug: move.newSlug,
      });
    }
    manifest.entries.push({
      lang: move.lang,
      oldTicketId: ticket,
      newTicketId: newTicket,
      oldFilename: move.name,
      newFilename: move.newName,
      oldSlug: move.oldSlug,
      newSlug: move.newSlug,
    });
  }
  manifest.counts = deriveManifestCounts(manifest.entries);
  try {
    buildRedirectConfig(manifest);
  } catch (error) {
    refuse(`改完的遷移清單過不了 vercel.mjs 的檢查：${error.message}`);
  }

  return { ticket, newTicket, target, counter, manifest, moves };
}

function linkedFiles(root) {
  return git(root, ['ls-files', '-z', '--', 'src'])
    .split('\0')
    .filter((file) => file && !GENERATED.has(file) && fs.existsSync(path.join(root, file)));
}

export function applyReclassification(root, plan) {
  const { ticket, newTicket, target, counter, manifest, moves } = plan;
  for (const move of moves) {
    git(root, ['mv', '--', `${POSTS_DIR}/${move.name}`, `${POSTS_DIR}/${move.newName}`]);
    const file = path.join(root, POSTS_DIR, move.newName);
    fs.writeFileSync(file, swapFrontmatterTicket(move.content, 'ticketId', ticket, newTicket));
  }

  counter[target].next += 1;
  fs.writeFileSync(path.join(root, COUNTER_FILE), `${JSON.stringify(counter, null, 2)}\n`);
  fs.writeFileSync(path.join(root, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  const slugs = new Map(moves.map((move) => [move.oldSlug, move.newSlug]));
  const relinked = [];
  for (const file of linkedFiles(root)) {
    const abs = path.join(root, file);
    const raw = fs.readFileSync(abs);
    if (raw.includes(0)) continue;
    const content = raw.toString('utf8');
    let next = retargetLinks(content, slugs, ticket, newTicket);
    if (file.startsWith(`${POSTS_DIR}/`)) {
      next = swapFrontmatterTicket(next, 'deprecatedBy', ticket, newTicket);
    }
    if (next === content) continue;
    fs.writeFileSync(abs, next);
    relinked.push(file);
  }
  return relinked;
}

function validate(root, moves) {
  const files = moves.map((move) => path.join(root, POSTS_DIR, move.newName));
  return spawnSync(process.execPath, [path.join(root, 'scripts/validate-posts.mjs'), ...files], {
    cwd: root,
    encoding: 'utf8',
  });
}

async function main(argv) {
  const [ticket, target, ...extra] = argv;
  if (!ticket || !target || extra.length > 0) {
    refuse('用法：node scripts/reclassify-post.mjs <ticketId> <GP|MP>');
  }
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const plan = await planReclassification(root, ticket, target);
  const relinked = applyReclassification(root, plan);

  console.log(`${plan.ticket} → ${plan.newTicket}`);
  for (const move of plan.moves) console.log(`  ${move.name}\n    → ${move.newName}`);
  console.log(`  counter：${plan.target}.next → ${plan.counter[plan.target].next}`);
  console.log(`  遷移清單：新增 ${plan.moves.length} 筆`);
  for (const file of relinked) console.log(`  連結：${file}`);

  const result = validate(root, plan.moves);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    console.error('✗ validate-posts 沒過，看上面的輸出修好再 commit');
    return 1;
  }
  console.log('✓ validate-posts 通過。看過 diff 再 commit。');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
