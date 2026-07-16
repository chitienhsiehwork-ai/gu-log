#!/usr/bin/env node

/**
 * One-shot, idempotent Mogu / GP / MP taxonomy migration.
 *
 * Usage:
 *   node scripts/migrate-brand-taxonomy.mjs --snapshot
 *   node scripts/migrate-brand-taxonomy.mjs --baseline [git-revision]
 *   node scripts/migrate-brand-taxonomy.mjs --inventory
 *   node scripts/migrate-brand-taxonomy.mjs --apply
 *
 * `--snapshot` must run against the pre-migration tree. It records every post
 * rename and an active-tree legacy-token inventory. `--apply` consumes that
 * tracked manifest, rewrites repo-owned references, removes series tags, and
 * renames posts. Re-running `--apply` is intentionally a no-op.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'src/content/posts');
const MANIFEST_PATH = path.join(ROOT, 'quality/brand-taxonomy-post-migration.json');
export const PRE_MIGRATION_INVENTORY_PATH = path.join(
  ROOT,
  'quality/brand-taxonomy-pre-migration-inventory.json'
);
export const RESIDUAL_INVENTORY_PATH = path.join(
  ROOT,
  'quality/brand-taxonomy-residual-inventory.json'
);

const IMMUTABLE_HISTORY_EXCLUDES = [
  'sources/',
  '.score-loop/progress/completed/',
  'scores/archive/',
  'quality/coverage-history.json',
  'openspec/changes/archive/',
];

const GENERATED_INVENTORY_EXCLUDES = [
  // These files contain the migration dictionary itself; scanning them would
  // make the inventory recursively report its own evidence.
  'quality/brand-taxonomy-post-migration.json',
  'quality/brand-taxonomy-pre-migration-inventory.json',
  'quality/brand-taxonomy-residual-inventory.json',
  // Retired one-file prototype; kept excluded so an old untracked copy cannot
  // contaminate either phase-specific artifact.
  'quality/brand-taxonomy-inventory.json',
  'quality/brand-taxonomy-residual-allowlist.json',
];

const INVENTORY_EXCLUDES = [...IMMUTABLE_HISTORY_EXCLUDES, ...GENERATED_INVENTORY_EXCLUDES];

const APPLY_WRITE_DEFERRED = ['.agents/', '.codex/', '.github/'];

const APPLY_EXCLUDES = [
  ...INVENTORY_EXCLUDES,
  ...APPLY_WRITE_DEFERRED,
  // The builder treats proposal/spec artifacts as read-only during apply.
  'openspec/changes/rebrand-mogu-gp-mp-taxonomy/',
  'scripts/migrate-brand-taxonomy.mjs',
  'scripts/check-brand-taxonomy.mjs',
  'tests/brand-taxonomy.test.ts',
];

const LEGACY_POST_NAME = /^(?:en-)?(?:sp-|cp-|shroom-picks-|shroomdog-picks-|clawd-picks-).*\.mdx$/;
const SERIES_TAGS = new Set([
  'clawd-picks',
  'mogu-picks',
  'shroom-picks',
  'shroomdog-picks',
  'gu-log-picks',
]);

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function readTicketId(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^ticketId:\s*["']?([^"'\n]+)["']?/m);
  if (!match) throw new Error(`missing ticketId: ${relative(file)}`);
  return match[1].trim();
}

function canonicalTicketId(ticketId) {
  if (ticketId.startsWith('SP-')) return `GP-${ticketId.slice(3)}`;
  if (ticketId.startsWith('CP-')) return `MP-${ticketId.slice(3)}`;
  throw new Error(`legacy post has unexpected ticketId ${ticketId}`);
}

export function canonicalFilename(filename, ticketId) {
  const isEnglish = filename.startsWith('en-');
  const base = filename.replace(/^en-/, '').replace(/\.mdx$/, '');
  const [prefix, number] = canonicalTicketId(ticketId).split('-');
  const canonicalPrefix = prefix.toLowerCase();
  let tail;

  const numbered = base.match(/^(?:sp|cp)-(?:\d+|pending)-(.+)$/);
  if (numbered) {
    tail = numbered[1];
  } else {
    const legacy = base.match(/^(?:shroom-picks|shroomdog-picks|clawd-picks)-(\d{8})-(.+)$/);
    if (!legacy) throw new Error(`unsupported legacy filename: ${filename}`);
    tail = `${legacy[1]}-${legacy[2].replace(/^(?:sp|cp)\d+-/, '')}`;
  }

  // A single early SP pair placed its YYYYMMDD suffix after the slug. The
  // canonical families always put the date immediately after the ticket.
  const trailingDate = tail.match(/^(.+)-(\d{8})$/);
  if (trailingDate && !/^\d{8}-/.test(tail)) {
    tail = `${trailingDate[2]}-${trailingDate[1]}`;
  }

  tail = tail.replace(/\bSP(\d+)\b/g, 'GP$1').replace(/\bCP(\d+)\b/g, 'MP$1');

  const canonicalNumber = number === 'PENDING' ? 'pending' : number;
  return `${isEnglish ? 'en-' : ''}${canonicalPrefix}-${canonicalNumber}-${tail}.mdx`;
}

function buildManifest() {
  const filenames = fs
    .readdirSync(POSTS_DIR)
    .filter((name) => LEGACY_POST_NAME.test(name))
    .sort();
  if (filenames.length === 0)
    throw new Error('no legacy posts found; run --snapshot before migration');

  const entries = filenames.map((oldFilename) => {
    const oldPath = path.join(POSTS_DIR, oldFilename);
    const oldTicketId = readTicketId(oldPath);
    const newTicketId = canonicalTicketId(oldTicketId);
    const newFilename = canonicalFilename(oldFilename, oldTicketId);
    return {
      lang: oldFilename.startsWith('en-') ? 'en' : 'zh-tw',
      oldTicketId,
      newTicketId,
      oldFilename,
      newFilename,
      oldSlug: oldFilename.replace(/\.mdx$/, ''),
      newSlug: newFilename.replace(/\.mdx$/, ''),
    };
  });

  const targetNames = new Set();
  for (const entry of entries) {
    if (targetNames.has(entry.newFilename))
      throw new Error(`rename collision: ${entry.newFilename}`);
    targetNames.add(entry.newFilename);
    const target = path.join(POSTS_DIR, entry.newFilename);
    if (fs.existsSync(target) && target !== path.join(POSTS_DIR, entry.oldFilename)) {
      throw new Error(`rename target already exists: ${entry.newFilename}`);
    }
  }

  const byTicket = new Map();
  for (const entry of entries) {
    const row = byTicket.get(entry.oldTicketId) ?? [];
    row.push(entry.lang);
    byTicket.set(entry.oldTicketId, row);
  }

  const pairSummary = {
    complete: [...byTicket.values()].filter((langs) => new Set(langs).size === 2).length,
    incomplete: [...byTicket.values()].filter((langs) => new Set(langs).size !== 2).length,
  };

  return {
    schemaVersion: 1,
    mapping: { SP: 'GP', CP: 'MP', Clawd: 'Mogu' },
    counts: { files: entries.length, tickets: byTicket.size, ...pairSummary },
    entries,
  };
}

function listRepoFiles(excludes) {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return [...new Set(output.split('\0').filter(Boolean))]
    .filter((file) => !excludes.some((prefix) => file === prefix || file.startsWith(prefix)))
    .filter((file) => {
      const absolute = path.join(ROOT, file);
      return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
    })
    .sort();
}

function listRepoTextFiles(excludes) {
  return listRepoFiles(excludes).filter(
    (file) => !fs.readFileSync(path.join(ROOT, file)).subarray(0, 8192).includes(0)
  );
}

function listTreeFiles(treeRoot, excludes) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const file = path.relative(treeRoot, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        const directoryPrefix = `${file}/`;
        if (
          excludes.some(
            (prefix) => directoryPrefix === prefix || directoryPrefix.startsWith(prefix)
          )
        ) {
          continue;
        }
        visit(absolute);
      } else if (
        entry.isFile() &&
        !excludes.some((prefix) => file === prefix || file.startsWith(prefix))
      ) {
        files.push(file);
      }
    }
  };
  visit(treeRoot);
  return files.sort();
}

const INVENTORY_PATTERNS = {
  component: /ClawdNote/g,
  scoreKey: /clawdNote/g,
  persona: /\bClawd\b(?!\.rip\b|\s+Bot\b)/g,
  legacyFullPersona: /\bShroomClawd\b/g,
  ticket: /\b(?:SP|CP)-(?:\d+|PENDING)\b/g,
  compactTicketOrSlug: /\b(?:SP|CP)\d+\b|(?:^|[/_.-])(?:sp|cp)\d+(?=[/_.-])/gm,
  postSlug: /(?:^|[/_.-])(?:sp|cp)-(?:\d+|pending)(?=[/_.-])/gm,
  seriesName: /\b(?:ShroomDog Picks|Shroom Picks|Clawd Picks)\b/g,
  seriesPathOrTag: /\b(?:shroomdog-picks|shroom-picks|clawd-picks)\b/g,
  pipeline: /\bsp-pipeline\b/g,
};

const PATH_INVENTORY_PATTERNS = {
  pathComponentOrPersona: /(?:^|\/)(?:ClawdNote|clawd-note|clawd-picks|clawd-icon)(?=[/_.-]|$)/g,
  pathLegacySeriesPrefix: /(?:^|\/)(?:sp|cp)-[^/]+/g,
  pathCompactTicket: /(?:^|[/_.-])(?:sp|cp)\d+(?=[/_.-])/g,
  pathPipeline: /(?:^|\/)sp-pipeline(?=\/|$)/g,
};

export function inventoryPathCounts(file) {
  return Object.fromEntries(
    Object.entries(PATH_INVENTORY_PATTERNS)
      .map(([name, pattern]) => [name, matchCount(file, pattern)])
      .filter(([, count]) => count > 0)
  );
}

const FACTUAL_NAME_PATTERNS = {
  Claude: /\bClaude\b/g,
  'Claude Code': /\bClaude Code\b/g,
  Anthropic: /\bAnthropic\b/g,
  OpenClaw: /\bOpenClaw\b/g,
  'Clawd.rip': /\bClawd\.rip\b/g,
  ClawdBot: /\bClawdBot\b/g,
  Clawdus: /\bClawdus\b/g,
  'Clawd Bot': /\bClawd Bot\b/g,
};

function matchCount(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function personaResidualDescriptor(file, count, token = 'Clawd') {
  const factual = {
    'src/content/posts/sp-64-20260216-openclaw-creator-joins-openai.mdx': {
      token: '大家叫我 Clawd / 舊名字裡有 Clawd',
      reason: 'OpenClaw rename-history fact; the retired persona name is part of the old name.',
    },
    'src/content/posts/gp-64-20260216-openclaw-creator-joins-openai.mdx': {
      token: '舊名字裡有 Clawd',
      reason: 'OpenClaw rename-history fact; the retired persona name is part of the old name.',
    },
    'src/content/posts/en-sp-64-20260216-openclaw-creator-joins-openai.mdx': {
      token: 'Everyone calls me Clawd / old name had Clawd',
      reason: 'OpenClaw rename-history fact; the retired persona name is part of the old name.',
    },
    'src/content/posts/en-gp-64-20260216-openclaw-creator-joins-openai.mdx': {
      token: 'old name had Clawd',
      reason: 'OpenClaw rename-history fact; the retired persona name is part of the old name.',
    },
    'src/content/posts/cp-304-20260529-clawd-rip-claude-timeline.mdx': {
      token: 'Clawd.rip',
      reason: 'Third-party source/site name; changing it would falsify attribution.',
    },
    'src/content/posts/mp-304-20260529-clawd-rip-claude-timeline.mdx': {
      token: 'Clawd.rip',
      reason: 'Third-party source/site name; changing it would falsify attribution.',
    },
    'src/content/posts/en-cp-304-20260529-clawd-rip-claude-timeline.mdx': {
      token: 'Clawd.rip',
      reason: 'Third-party source/site name; changing it would falsify attribution.',
    },
    'src/content/posts/en-mp-304-20260529-clawd-rip-claude-timeline.mdx': {
      token: 'Clawd.rip',
      reason: 'Third-party source/site name; changing it would falsify attribution.',
    },
    'src/data/post-authorship-notes.json': {
      token: 'Clawd Bot',
      reason: 'Factual git author attribution recorded under that historical identity.',
    },
  }[file];
  if (factual) return { path: file, count, disposition: 'factual-exception', ...factual };

  if (APPLY_WRITE_DEFERRED.some((prefix) => file.startsWith(prefix))) {
    return {
      path: file,
      token,
      count,
      disposition: 'must-migrate',
      reason:
        'Write deferred by this codemod; this exact file remains blocking work, not an allowlist.',
    };
  }
  if (file.startsWith('openspec/changes/rebrand-mogu-gp-mp-taxonomy/')) {
    return {
      path: file,
      token,
      count,
      disposition: 'archive-evidence',
      reason:
        'The active change describes the retired contract and will move under immutable archive before merge.',
    };
  }
  if (file === 'scripts/migrate-brand-taxonomy.mjs' || file === 'tests/brand-taxonomy.test.ts') {
    return {
      path: file,
      token,
      count,
      disposition: 'migration-fixture',
      reason: 'The migration dictionary/fixture must name the input it detects and rewrites.',
    };
  }
  return {
    path: file,
    token,
    count,
    disposition: 'unclassified-blocker',
    reason: 'No factual or migration reason is registered; this exact residual blocks completion.',
  };
}

function buildInventory({
  files = listRepoFiles(INVENTORY_EXCLUDES),
  readText = (file) => {
    const buffer = fs.readFileSync(path.join(ROOT, file));
    return buffer.subarray(0, 8192).includes(0) ? null : buffer.toString('utf8');
  },
  provenance,
} = {}) {
  const contract = {};
  const deploymentCoordinates = {};
  const factualNames = {};

  for (const file of files) {
    const text = readText(file);
    const counts =
      text === null
        ? {}
        : Object.fromEntries(
            Object.entries(INVENTORY_PATTERNS)
              .map(([name, pattern]) => [name, matchCount(text, pattern)])
              .filter(([, count]) => count > 0)
          );
    // This file is provenance, not current persona prose. Its exact historical
    // names are classified below instead of becoming migration blockers.
    if (file === 'src/data/post-authorship-notes.json') {
      delete counts.legacyFullPersona;
    }
    Object.assign(counts, inventoryPathCounts(file));
    if (Object.keys(counts).length) contract[file] = counts;

    const deploymentCount =
      text === null
        ? 0
        : matchCount(text, /\bclawd-vm\b|\/home\/clawd\b|~\/clawd\b|\$HOME\/clawd\b/g);
    if (deploymentCount) deploymentCoordinates[file] = deploymentCount;

    const factualCounts =
      text === null
        ? {}
        : Object.fromEntries(
            Object.entries(FACTUAL_NAME_PATTERNS)
              .map(([name, pattern]) => [name, matchCount(text, pattern)])
              .filter(([, count]) => count > 0)
          );
    if (text !== null && file === 'src/data/post-authorship-notes.json') {
      const historicalFullNameCount = matchCount(text, /\bShroomClawd\b/g);
      if (historicalFullNameCount) factualCounts.ShroomClawd = historicalFullNameCount;
    }
    if (Object.keys(factualCounts).length) factualNames[file] = factualCounts;
  }

  const consumerGroups = {};
  for (const file of Object.keys(contract)) {
    const group = file.startsWith('src/content/posts/')
      ? 'posts'
      : file.startsWith('.agents/') || file.startsWith('.codex/')
        ? 'agent-config'
        : file.startsWith('.github/')
          ? 'github-automation'
          : file.startsWith('tools/')
            ? 'pipeline'
            : file.startsWith('src/pages/') ||
                file.startsWith('src/components/') ||
                file.startsWith('src/utils/')
              ? 'site-runtime'
              : file.startsWith('tests/') || file.includes('/tests/')
                ? 'tests-fixtures'
                : file.startsWith('scripts/')
                  ? 'scripts-automation'
                  : file.startsWith('public/')
                    ? 'public-assets-artifacts'
                    : file.startsWith('openspec/specs/')
                      ? 'living-specs'
                      : 'active-docs-config';
    (consumerGroups[group] ??= []).push(file);
  }

  const personaResiduals = Object.entries(contract)
    .filter(([, counts]) => counts.persona || counts.legacyFullPersona)
    .map(([file, counts]) => {
      const token =
        counts.persona && counts.legacyFullPersona
          ? 'Clawd / ShroomClawd'
          : counts.legacyFullPersona
            ? 'ShroomClawd'
            : 'Clawd';
      return personaResidualDescriptor(
        file,
        (counts.persona ?? 0) + (counts.legacyFullPersona ?? 0),
        token
      );
    });

  return {
    schemaVersion: 1,
    provenance,
    scope: {
      activeTree: true,
      immutableHistoryExcluded: IMMUTABLE_HISTORY_EXCLUDES.map((prefix) =>
        prefix.endsWith('/') ? `${prefix}**` : prefix
      ),
      generatedArtifactsExcluded: GENERATED_INVENTORY_EXCLUDES,
    },
    contract,
    consumerGroups,
    preservedFactualNames: factualNames,
    deploymentCoordinates,
    personaResiduals,
    migrationWriteDeferred: {
      reason:
        'These exact active files were inventoried but not written by this codemod; each remains blocking work unless separately justified.',
      scopes: APPLY_WRITE_DEFERRED.map((prefix) => `${prefix}**`),
      residual: Object.fromEntries(
        Object.entries(contract).filter(([file]) =>
          APPLY_WRITE_DEFERRED.some((prefix) => file.startsWith(prefix))
        )
      ),
    },
  };
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function buildWorkingTreeInventory(phase) {
  return buildInventory({
    provenance: {
      phase,
      source: 'working-tree',
      sourceCommit: currentCommit(),
    },
  });
}

function buildRevisionInventory(revision) {
  const sourceCommit = execFileSync('git', ['rev-parse', `${revision}^{commit}`], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-brand-inventory-'));
  const archivePath = path.join(temporaryRoot, 'repo.tar');
  const treeRoot = path.join(temporaryRoot, 'tree');
  fs.mkdirSync(treeRoot);
  try {
    execFileSync('git', ['archive', '--format=tar', `--output=${archivePath}`, sourceCommit], {
      cwd: ROOT,
    });
    execFileSync('tar', ['-xf', archivePath, '-C', treeRoot]);
    const files = listTreeFiles(treeRoot, INVENTORY_EXCLUDES);
    return buildInventory({
      files,
      readText: (file) => {
        const buffer = fs.readFileSync(path.join(treeRoot, file));
        return buffer.subarray(0, 8192).includes(0) ? null : buffer.toString('utf8');
      },
      provenance: {
        phase: 'pre-migration',
        source: 'git-archive',
        sourceCommit,
      },
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function rewriteSeriesTags(text) {
  return text.replace(/^tags:\s*(\[[^\]]*\])\s*$/gm, (block, array) => {
    const inner = array.slice(1, -1);
    const tags = [...inner.matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]);
    if (tags.length === 0 && inner.trim()) return block;
    const remaining = tags.filter((tag) => !SERIES_TAGS.has(String(tag).toLowerCase()));
    return remaining.length ? `tags: ${JSON.stringify(remaining)}` : '';
  });
}

export function dedupeMoguNoteImports(text) {
  let seen = false;
  return text
    .split('\n')
    .filter((line) => {
      if (!/^import MoguNote from ["'][^"']*\/MoguNote\.astro["'];\s*$/.test(line)) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join('\n');
}

function isStructuredContractFile(file) {
  return (
    /\.(?:astro|cjs|css|go|js|json|mjs|py|sh|ts|tsx|ya?ml)$/i.test(file) &&
    !file.startsWith('src/content/posts/')
  );
}

function rewriteContractProse(text) {
  return text
    .replace(/\bSP\/CP\b/g, 'GP/MP')
    .replace(/\bSP(?=\.(?:next|label|prefix)\b)/g, 'GP')
    .replace(/\bCP(?=\.(?:next|label|prefix)\b)/g, 'MP')
    .replace(
      /\bSP(?=\s+(?:article|body|candidate|content|pipeline|post|reader|series|source|task|translation|version|writer)s?\b)/gi,
      'GP'
    )
    .replace(
      /\bCP(?=\s+(?:article|candidate|content|pipeline|post|queue|series|task|translation|version|writer)s?\b)/gi,
      'MP'
    )
    .replace(/(?<=這篇|當成|作為|新增|建立|寫成|翻成|產生|一篇|每篇)\s*SP\b/g, ' GP')
    .replace(/(?<=這篇|當成|作為|新增|建立|寫成|翻成|產生|一篇|每篇)\s*CP\b/g, ' MP')
    .replace(/\bSP(?=\s*(?:讀者|文章|系列|候選|流程|編號|號碼|任務|產線|版本))/g, 'GP')
    .replace(/\bCP(?=\s*(?:讀者|文章|系列|候選|流程|編號|號碼|任務|產線|版本))/g, 'MP');
}

export function rewriteText(text, manifest, file) {
  let result = text;
  const factualSentinels = [];
  if (file === 'src/data/post-authorship-notes.json') {
    factualSentinels.push(['Clawd Bot', '__GU_LOG_FACTUAL_GIT_AUTHOR_CLAWD_BOT__', 'Clawd Bot']);
    factualSentinels.push([
      'ShroomClawd',
      '__GU_LOG_FACTUAL_GIT_AUTHOR_SHROOMCLAWD__',
      'ShroomClawd',
    ]);
  }
  if (
    [
      'src/content/posts/sp-64-20260216-openclaw-creator-joins-openai.mdx',
      'src/content/posts/gp-64-20260216-openclaw-creator-joins-openai.mdx',
    ].includes(file)
  ) {
    factualSentinels.push([
      '大家叫我 Clawd，但',
      '__GU_LOG_OPENCLAW_RENAME_HISTORY_ZH__',
      '舊名字裡有 Clawd，但',
    ]);
    factualSentinels.push([
      '舊名字裡有 Clawd，但',
      '__GU_LOG_OPENCLAW_RENAME_HISTORY_ZH__',
      '舊名字裡有 Clawd，但',
    ]);
  }
  if (
    [
      'src/content/posts/en-sp-64-20260216-openclaw-creator-joins-openai.mdx',
      'src/content/posts/en-gp-64-20260216-openclaw-creator-joins-openai.mdx',
    ].includes(file)
  ) {
    factualSentinels.push([
      'Everyone calls me [Clawd](/en/glossary#clawd), but',
      '__GU_LOG_OPENCLAW_RENAME_HISTORY_EN__',
      'My old name had Clawd in it, but',
    ]);
    factualSentinels.push([
      'My old name had Clawd in it, but',
      '__GU_LOG_OPENCLAW_RENAME_HISTORY_EN__',
      'My old name had Clawd in it, but',
    ]);
  }
  if (
    [
      'src/content/posts/en-cp-304-20260529-clawd-rip-claude-timeline.mdx',
      'src/content/posts/en-mp-304-20260529-clawd-rip-claude-timeline.mdx',
    ].includes(file)
  ) {
    factualSentinels.push([
      '[Clawd](/en/glossary#clawd).rip',
      '__GU_LOG_FACTUAL_CLAWD_RIP_SOURCE__',
      '[Clawd.rip](https://clawd.rip/)',
    ]);
    factualSentinels.push([
      '[Clawd.rip](https://clawd.rip/)',
      '__GU_LOG_FACTUAL_CLAWD_RIP_SOURCE__',
      '[Clawd.rip](https://clawd.rip/)',
    ]);
  }
  for (const [original, sentinel] of factualSentinels)
    result = result.replaceAll(original, sentinel);
  const exact = new Map();
  for (const entry of manifest.entries) {
    exact.set(entry.oldSlug, entry.newSlug);
    exact.set(entry.oldTicketId, entry.newTicketId);
  }
  for (const [oldValue, newValue] of [...exact].sort((a, b) => b[0].length - a[0].length)) {
    result = result.split(oldValue).join(newValue);
  }

  result = result
    .replaceAll('tools/sp-pipeline', 'tools/gp-pipeline')
    .replaceAll('scripts/sp-pipeline.sh', 'scripts/gp-pipeline.sh')
    .replaceAll('sp-pipeline', 'gp-pipeline')
    .replaceAll('ClawdNote', 'MoguNote')
    .replaceAll('clawdNote', 'moguNote')
    .replaceAll('Clawd Picks', 'Mogu Picks')
    .replaceAll('ShroomDog Picks', 'Gu-log Picks')
    .replaceAll('Shroom Picks', 'Gu-log Picks')
    .replaceAll('clawd-picks', 'mogu-picks')
    .replaceAll('shroomdog-picks', 'gu-log-picks')
    .replaceAll('shroom-picks', 'gu-log-picks')
    .replaceAll('clawd-note', 'mogu-note')
    .replaceAll('clawd-icon', 'mogu-icon')
    .replaceAll('/glossary#clawd', '/glossary#mogu')
    .replaceAll('/en/glossary#clawd', '/en/glossary#mogu')
    .replace(/\bSP-(?=\d|PENDING)/g, 'GP-')
    .replace(/\bCP-(?=\d|PENDING)/g, 'MP-')
    .replace(/\bSP(?=\d+\b)/g, 'GP')
    .replace(/\bCP(?=\d+\b)/g, 'MP')
    .replace(/(^|[/_.-])sp-(?=(?:\d+|pending)(?:[/_.-]))/gm, '$1gp-')
    .replace(/(^|[/_.-])cp-(?=(?:\d+|pending)(?:[/_.-]))/gm, '$1mp-');

  if (isStructuredContractFile(file)) {
    result = result
      .replace(/(["'`])SP\1/g, '$1GP$1')
      .replace(/(["'`])CP\1/g, '$1MP$1')
      .replace(/((?:--prefix|--series)\s+)SP\b/g, '$1GP')
      .replace(/((?:--prefix|--series)\s+)CP\b/g, '$1MP')
      .replace(/(^\s*(?:prefix|series|ticketPrefix):\s*)SP\b/gm, '$1GP')
      .replace(/(^\s*(?:prefix|series|ticketPrefix):\s*)CP\b/gm, '$1MP');
  }

  result = rewriteContractProse(result);
  // Unlike SP/CP, standalone Clawd is not an ambiguous abbreviation. Apply
  // this persona rename across every active text file in the inventory domain;
  // the factual cases above are protected explicitly before this pass.
  result = result.replace(/\bClawd\b(?!\.rip\b)/g, 'Mogu');
  result = result.replace(/\bShroomClawd\b/g, 'Mogu');

  for (const [, sentinel, replacement] of factualSentinels) {
    result = result.replaceAll(sentinel, replacement);
  }

  if (file.startsWith('src/content/posts/')) {
    result = dedupeMoguNoteImports(result);
    result = rewriteSeriesTags(result);
  }
  return result;
}

export function matchesExactTaxonomyMigration(before, after, manifest, file) {
  return before !== after && rewriteText(before, manifest, file) === after;
}

function stagedFileMatchesTaxonomyMigration(file) {
  if (!file.startsWith('src/content/posts/') || !file.endsWith('.mdx')) return false;
  if (!fs.existsSync(MANIFEST_PATH)) return false;

  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const before = execFileSync('git', ['show', `HEAD:${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const after = execFileSync('git', ['show', `:${file}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return matchesExactTaxonomyMigration(before, after, manifest, file);
  } catch {
    return false;
  }
}

function applyMigration() {
  if (!fs.existsSync(MANIFEST_PATH))
    throw new Error('missing tracked migration manifest; run --snapshot first');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  let rewritten = 0;
  for (const file of listRepoTextFiles(APPLY_EXCLUDES)) {
    const absolute = path.join(ROOT, file);
    const before = fs.readFileSync(absolute, 'utf8');
    const after = rewriteText(before, manifest, file);
    if (after !== before) {
      fs.writeFileSync(absolute, after);
      rewritten += 1;
    }
  }

  let renamed = 0;
  for (const entry of manifest.entries) {
    const oldPath = path.join(POSTS_DIR, entry.oldFilename);
    const newPath = path.join(POSTS_DIR, entry.newFilename);
    if (!fs.existsSync(oldPath)) continue;
    if (fs.existsSync(newPath)) throw new Error(`rename target exists: ${entry.newFilename}`);
    fs.renameSync(oldPath, newPath);
    renamed += 1;
  }
  console.log(`taxonomy migration: rewrote ${rewritten} files; renamed ${renamed} posts`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--snapshot') {
    const manifest = buildManifest();
    writeJson(MANIFEST_PATH, manifest);
    writeJson(PRE_MIGRATION_INVENTORY_PATH, buildWorkingTreeInventory('pre-migration'));
    console.log(
      `snapshot: ${manifest.counts.files} post files / ${manifest.counts.tickets} tickets`
    );
  } else if (mode === '--baseline') {
    const revision = process.argv[3] ?? 'HEAD';
    const inventory = buildRevisionInventory(revision);
    writeJson(PRE_MIGRATION_INVENTORY_PATH, inventory);
    console.log(
      `baseline: ${Object.keys(inventory.contract).length} files from ${inventory.provenance.sourceCommit}`
    );
  } else if (mode === '--inventory') {
    const inventory = buildWorkingTreeInventory('post-migration-residual');
    writeJson(RESIDUAL_INVENTORY_PATH, inventory);
    console.log(
      `inventory: ${Object.keys(inventory.contract).length} files; ` +
        `${Object.keys(inventory.migrationWriteDeferred.residual).length} deferred files`
    );
  } else if (mode === '--apply') {
    applyMigration();
  } else if (mode === '--check-staged-file') {
    process.exitCode = stagedFileMatchesTaxonomyMigration(process.argv[3] ?? '') ? 0 : 1;
  } else {
    console.error(
      'usage: node scripts/migrate-brand-taxonomy.mjs --snapshot|--baseline [git-revision]|--inventory|--apply|--check-staged-file <path>'
    );
    process.exitCode = 2;
  }
}
