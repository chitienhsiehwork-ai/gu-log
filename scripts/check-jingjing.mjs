#!/usr/bin/env node
// scripts/check-jingjing.mjs
//
// Lint zh-tw posts for 晶晶體 (decorative English mixing).
//
// Policy (see GU-LOG_WRITER_PROMPT.md §術語處理): zh-tw posts must use natural
// LHY-style Chinese. The ONLY English allowed in body/MoguNote is:
//   1. Terms in src/data/glossary.json
//   2. Proper nouns: products, companies, labs, people, places, benchmarks,
//      model variants (hardcoded ALLOWLIST below)
//   3. Code identifiers (fenced or inline `code`)
//   4. Direct quoted English inside 「」 or "" (often source-language quotes)
//   5. Universally understood acronyms (API, SDK, CLI, PM, CEO, ML, LLM, etc.)
//
// Anything else is 晶晶體 → flag. Fix by translating to natural zh-tw, OR
// add the term to src/data/glossary.json in the same PR only if it passes
// GU-LOG_WRITER_PROMPT.md's glossary creation standard: canonical term,
// likely reused, loses meaning when translated, and useful as a stable
// gu-log mental-model anchor. A lint failure alone is never enough.
//
// Boundary ownership: adding or removing accepted English terms SHALL be
// discussed with ShroomDog first. This list encodes ShroomDog's reading-flow
// comfort, not just technical correctness; reviewers and agents must not
// silently expand or shrink it.
//
// Usage:
//   node scripts/check-jingjing.mjs <file.mdx>...
//   node scripts/check-jingjing.mjs --baseline-ref=origin/main <file.mdx>...
//   node scripts/check-jingjing.mjs                  # scans all zh-tw posts
//
// Exit codes:
//   0 — no violations (or no zh-tw files staged)
//   1 — violations found; see stderr
//   2 — a file could not be read or scanned

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const REPO_ROOT = process.cwd();
const POSTS_DIR = path.join(REPO_ROOT, 'src/content/posts');
const GLOSSARY_PATH = path.join(REPO_ROOT, 'src/data/glossary.json');
// Read the accepted-English policy inputs once, so every file in a scan is
// judged against the same glossary.
const GLOSSARY_SNAPSHOT = fs.readFileSync(GLOSSARY_PATH);
const DEFAULT_GIT_FETCH_TIMEOUT_MS = 10_000;
const MAX_GIT_FETCH_TIMEOUT_MS = 120_000;

function gitFetchTimeoutMs() {
  const raw = process.env.CHECK_JINGJING_FETCH_TIMEOUT_MS;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return DEFAULT_GIT_FETCH_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= MAX_GIT_FETCH_TIMEOUT_MS
    ? parsed
    : DEFAULT_GIT_FETCH_TIMEOUT_MS;
}

// ── Hardcoded allowlist ────────────────────────────────────────────
//
// These are English words/phrases that are universally OK in zh-tw posts
// without needing a glossary entry. Keep this list tight — when in doubt,
// add the term to glossary.json so it gets a definition + moguNote.
// Add/remove entries only after discussing the boundary with ShroomDog.

// The list itself lives in scripts/data/jingjing-allowlist.txt (one data file,
// '#' starts a full-line comment) so this script stays small enough to read.
const ALLOWLIST_PATH = fileURLToPath(new URL('./data/jingjing-allowlist.txt', import.meta.url));
const ALLOWLIST_RAW = fs.readFileSync(ALLOWLIST_PATH, 'utf8');

const HARDCODED = new Set();
for (const line of ALLOWLIST_RAW.split('\n')) {
  const trimmedLine = line.trim();
  // Skip full-line comments before tokenizing — a line-level check is
  // required because splitting the whole blob on whitespace first would
  // scatter each comment line's prose words into the token stream, with
  // only the leading '#' itself filtered out (the original bug: comment
  // text silently became "accepted English").
  if (!trimmedLine || trimmedLine.startsWith('#')) continue;
  for (const tok of trimmedLine.split(/\s+/)) {
    if (!tok) continue;
    HARDCODED.add(tok);
  }
}

// ── Glossary terms ─────────────────────────────────────────────────

