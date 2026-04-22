#!/usr/bin/env node
// obsidian-import.mjs
// ---------------------------------------------------------------------------
// 把 Obsidian vault 裡的草稿 .md 匯入成 gu-log 的 MDX 文章。
//
// Vault 草稿的樣貌（iPhone / Mac 在 Obsidian 裡寫的東西）：
//
//   ---
//   series: SD               # SD / SP / CP / Lv
//   title: "文章標題"
//   summary: "一兩句話摘要"
//   source: "ShroomDog Lab"            # SD 可省；SP/CP 必填
//   sourceUrl: "https://..."           # SD 可省；SP/CP 必填
//   author: "@foo on X"                # 選填
//   tags: [ai-agent, memory]           # 選填
//   originalDate: 2026-04-11            # 選填，省略 = 今天
//   ---
//
//   這裡寫正文。Clawd / ShroomDog 的吐槽框用 Obsidian callout 語法：
//
//   > [!clawd] Clawd 吐槽
//   > 內容 1
//   > 內容 2
//
//   > [!shroomdog]
//   > ShroomDog 自己講話
//
//   連結：[[sp-100-slug]] → 會轉成 /posts/sp-100-slug
//
// 使用方式：
//   node scripts/obsidian-import.mjs <path-to-draft.md>          # import 單一檔
//   node scripts/obsidian-import.mjs --all <vault-dir>           # import 整個資料夾
//   node scripts/obsidian-import.mjs <draft.md> --dry-run        # 只印結果不寫檔
//
// 匯入後：
//   1. 產生 src/content/posts/{series}-{N}-{date}-{slug}.mdx
//   2. 自動 bump scripts/article-counter.json
//   3. 跑 scripts/validate-posts.mjs 驗證
//   4. 印出下一步（git add / commit / tribunal）
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const COUNTER_PATH = path.join(ROOT, 'scripts/article-counter.json');

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function today() {
  // YYYY-MM-DD（以系統時間為準，Obsidian 草稿沒寫日期就用今天）
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function readCounter() {
  return JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf-8'));
}

function writeCounter(counter) {
  fs.writeFileSync(COUNTER_PATH, JSON.stringify(counter, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Callout 轉換：Obsidian callout → <ClawdNote> / <ShroomDogNote>
// ---------------------------------------------------------------------------

const CALLOUT_MAP = {
  clawd: 'ClawdNote',
  clawdnote: 'ClawdNote',
  shroomdog: 'ShroomDogNote',
  shroomdognote: 'ShroomDogNote',
  sd: 'ShroomDogNote',
};

function convertCallouts(body) {
  // Obsidian callout 語法：
  //   > [!type] optional title
  //   > line 1
  //   > line 2
  // 空行結束 block。
  const lines = body.split('\n');
  const out = [];
  let i = 0;

  const usedComponents = new Set();

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^>\s*\[!(\w+)\](.*)$/);
    if (match) {
      const type = match[1].toLowerCase();
      const component = CALLOUT_MAP[type];
      if (component) {
        usedComponents.add(component);
        const content = [];
        i++;
        while (i < lines.length && lines[i].startsWith('>')) {
          // 去掉 leading "> " 或 ">"
          content.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push(`<${component}>`);
        // 去頭尾空行
        while (content.length && content[0].trim() === '') content.shift();
        while (content.length && content[content.length - 1].trim() === '') content.pop();
        out.push(...content);
        out.push(`</${component}>`);
        out.push('');
        continue;
      }
    }
    out.push(line);
    i++;
  }

  return { body: out.join('\n'), usedComponents };
}

// ---------------------------------------------------------------------------
// Wikilink 轉換：[[foo]] → [foo](/posts/foo)
// ---------------------------------------------------------------------------

function convertWikilinks(body) {
  return body.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, target, _alias, label) => {
    const text = label || target;
    const slug = target.replace(/\.mdx?$/, '');
    return `[${text}](/posts/${slug})`;
  });
}

// ---------------------------------------------------------------------------
// Frontmatter 建構
// ---------------------------------------------------------------------------

function buildFrontmatter(draft, ticketId, _slug) {
  const series = draft.series;
  const isOriginal = series === 'SD' || series === 'Lv';
  const originalDate = draft.originalDate || today();
  const translatedDate = draft.translatedDate || today();

  const fm = {
    ticketId,
    title: draft.title,
    originalDate,
    translatedDate,
    source: draft.source || (isOriginal ? 'ShroomDog Lab' : undefined),
    sourceUrl: draft.sourceUrl || (isOriginal ? 'https://gu-log.vercel.app/' : undefined),
    lang: 'zh-tw',
    summary: draft.summary,
  };

  if (draft.author) fm.author = draft.author;
  if (draft.tags && draft.tags.length) fm.tags = draft.tags;

  // SP/CP 需要 translatedBy；SD/Lv 給 Author pipeline
  if (isOriginal) {
    fm.translatedBy = {
      model: draft.model || 'Opus 4.6',
      harness: draft.harness || 'Claude Code',
      pipeline: [
        {
          role: 'Author',
          model: draft.model || 'Opus 4.6',
          harness: draft.harness || 'Claude Code',
        },
      ],
    };
  } else {
    // SP / CP：先給占位，使用者匯入後再照 detect-model.mjs 校正
    fm.translatedBy = {
      model: draft.model || 'Opus 4.6',
      harness: draft.harness || 'Claude Code',
      pipeline: [
        {
          role: 'Translator',
          model: draft.model || 'Opus 4.6',
          harness: draft.harness || 'Claude Code',
        },
      ],
    };
  }

  if (draft.series_group) {
    fm.series = draft.series_group;
  }

  // 清掉 undefined
  for (const k of Object.keys(fm)) {
    if (fm[k] === undefined) delete fm[k];
  }
  return fm;
}

// gray-matter 的 stringify 預設會做合理的 YAML；但我們要控制引號避免 title 被亂動
function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      if (typeof v[0] === 'object') {
        lines.push(`${pad}${k}:`);
        const itemPad = '  '.repeat(indent + 1);
        for (const item of v) {
          // Render item lines at indent+1, then strip that padding and re-attach
          // dash to the first line / matching indent to continuation lines.
          const rendered = toYaml(item, indent + 1).split('\n');
          lines.push(`${itemPad}- ${rendered[0].slice(itemPad.length)}`);
          for (const r of rendered.slice(1)) {
            lines.push(`${itemPad}  ${r.slice(itemPad.length)}`);
          }
        }
      } else {
        lines.push(`${pad}${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
      }
    } else if (typeof v === 'object') {
      lines.push(`${pad}${k}:`);
      lines.push(toYaml(v, indent + 1));
    } else if (typeof v === 'string') {
      // 統一用雙引號，避免冒號、引號打架
      const esc = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`${pad}${k}: "${esc}"`);
    } else {
      lines.push(`${pad}${k}: ${v}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 主流程：處理單一 draft 檔
// ---------------------------------------------------------------------------

function importOne(draftPath, { dryRun = false } = {}) {
  const raw = fs.readFileSync(draftPath, 'utf-8');
  const parsed = matter(raw);
  const draft = parsed.data;
  let body = parsed.content;

  if (!draft.series) {
    throw new Error(`[${draftPath}] frontmatter 缺 series (SD / SP / CP / Lv)`);
  }
  if (!draft.title) {
    throw new Error(`[${draftPath}] frontmatter 缺 title`);
  }
  if (!draft.summary) {
    throw new Error(`[${draftPath}] frontmatter 缺 summary`);
  }
  const series = String(draft.series).toUpperCase();
  if (!['SD', 'SP', 'CP', 'LV'].includes(series)) {
    throw new Error(`[${draftPath}] series "${draft.series}" 不合法，必須是 SD / SP / CP / Lv`);
  }
  const seriesKey = series === 'LV' ? 'Lv' : series;

  // SP / CP 必填 source / sourceUrl
  if ((seriesKey === 'SP' || seriesKey === 'CP') && (!draft.source || !draft.sourceUrl)) {
    throw new Error(`[${draftPath}] ${seriesKey} 系列必填 source + sourceUrl`);
  }

  // 1. 決定 ticket id
  const counter = readCounter();
  const n = counter[seriesKey].next;
  const ticketId = `${seriesKey}-${n}`;

  // 2. 決定檔名
  const dateForSlug = (draft.originalDate || today()).replace(/-/g, '');
  const slug = slugify(draft.slug || draft.title);
  const filename = `${seriesKey.toLowerCase()}-${n}-${dateForSlug}-${slug}.mdx`;
  const outPath = path.join(POSTS_DIR, filename);

  // 3. Callout + wikilink 轉換
  const converted = convertCallouts(body);
  body = convertWikilinks(converted.body);

  // 4. import 需要的 component
  const imports = [];
  if (converted.usedComponents.has('ClawdNote')) {
    imports.push("import ClawdNote from '../../components/ClawdNote.astro';");
  }
  if (converted.usedComponents.has('ShroomDogNote')) {
    imports.push("import ShroomDogNote from '../../components/ShroomDogNote.astro';");
  }

  // 5. 組 frontmatter
  const fm = buildFrontmatter({ ...draft, series: seriesKey }, ticketId, slug);
  const yaml = toYaml(fm);

  const sections = [`---`, yaml, `---`, ``];
  if (imports.length) {
    sections.push(imports.join('\n'));
    sections.push('');
  }
  sections.push(body.trimStart());
  const finalContent = sections.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

  if (dryRun) {
    console.log(`\n=== DRY RUN: ${filename} ===\n`);
    console.log(finalContent);
    console.log(`\n[dry-run] 不會寫檔、不會 bump counter`);
    return { filename, ticketId, dryRun: true };
  }

  // 6. 寫檔 + bump counter
  if (fs.existsSync(outPath)) {
    throw new Error(`[${draftPath}] 目標檔案已存在：${outPath}`);
  }
  fs.writeFileSync(outPath, finalContent);
  counter[seriesKey].next = n + 1;
  writeCounter(counter);

  return { filename, ticketId, outPath };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(
      `Usage:\n  node scripts/obsidian-import.mjs <draft.md> [--dry-run]\n  node scripts/obsidian-import.mjs --all <vault-dir> [--dry-run]\n`
    );
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const filtered = args.filter((a) => a !== '--dry-run');

  let targets = [];
  if (filtered[0] === '--all') {
    const dir = filtered[1];
    if (!dir) {
      console.error('--all 需要指定 vault 資料夾');
      process.exit(1);
    }
    targets = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f));
  } else {
    targets = [filtered[0]];
  }

  const results = [];
  for (const t of targets) {
    try {
      const r = importOne(t, { dryRun });
      results.push({ ok: true, draft: t, ...r });
      console.log(`✓ ${t} → ${r.filename || '(dry-run)'}`);
    } catch (err) {
      console.error(`✗ ${t}: ${err.message}`);
      results.push({ ok: false, draft: t, error: err.message });
    }
  }

  const imported = results.filter((r) => r.ok && !r.dryRun);
  if (imported.length === 0) return;

  // 驗證
  console.log('\n--- Running validate-posts ---');
  try {
    execSync('node scripts/validate-posts.mjs', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('\n⚠️  validate-posts 失敗，請檢查 frontmatter。已匯入的檔案仍保留。');
    process.exit(1);
  }

  console.log('\n--- Next steps ---');
  for (const r of imported) {
    console.log(`  • ${r.ticketId}: src/content/posts/${r.filename}`);
  }
  console.log(`\n  git add scripts/article-counter.json src/content/posts/`);
  console.log(
    `  git commit -m "content(${imported[0].ticketId.toLowerCase()}): draft from obsidian"`
  );
  console.log(`  bash scripts/tribunal-batch-runner.sh  # 跑 tribunal`);
  console.log(`  git push`);
}

main();
