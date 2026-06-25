#!/usr/bin/env node

// check-ai-tells.mjs — deterministic gate against AI-translationese tells in
// zh-tw post bodies. Sibling of check-pronoun-clarity.mjs / check-jingjing.mjs:
// same mask zones (frontmatter / code fence / MoguNote / ClawdNote /
// ShroomDogNote / blockquote / import / link-only bullet / indented code), same
// staged-only pre-commit wiring, same exit-1-on-violation contract.
//
// WHY a lint and not a writer-prompt rule: a banlist baked into
// GU-LOG_WRITER_PROMPT.md is paid in tokens on every generation and tends to
// make the model write stiffly around the forbidden words. A lint costs
// nothing until a tell actually ships, and the failure message itself is the
// teaching moment (event-driven progressive disclosure): it names the tell,
// shows the line, and hands over natural replacements. The fixer — human in
// CCC, refine loop in the pipeline — reads THIS message, not a prompt.
//
// SSOT: BLOCKLIST below is the single home of the banned-phrase set. Do not
// copy it into the writer prompt or playbooks — point at this file instead.
//
// Discipline: keep the list narrow and high-precision. A gate that throws
// false positives gets bypassed with --no-verify, which kills it. Add a phrase
// only when you're sure it's an AI tell with no common literal use; widen via
// evidence, not vibes. For a genuinely literal use, mark the line with an
// inline `{/* ai-ok */}` escape rather than disabling the gate.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const console = globalThis.console;

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const files = process.argv.slice(2).filter(Boolean);

// ── Blocklist (SSOT) ───────────────────────────────────────────────
// Each entry: the banned phrase + natural zh-tw替代 shown in the error.
// `pattern` is matched literally (escaped before use). Scope is the SP-232
// decision: ONLY discrete, low-collision explicit-wordlist tells. Density
// tells (T1 反義對偶 / T2 假深度 reframe / T4 mic-drop) are deliberately NOT
// here — regex would 誤殺 earned usage; they live in the tribunal AI-Tell Trap
// rubric (scripts/vibe-scoring-standard.md). Provenance for each entry is the
// dated corpus (docs/shroomdog-editorial-feedback.md). Start tiny; widen on
// evidence, not vibes.
const BLOCKLIST = [
  {
    // 2026-06-25: 拆過 全站退役（house idiom turned tell）。字面拆解（拆過機器/外掛）
    // 用 {/* ai-ok */} 放行。
    pattern: '拆過',
    suggest: '講過 / 寫過 / 聊過',
    why: '「X 拆過 [主題]」這種剪掉受詞的講法已退役；字面拆解請用 {/* ai-ok */} 放行',
  },
  {
    // 2026-06-17 SP-232 T3 空洞強化詞
    pattern: '拆得很乾淨',
    suggest: '直接講它到底講了什麼',
    why: 'T3 空洞強化詞：沒有具體資訊，只負責讓句子收得漂亮',
  },
  {
    pattern: '拆得很漂亮',
    suggest: '直接講它到底講了什麼',
    why: 'T3 空洞強化詞：沒有具體資訊，只負責讓句子收得漂亮',
  },
  {
    pattern: '這才是工程品味',
    suggest: '講具體哪裡好',
    why: 'T3 空洞強化詞：替句子強行加重量，不交付內容',
  },
  {
    pattern: '這刀切得漂亮',
    suggest: '直接講做了什麼',
    why: 'T3 空洞強化詞：flourish，沒有具體資訊',
  },
  {
    // 2026-06-18 SP-235 論文腔
    pattern: '學術根源是',
    suggest: '「有個學名叫」「研究圈管這叫」+ 連原始論文',
    why: '論文教科書腔；casual 給名字並連 arXiv 原文即可',
  },
  {
    // 2026-05-08 SD-22 AI-ish summary ending
    pattern: '一句話記住',
    suggest: '直接收尾，讓比喻自己落地',
    why: '像 AI 筆記／考前重點整理，破壞故事感結尾',
  },
];

// Lines carrying this marker opt out of the scan (genuine literal use).
// Use the MDX comment form {/* ai-ok */} so it renders nothing inline.
const ESCAPE_MARKER = 'ai-ok';

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isEnglishPost(filePath) {
  return path.basename(filePath).startsWith('en-');
}

function markFrontmatter(lines, masked) {
  if (lines[0] !== '---') return 0;

  masked[0] = true;
  for (let i = 1; i < lines.length; i += 1) {
    masked[i] = true;
    if (lines[i] === '---') {
      return i + 1;
    }
  }

  return lines.length;
}