const GLOSSARY_TERMS = new Set();
try {
  const glossary = JSON.parse(GLOSSARY_SNAPSHOT.toString('utf8'));
  for (const t of glossary) {
    if (t.term) {
      GLOSSARY_TERMS.add(t.term);
      // Also add individual words from multi-word terms
      for (const w of t.term.split(/\s+/)) GLOSSARY_TERMS.add(w);
    }
    if (t.en && t.en !== t.term) {
      GLOSSARY_TERMS.add(t.en);
      for (const w of t.en.split(/\s+/)) GLOSSARY_TERMS.add(w);
    }
    if (Array.isArray(t.aliases)) {
      for (const a of t.aliases) GLOSSARY_TERMS.add(a);
    }
  }
} catch (e) {
  console.error(`[check-jingjing] Failed to load glossary at ${GLOSSARY_PATH}: ${e.message}`);
  process.exit(2);
}

// ── Helpers ────────────────────────────────────────────────────────

function isAllowed(word) {
  // Strip trailing punctuation
  const w = word.replace(/[.,;:!?'"]+$/, '');

  // Empty after strip
  if (!w) return true;

  // Pure number or contains period (likely number/version) — allow
  if (/^[\d.]+$/.test(w)) return true;

  // Single character
  if (w.length === 1) return true;

  // All-uppercase short acronym (≤ 6 chars)
  if (w.length <= 6 && /^[A-Z][A-Z0-9-]*$/.test(w)) return true;

  // Mixed-case identifier with numbers/hyphens (versions like GPT-5.4, B-IT, K2.5)
  if (/[0-9]/.test(w) && /[A-Za-z]/.test(w)) return true;

  // Hardcoded allowlist
  if (HARDCODED.has(w)) return true;

  // Glossary
  if (GLOSSARY_TERMS.has(w)) return true;

  // case-insensitive glossary fallback (allow "token" if "Token" is in glossary)
  const lower = w.toLowerCase();
  for (const term of GLOSSARY_TERMS) {
    if (term.toLowerCase() === lower) return true;
  }
  for (const term of HARDCODED) {
    if (term.toLowerCase() === lower) return true;
  }

  return false;
}

function maskContent(text) {
  // Returns text with masked regions replaced by spaces (preserving line numbers)
  // Mask: frontmatter, code blocks, blockquotes, inline code, direct English quotes inside 「」 or ""
  // Keep: body prose, MoguNote inner prose, ShroomDogNote inner prose

  // 1. Mask frontmatter (--- ... ---)
  const fmMatch = text.match(/^---\n[\s\S]*?\n---\n/);
  if (fmMatch) {
    text = ' '.repeat(fmMatch[0].length).replace(/[^\n]/g, ' ') + text.slice(fmMatch[0].length);
    // Preserve newlines
    let masked = '';
    for (let i = 0; i < fmMatch[0].length; i++) {
      masked += fmMatch[0][i] === '\n' ? '\n' : ' ';
    }
    text = masked + text.slice(fmMatch[0].length);
  }

  // 2. Mask code blocks ``` ... ```
  text = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
  text = text.replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, ' '));

  // 2b. Mask JSX template-literal props (e.g. <Mermaid chart={`...`} />).
  // The diagram/code source passed as a prop is not reader prose. The generic
  // tag mask in step 5 only reaches the first '>', which here sits INSIDE the
  // chart (`<br/>`, `-->`), so the diagram body would otherwise leak through
  // and get scanned (fill/stroke/color/node labels → false positives).
  text = text.replace(/=\{`[\s\S]*?`\}/g, (m) => m.replace(/[^\n]/g, ' '));

  // 3. Mask inline code `...`
  text = text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

  // 4. Mask blockquote lines (lines starting with >)
  text = text.replace(/^> .*$/gm, (m) => ' '.repeat(m.length));

  // 5. Mask import lines and HTML/MDX tags themselves (but NOT their inner text)
  text = text.replace(/^import .*$/gm, (m) => ' '.repeat(m.length));
  // Mask HTML/MDX opening/closing tags (e.g. <MoguNote>, </MoguNote>) but leave inner content
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, (m) => ' '.repeat(m.length));

  // 5b. Mask cross-link list items (the auto-generated 延伸閱讀 / Related list).
  // A bullet whose entire content is a single markdown link quotes ANOTHER
  // post's title in the anchor text (e.g. MP-85「AI Vampire…」). English there
  // belongs to that post — and is governed by that post's own jingjing run —
  // not to this post's prose, so mask the whole line. Inline links inside
  // flowing prose are left alone by this rule and still get scanned (step 6).
  text = text.replace(/^\s*[-*+]\s*\[[^\]\n]*\]\([^)\n]*\)\s*$/gm, (m) => ' '.repeat(m.length));

  // 6. Mask markdown link URL part [text](url) — keep text, drop URL
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, txt) => {
    // Keep text portion in original visual position; rest of link as space
    const orig = _m;
    return txt + ' '.repeat(orig.length - txt.length);
  });

  // 7. Mask direct quoted English inside 「...」 or "..."
  // Heuristic: if quote contains predominantly Latin letters and spaces, mask it
  text = text.replace(/「[^」\n]*」/g, (m) => {
    const inner = m.slice(1, -1);
    const latinRatio = (inner.match(/[A-Za-z]/g) || []).length / Math.max(inner.length, 1);
    return latinRatio > 0.5 ? ' '.repeat(m.length) : m;
  });
  text = text.replace(/"[^"\n]*"/g, (m) => {
    const inner = m.slice(1, -1);
    const latinRatio = (inner.match(/[A-Za-z]/g) || []).length / Math.max(inner.length, 1);
    return latinRatio > 0.5 ? ' '.repeat(m.length) : m;
  });

  return text;
}

