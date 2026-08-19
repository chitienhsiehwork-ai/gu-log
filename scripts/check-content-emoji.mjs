#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findEmojiSequences } from './lib/emoji-sequences.mjs';
import { collectReaderSurfaceLineRecords } from './lib/reader-surface.mjs';

export { findEmojiSequences } from './lib/emoji-sequences.mjs';

const DEFAULT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = 'quality/content-emoji-allowlist.json';
const APPROVAL_CORPUS_PATH = 'docs/shroomdog-editorial-feedback.md';

export function sha256Line(line) {
  return createHash('sha256').update(line).digest('hex');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必須是 JSON object`);
  }
}

function isValidDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function parseApprovalDecisions(corpus) {
  if (typeof corpus !== 'string') throw new Error('feedback corpus snapshot 必須是字串');
  const decisions = new Map();
  for (const [index, line] of corpus.split('\n').entries()) {
    if (!line.startsWith('<!-- content-emoji-decision')) continue;
    const match = line.match(/^<!-- content-emoji-decision (\{.*\}) -->$/);
    if (!match) {
      throw new Error(`feedback corpus:${index + 1} 的 content-emoji-decision marker 格式無效`);
    }
    let decision;
    try {
      decision = JSON.parse(match[1]);
    } catch {
      throw new Error(`feedback corpus:${index + 1} 的 emoji decision JSON 無法解析`);
    }
    assertPlainObject(decision, `feedback corpus:${index + 1} emoji decision`);
    if (typeof decision.id !== 'string' || !/^[A-Z0-9][A-Z0-9._-]+$/.test(decision.id)) {
      throw new Error(`feedback corpus:${index + 1} 的 emoji decision id 無效`);
    }
    if (decisions.has(decision.id)) {
      throw new Error(`feedback corpus 的 emoji decision id 重複：${decision.id}`);
    }
    if (decision.decision !== 'approve') {
      throw new Error(`feedback corpus:${index + 1} 的 executable emoji decision 必須是 approve`);
    }
    validatePostPath(decision.path);
    if (typeof decision.emoji !== 'string' || decision.emoji === '') {
      throw new Error(`feedback corpus:${index + 1} 的 emoji decision 缺少 emoji`);
    }
    if (!isValidDate(decision.decidedAt)) {
      throw new Error(`feedback corpus:${index + 1} 的 emoji decision decidedAt 無效`);
    }
    decisions.set(decision.id, Object.freeze(decision));
  }
  return decisions;
}

function validatePostPath(postPath) {
  if (
    typeof postPath !== 'string' ||
    isAbsolute(postPath) ||
    !postPath.startsWith('src/content/posts/') ||
    !postPath.endsWith('.mdx') ||
    normalize(postPath) !== postPath ||
    postPath.split(sep).includes('..')
  ) {
    throw new Error(`allowlist path 無效：${JSON.stringify(postPath)}`);
  }
}

export function parseContentEmojiAllowlist(raw, approvalCorpus) {
  assertPlainObject(raw, 'content emoji allowlist');
  if (raw.version !== 1 || !Array.isArray(raw.entries)) {
    throw new Error('content emoji allowlist 必須使用 version 1 並提供 entries array');
  }
  const approvalDecisions = parseApprovalDecisions(approvalCorpus);
  const entries = raw.entries.map((entry, index) => {
    const label = `allowlist entries[${index}]`;
    assertPlainObject(entry, label);
    validatePostPath(entry.path);
    if (typeof entry.emoji !== 'string' || entry.emoji === '') {
      throw new Error(`${label}.emoji 必須是非空字串`);
    }
    const detected = findEmojiSequences(entry.emoji);
    if (detected.length !== 1 || detected[0].emoji !== entry.emoji) {
      throw new Error(`${label}.emoji 必須是單一完整 emoji sequence`);
    }
    if (typeof entry.lineHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.lineHash)) {
      throw new Error(`${label}.lineHash 必須是 SHA-256 hex`);
    }
    if (!Number.isInteger(entry.maxOccurrences) || entry.maxOccurrences < 1) {
      throw new Error(`${label}.maxOccurrences 必須是正整數`);
    }
    if (!isValidDate(entry.approvedAt)) {
      throw new Error(`${label}.approvedAt 必須是可解析的 YYYY-MM-DD`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`${label}.reason 必須說明明確授權原因`);
    }
    const refMatch =
      typeof entry.approvalRef === 'string'
        ? entry.approvalRef.match(
            /^docs\/shroomdog-editorial-feedback\.md#content-emoji-approval:([A-Z0-9][A-Z0-9._-]+)$/
          )
        : null;
    if (!refMatch) {
      throw new Error(`${label}.approvalRef 必須指向唯一 content-emoji-approval marker`);
    }
    const approval = approvalDecisions.get(refMatch[1]);
    if (!approval) {
      throw new Error(`${label}.approvalRef 無法解析到 feedback corpus emoji decision`);
    }
    if (
      approval.path !== entry.path ||
      approval.emoji !== entry.emoji ||
      approval.decidedAt !== entry.approvedAt
    ) {
      throw new Error(`${label}.approvalRef 的 path/emoji/date 與 executable record 不一致`);
    }
    return Object.freeze({ ...entry });
  });
  return Object.freeze({ version: 1, entries: Object.freeze(entries) });
}

function countEntryOccurrences(entry, content) {
  let count = 0;
  for (const record of collectReaderSurfaceLineRecords(content)) {
    if (sha256Line(record.canonicalText) !== entry.lineHash) continue;
    const matches = record.emojiMatches ?? findEmojiSequences(record.canonicalText);
    count += matches.filter((match) => match.emoji === entry.emoji).length;
  }
  return count;
}

export function checkContentChanges({ changes, allowlist, approvalCorpus, readCurrentPost }) {
  const policy = parseContentEmojiAllowlist(allowlist, approvalCorpus);
  const errors = [];

  for (const [index, entry] of policy.entries.entries()) {
    const content = readCurrentPost(entry.path);
    const count = content === null ? 0 : countEntryOccurrences(entry, content);
    if (count === 0) {
      errors.push(`allowlist entries[${index}] 已 stale：找不到核准的 path/lineHash/emoji`);
    } else if (count > entry.maxOccurrences) {
      errors.push(
        `allowlist entries[${index}] 超出 maxOccurrences：目前 ${count}，核准 ${entry.maxOccurrences}`
      );
    }
  }

  const allowedCounts = new Map();
  const findings = [];
  for (const change of changes) {
    for (const record of collectReaderSurfaceLineRecords(change.content)) {
      const sourceLines = record.sourceLines ?? new Set([record.sourceLine]);
      if (![...sourceLines].some((sourceLine) => change.addedSourceLines.has(sourceLine))) continue;
      if (record.unresolvedExpression !== undefined) {
        const preview = record.unresolvedExpression.replace(/\s+/gu, ' ').slice(0, 80);
        errors.push(
          `${change.path}:${record.sourceLine} 無法靜態解析讀者可見 MDX expression（${record.surfaceKind}${
            preview ? `: ${JSON.stringify(preview)}` : ''
          }）；請改成一般文字或純 static literal tree；identifier、call、spread、interpolation 與 tagged template 無法靜態驗證`
        );
        continue;
      }
      for (const match of record.emojiMatches ?? findEmojiSequences(record.canonicalText)) {
        const lineHash = sha256Line(record.canonicalText);
        const entryIndex = policy.entries.findIndex(
          (entry) =>
            entry.path === change.path && entry.emoji === match.emoji && entry.lineHash === lineHash
        );
        const used = entryIndex < 0 ? 0 : (allowedCounts.get(entryIndex) ?? 0);
        const entry = entryIndex < 0 ? null : policy.entries[entryIndex];
        if (entry && used < entry.maxOccurrences) {
          allowedCounts.set(entryIndex, used + 1);
          continue;
        }
        const finding = {
          path: change.path,
          emoji: match.emoji,
          sourceLine: record.sourceLine,
          surfaceKind: record.surfaceKind,
          lineHash,
        };
        findings.push(finding);
        errors.push(
          `${change.path}:${record.sourceLine} 未授權 emoji ${JSON.stringify(match.emoji)}（${record.surfaceKind}）`
        );
      }
    }
  }

  return { errors, findings };
}

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function parseAddedSourceLines(diff) {
  const lines = new Set();
  let hunkCount = 0;
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunkCount += 1;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  if (diff.trim() !== '' && hunkCount === 0) {
    throw new Error('git diff 含變更但無法解析 hunk；拒絕跳過 emoji gate');
  }
  return lines;
}

function postPathsFromDiff(repoRoot, diffArgs) {
  return git(repoRoot, [
    'diff',
    ...diffArgs,
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
    '--',
    'src/content/posts/*.mdx',
  ])
    .split('\0')
    .filter(Boolean);
}

function snapshotSpec(mode, path) {
  return mode.kind === 'staged' ? `:${path}` : `HEAD:${path}`;
}

function readSnapshotFile(repoRoot, mode, path) {
  return git(repoRoot, ['show', snapshotSpec(mode, path)]);
}

function loadGitChanges(repoRoot, mode) {
  const diffArgs = mode.kind === 'staged' ? ['--cached', 'HEAD'] : [mode.base, 'HEAD'];
  return postPathsFromDiff(repoRoot, diffArgs).map((postPath) => ({
    path: postPath,
    content: readSnapshotFile(repoRoot, mode, postPath),
    addedSourceLines: parseAddedSourceLines(
      git(repoRoot, ['diff', ...diffArgs, '--unified=0', '--no-color', '--', postPath])
    ),
  }));
}

function parseCLI(argv) {
  let mode = null;
  let repoRoot = DEFAULT_REPO_ROOT;
  for (const arg of argv) {
    if (arg === '--staged') {
      if (mode) throw new Error('--staged 與 --base 只能擇一');
      mode = { kind: 'staged' };
    } else if (arg.startsWith('--base=')) {
      if (mode) throw new Error('--staged 與 --base 只能擇一');
      mode = { kind: 'base', base: arg.slice('--base='.length) };
    } else if (arg.startsWith('--repo-root=')) repoRoot = arg.slice('--repo-root='.length);
    else throw new Error(`未知參數：${arg}`);
  }
  if (!mode) throw new Error('必須指定 --staged 或 --base=<commit>');
  repoRoot = normalize(repoRoot);
  if (mode.kind === 'base') {
    if (!mode.base) throw new Error('--base 不得為空');
    git(repoRoot, ['cat-file', '-e', `${mode.base}^{commit}`]);
  }
  return { mode, repoRoot };
}

function runCLI() {
  try {
    const { mode, repoRoot } = parseCLI(process.argv.slice(2));
    const allowlist = JSON.parse(readSnapshotFile(repoRoot, mode, ALLOWLIST_PATH));
    const approvalCorpus = readSnapshotFile(repoRoot, mode, APPROVAL_CORPUS_PATH);
    const changes = loadGitChanges(repoRoot, mode);
    const readCurrentPost = (postPath) => {
      try {
        return readSnapshotFile(repoRoot, mode, postPath);
      } catch {
        return null;
      }
    };
    const result = checkContentChanges({ changes, allowlist, approvalCorpus, readCurrentPost });
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`❌ ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ content emoji policy: ${changes.length} changed post(s) checked`);
  } catch (error) {
    console.error(
      `❌ content emoji policy 無法完成：${error instanceof Error ? error.message : error}`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCLI();