// Identical mask semantics to check-pronoun-clarity.mjs: skip everything that
// is not authorial zh-tw prose so commentary voice, quotes and code are exempt.
function buildMask(lines) {
  const masked = new Array(lines.length).fill(false);
  let startIndex = markFrontmatter(lines, masked);
  let inFence = false;
  let fenceMarker = '';
  // gu-log persona note components — body is the persona speaking, so a tell
  // inside belongs to commentary voice and must be masked. MoguNote is the
  // canonical name; ClawdNote is the legacy alias still in older posts — both
  // must mask, or switching a post to MoguNote silently reintroduces flags.
  const NOTE_COMPONENTS = ['MoguNote', 'ClawdNote', 'ShroomDogNote'];
  let noteCloseTag = '';

  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];

    if (inFence) {
      masked[i] = true;
      if (new RegExp(`^\\s*${escapeRegex(fenceMarker)}`).test(line)) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }

    if (noteCloseTag) {
      masked[i] = true;
      if (line.includes(noteCloseTag)) {
        noteCloseTag = '';
      }
      continue;
    }

    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      masked[i] = true;
      fenceMarker = fenceMatch[1];
      if (
        !new RegExp(`^\\s*${escapeRegex(fenceMarker)}.*${escapeRegex(fenceMarker)}\\s*$`).test(line)
      ) {
        inFence = true;
      }
      continue;
    }

    const openedNote = NOTE_COMPONENTS.find((name) => line.includes(`<${name}`));
    if (openedNote) {
      masked[i] = true;
      if (!line.includes(`</${openedNote}>`)) {
        noteCloseTag = `</${openedNote}>`;
      }
      continue;
    }

    if (/^\s*>/.test(line)) {
      masked[i] = true;
      continue;
    }

    if (/^\s*import\b/.test(line)) {
      masked[i] = true;
      continue;
    }

    // Cross-link list items quote OTHER posts' titles; a tell there belongs to
    // the linked post, not this author. Mask bullet lines that are a single
    // markdown link. Inline links in flowing prose are still scanned.
    if (/^\s*[-*+]\s*\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      masked[i] = true;
      continue;
    }

    if (/^(?: {4,}|\t)/.test(line)) {
      masked[i] = true;
      continue;
    }

    // Explicit per-line opt-out for genuine literal use.
    if (line.includes(ESCAPE_MARKER)) {
      masked[i] = true;
    }
  }

  return masked;
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
}

function truncate(line, max = 140) {
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function formatContext(lines, index) {
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length - 1, index + 1);
  const width = String(end + 1).length;
  const output = [];

  for (let i = start; i <= end; i += 1) {
    const marker = i === index ? '>' : ' ';
    output.push(`   ${marker} ${String(i + 1).padStart(width)} | ${truncate(lines[i])}`);
  }

  return output.join('\n');
}

function findViolations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const masked = buildMask(lines);
  const violations = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (masked[i]) continue;

    const searchable = stripInlineCode(lines[i]);
    for (const entry of BLOCKLIST) {
      if (searchable.includes(entry.pattern)) {
        violations.push({
          line: i + 1,
          pattern: entry.pattern,
          suggest: entry.suggest,
          why: entry.why,
          context: formatContext(lines, i),
        });
      }
    }
  }

  return violations;
}

export { buildMask, findViolations, stripInlineCode, isEnglishPost, BLOCKLIST };

if (!__isCli) {
  // imported as module; skip CLI body
} else {
  if (files.length === 0) {
    console.log('ℹ️  No files provided for AI-tells check');
    process.exit(0);
  }

  let filesWithViolations = 0;
  let totalViolations = 0;

  for (const file of files) {
    const abs = path.resolve(file);

    if (!fs.existsSync(abs) || path.extname(abs) !== '.mdx' || isEnglishPost(abs)) {
      continue;
    }

    const violations = findViolations(abs);
    if (violations.length === 0) continue;

    filesWithViolations += 1;
    totalViolations += violations.length;

    console.log(`❌ ${path.relative(process.cwd(), abs)}`);
    for (const violation of violations) {
      console.log(
        `   line ${violation.line} — AI 腔「${violation.pattern}」→ 改用 ${violation.suggest}`
      );
      console.log(`      （${violation.why}）`);
      console.log(violation.context);
      console.log('');
    }
  }

  if (totalViolations > 0) {
    console.log(
      `❌ AI-tells check failed: ${totalViolations} violation(s) across ${filesWithViolations} file(s)`
    );
    console.log('   修法：換成自然講法（見上方建議），或對真正字面用法在該行加 {/* ai-ok */}。');
    console.log(
      '   要新增禁用詞：編 BLOCKLIST in scripts/check-ai-tells.mjs（窄而準，別一次塞一堆）。'
    );
    process.exit(1);
  }

  process.exit(0);
} // end CLI guard