function checkText(raw, filePath = '') {
  const violations = [];

  // Skip en- posts entirely
  const base = path.basename(filePath);
  if (base.startsWith('en-')) return { violations: [], skipped: true };

  // Verify lang: zh-tw in frontmatter
  const langMatch = raw.match(/^lang:\s*["']?(zh-tw|en)["']?/m);
  if (langMatch && langMatch[1] === 'en') return { violations: [], skipped: true };

  const masked = maskContent(raw);
  const lines = raw.split('\n');
  const maskedLines = masked.split('\n');

  // Find English word sequences in masked content
  for (let i = 0; i < maskedLines.length; i++) {
    const mLine = maskedLines[i];
    // Match English words: latin letters with optional digits/hyphens/dots/apostrophes
    const matches = [...mLine.matchAll(/[A-Za-z][A-Za-z0-9'-]*\.?[A-Za-z0-9]*/g)];
    for (const m of matches) {
      const word = m[0];
      if (!isAllowed(word)) {
        const comparisonContext = occurrenceComparisonContext(lines[i], m.index ?? 0, word.length);
        violations.push({
          line: i + 1,
          word,
          context: comparisonContext.slice(0, 140),
          comparisonContext,
        });
      }
    }
  }

  return { violations };
}

// Scope baseline identity to the sentence containing this occurrence. This is
// wide enough to detect a decorative English word moved into different prose,
// but it does not make an unrelated sentence edit on the same MDX source line
// invalidate every historical occurrence in that paragraph.
function occurrenceComparisonContext(line, index, length) {
  const boundaries = new Set(['。', '！', '？', '!', '?', '；', ';']);
  let start = 0;
  for (let cursor = Math.min(index - 1, line.length - 1); cursor >= 0; cursor -= 1) {
    if (boundaries.has(line[cursor])) {
      start = cursor + 1;
      break;
    }
  }

  let end = line.length;
  for (let cursor = Math.max(index + length, 0); cursor < line.length; cursor += 1) {
    if (boundaries.has(line[cursor])) {
      end = cursor + 1;
      break;
    }
  }
  return line.slice(start, end).replace(/\s+/g, ' ').trim();
}

function checkFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { violations: [], error: e.message };
  }
  return checkText(raw, filePath);
}

function violationKey(v) {
  return `${v.word.toLowerCase()}\0${violationContext(v)}`;
}

function violationContext(v) {
  return (v.comparisonContext ?? v.context).replace(/\s+/g, ' ').trim();
}

function readBaselineFile(repoRelative, baselineRef) {
  return execFileSync('git', ['show', `${baselineRef}:${repoRelative}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const baselineRefreshAttempts = new Set();

function isShallowRepository() {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

function ensureRemoteBaselineRef(baselineRef) {
  const match = baselineRef.match(/^origin\/(.+)$/);
  if (!match) return;
  if (baselineRefreshAttempts.has(baselineRef)) return;
  baselineRefreshAttempts.add(baselineRef);
  const branch = match[1];
  // 完整 clone 上加 --depth=1 會把 repo 變 shallow，害 build-version-manifest 退回舊值、
  // merge main 變成 unrelated histories；只有本來就 shallow（CI / Vercel）才限深度。
  const fetchArgs = ['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`];
  if (isShallowRepository()) fetchArgs.push('--depth=1');
  execFileSync('git', fetchArgs, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: gitFetchTimeoutMs(),
    killSignal: 'SIGKILL',
  });
}

let baselineRenameMap = null;

function getBaselineRenameMap(baselineRef) {
  if (baselineRenameMap) return baselineRenameMap;
  baselineRenameMap = new Map();
  try {
    const output = execFileSync(
      'git',
      [
        '-c',
        'diff.renameLimit=0',
        'diff',
        '-M',
        '--name-status',
        '-z',
        '--diff-filter=R',
        '--end-of-options',
        baselineRef,
        '--',
        'src/content/posts/*.mdx',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const fields = output.split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const status = fields[index];
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (status?.startsWith('R') && oldPath && newPath) {
        baselineRenameMap.set(newPath, oldPath);
      }
    }
  } catch {
    // No rename information available; fall back to same-path lookup only.
  }
  return baselineRenameMap;
}

function baselineFromRaw(raw, filePath) {
  const { violations } = checkText(raw, filePath);
  return { violations };
}

function baselineRefExists(baselineRef) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', baselineRef], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function getBaselineViolations(filePath, baselineRef) {
  if (!baselineRef) return { baseline: null, refUnavailable: false };

  const repoRelative = path.relative(REPO_ROOT, path.resolve(filePath));
  const candidates = [repoRelative];
  // Renamed files keep their grandfathered baseline: resolve the pre-rename
  // path so a pure rename does not resurface pre-existing violations.
  const renamedFrom = getBaselineRenameMap(baselineRef).get(repoRelative);
  if (renamedFrom) candidates.push(renamedFrom);

  for (const fetchFirst of [false, true]) {
    for (const candidate of candidates) {
      try {
        if (fetchFirst) ensureRemoteBaselineRef(baselineRef);
        return {
          baseline: baselineFromRaw(readBaselineFile(candidate, baselineRef), filePath),
          refUnavailable: false,
        };
      } catch {
        // Try the next candidate / fetch round.
      }
    }
  }
  // Either the file is new at baselineRef (correct: all its violations are
  // new) or baselineRef itself couldn't be resolved (e.g. no network to fetch
  // origin, or the ref genuinely doesn't exist) — in the latter case
  // grandfathered violations can't be suppressed and every historical
  // violation in the file will look "new". Warn so that flood doesn't get
  // mistaken for a real regression.
  const refUnavailable = !baselineRefExists(baselineRef);
  if (refUnavailable) {
    console.error(
      `[check-jingjing] Warning: baseline ref "${baselineRef}" could not be resolved ` +
        `(no network to fetch, or the ref doesn't exist) — historical/grandfathered ` +
        `violations in ${path.relative(REPO_ROOT, filePath)} cannot be suppressed and ` +
        `may appear as "new". Run 'git fetch origin' and retry before assuming a regression.`
    );
  }
  // A new file has no grandfathered violations. An unavailable ref falls back
  // to reporting every violation, which the CLI must describe explicitly.
  return { baseline: null, refUnavailable };
}

function filterBaselineViolations(violations, baseline) {
  if (!baseline) return violations;

  // Each current occurrence must match one concrete baseline occurrence, so a
  // same-count word moved to an unrelated sentence is always new.
  const remainingBaseline = [...baseline.violations];
  return violations.filter((violation) => {
    const matchIndex = remainingBaseline.findIndex(
      (candidate) => violationKey(candidate) === violationKey(violation)
    );
    if (matchIndex < 0) return true;
    remainingBaseline.splice(matchIndex, 1);
    return false;
  });
}

// ── Exports for tests ──────────────────────────────────────────────
export { isAllowed, maskContent, checkText, checkFile, filterBaselineViolations, violationKey };

// ── Main ───────────────────────────────────────────────────────────

if (!__isCli) {
  // Stop here when imported as a module (e.g. from tests).
  // The remaining file is the CLI entry point.
} else {
  const args = process.argv.slice(2).filter(Boolean);
  const baselineArg = args.find((arg) => arg.startsWith('--baseline-ref='));
  const explicitBaselineRef = baselineArg?.slice('--baseline-ref='.length) || '';
  const ciBaselineRef =
    process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : '';
  const baselineRef = explicitBaselineRef || ciBaselineRef;
  let files = args.filter((arg) => !arg.startsWith('--baseline-ref='));

  if (files.length === 0) {
    // Scan all zh-tw posts
    if (!fs.existsSync(POSTS_DIR)) {
      console.error(`[check-jingjing] No posts dir at ${POSTS_DIR}`);
      process.exit(0);
    }
    files = fs
      .readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.mdx') && !f.startsWith('en-'))
      .map((f) => path.join(POSTS_DIR, f));
  }

  let totalViolations = 0;
  const filesWithViolations = [];
  let baselineRefUnavailable = false;

  for (const filePath of files) {
    const { violations, error, skipped } = checkFile(filePath);
    if (error) {
      console.error(`[check-jingjing] ${filePath}: ${error}`);
      process.exit(2);
    }
    if (skipped) continue;
    const { baseline, refUnavailable } = getBaselineViolations(filePath, baselineRef);
    baselineRefUnavailable ||= refUnavailable;
    const newViolations = filterBaselineViolations(violations, baseline);
    if (newViolations.length === 0) continue;

    filesWithViolations.push({ filePath, violations: newViolations });
    totalViolations += newViolations.length;
  }

  if (totalViolations === 0) {
    console.log(
      `✓ check-jingjing: ${files.length} file(s) clean${
        baselineRefUnavailable
          ? ` (baseline ref ${baselineRef} unavailable; checked without grandfathering)`
          : baselineRef
            ? ` vs ${baselineRef}`
            : ''
      }`
    );
    process.exit(0);
  }

  // Report
  console.error(
    `\n❌ 晶晶體 violations in ${filesWithViolations.length} file(s) (${totalViolations} total):\n`
  );
  for (const { filePath, violations } of filesWithViolations) {
    console.error(`📄 ${path.relative(REPO_ROOT, filePath)}`);
    // Group by line
    const byLine = new Map();
    for (const v of violations) {
      if (!byLine.has(v.line)) byLine.set(v.line, []);
      byLine.get(v.line).push(v);
    }
    for (const [line, vs] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
      const words = [...new Set(vs.map((v) => v.word))];
      console.error(`  L${line}: ${words.join(', ')}`);
      console.error(`    │ ${vs[0].context}`);
    }
    console.error('');
  }

  console.error(
    `Fix options:\n` +
      `  1. Translate to natural zh-tw (preferred — see GU-LOG_WRITER_PROMPT.md §術語處理).\n` +
      `  2. If genuinely a canonical/reusable term, apply GU-LOG_WRITER_PROMPT.md's glossary creation standard, discuss the boundary with ShroomDog, then add to src/data/glossary.json with definition + moguNote.\n` +
      `  3. If proper noun (product/people/lab) misclassified, discuss with ShroomDog before adding to scripts/data/jingjing-allowlist.txt.\n` +
      (baselineRefUnavailable
        ? `\nNote: --baseline-ref=${baselineRef} was unavailable for at least one file, so all detected violations are reported, including historical/grandfathered violations.\n`
        : baselineRef
          ? `\nNote: --baseline-ref=${baselineRef} was used, so only new violations are reported; historical grandfathered violations are ignored.\n`
          : '')
  );
  process.exit(1);
} // end CLI guard
