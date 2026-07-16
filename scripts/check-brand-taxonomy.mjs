#!/usr/bin/env node

/**
 * Deterministic merge gate for retired gu-log brand contracts.
 *
 * This intentionally scans semantic legacy surfaces rather than bare `SP` or
 * `CP` abbreviations. Immutable history may be excluded by named scope; every
 * active-tree exception must match an exact path, rule, token and count.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_POLICY_PATH = path.join(ROOT, 'quality/brand-taxonomy-residual-allowlist.json');
const RENAME_MANIFEST_PATH = path.join(ROOT, 'quality/brand-taxonomy-post-migration.json');

const ALLOWED_IMMUTABLE_EXCLUDES = new Set([
  'sources/**',
  '.score-loop/progress/completed/**',
  'scores/archive/**',
  'quality/coverage-history.json',
  'openspec/changes/archive/**',
]);

const TEXT_RULES = [
  { rule: 'component', pattern: /\bClawdNote\b/g },
  { rule: 'schema-key', pattern: /\bclawdNote\b/g },
  { rule: 'ticket-id', pattern: /\b(?:SP|CP)-(?:\d+|PENDING|N+)\b/g },
  {
    rule: 'compact-ticket',
    pattern: /(^|[^A-Za-z0-9])((?:SP|CP)\d+)(?=$|[^A-Za-z0-9])/gm,
    capture: 2,
  },
  {
    rule: 'compact-slug',
    pattern: /(^|[^A-Za-z0-9])((?:sp|cp)\d+)(?=$|[^A-Za-z0-9])/gm,
    capture: 2,
  },
  {
    rule: 'post-slug',
    pattern:
      /(^|[^A-Za-z0-9])((?:sp|cp)-(?:\d+|pending|N+)(?:-[A-Za-z0-9][A-Za-z0-9-]*)?)(?=$|[^A-Za-z0-9])/gm,
    capture: 2,
  },
  { rule: 'obsidian-callout', pattern: /\[!clawd\]/gi },
  {
    rule: 'legacy-glossary-anchor',
    pattern: /\/(?:en\/)?glossary#clawd\b/g,
  },
  {
    rule: 'legacy-identifier',
    pattern:
      /\bCLAWD_NOTE(?:_[A-Z0-9_]+)?\b|\.clawd-prefix\b|--color-clawd(?:-[a-z0-9-]+)?\b|\bcolor-clawd(?:-[a-z0-9-]+)?\b|\bclawd(?:Prefix|Color)\b/g,
  },
  { rule: 'external-workspace-coordinate', pattern: /\bclawd-workspace\b/g },
  { rule: 'legacy-series-name', pattern: /\b(?:ShroomDog Picks|Shroom Picks|Clawd Picks)\b/g },
  {
    rule: 'legacy-route',
    pattern: /\b(?:shroomdog-picks|shroom-picks|clawd-picks)\b/g,
  },
  { rule: 'pipeline-command', pattern: /\bsp-pipeline\b/g },
  { rule: 'legacy-full-persona', pattern: /\bShroomClawd\b/g },
  { rule: 'legacy-compound-persona', pattern: /\b(?:ClawdBot|Clawdus)\b/g },
  { rule: 'persona', pattern: /\bClawd\b(?!\.rip\b)/g },
  {
    rule: 'deployment-coordinate',
    pattern:
      /\bclawd-vm\b|\/home\/clawd\b|\/home\/[A-Za-z0-9._-]+\/clawd\b|~\/clawd\b|\$HOME\/clawd\b|\bclawd@[A-Za-z0-9._-]+\b|%h\/clawd\b|Path\.home\(\)\s*\/\s*(?:"clawd"|'clawd'|clawd\b)/g,
  },
];

const PATH_RULES = [
  {
    rule: 'path-component-or-persona',
    pattern: /(^|\/)(ClawdNote|clawd-note|clawd-picks|clawd-icon)(?=[/_.-]|$)/g,
    capture: 2,
  },
  {
    rule: 'path-post-slug',
    pattern: /(^|\/)((?:sp|cp)-(?:\d+|pending|N+)[^/]*)(?=\/|$)/g,
    capture: 2,
    tokenPattern: /^(?:sp|cp)-(?:\d+|pending|N+)/,
  },
  {
    rule: 'path-compact-slug',
    pattern: /(^|[/_.-])((?:sp|cp)\d+)(?=$|[/_.-])/g,
    capture: 2,
  },
  {
    rule: 'path-pipeline',
    pattern: /(^|\/)(sp-pipeline)(?=\/|$)/g,
    capture: 2,
  },
  {
    rule: 'path-series-artifact',
    pattern:
      /(^|\/)((?:sp|cp)-(?!(?:\d+|pending|N+)(?:[.-]|$))(?!(?:pipeline)(?=\/|$))[^/]+)(?=\/|$)/g,
    capture: 2,
  },
  {
    rule: 'path-external-workspace-coordinate',
    pattern: /(^|\/)(clawd-workspace)(?=\/|$)/g,
    capture: 2,
  },
];

const CANONICAL_REFERENCE_RULES = [
  {
    rule: 'dangling-canonical-reference',
    pattern: /\btools\/gp-pipeline(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*/g,
  },
  {
    rule: 'dangling-canonical-reference',
    pattern: /\bscripts\/mogu-picks-(?:prompt|config|loop|queue)(?:\.[A-Za-z0-9_-]+)*/g,
  },
];

const LEGACY_SERIES_TERM =
  '(?:series|post(?:s)?|article(?:s)?|takeaway(?:s)?|ticket(?:Id)?|prefix(?:es)?|slug|route|tag|pipeline|writer|queue|candidate(?:s)?|counter|workflow|feed|translation|translator|command|path|contract|taxonomy|namespace|content|系列|文章|票號|編號|號碼|讀者|前綴|管線|流程|翻譯|寫手|佇列|候選|路由|標籤|契約|分類法|命名空間|內容)';
const DEFINITIVE_SERIES_LINE =
  /\b(?:ticketPrefixes|prefix(?:es)?|series)\b\s*[:=]|--(?:prefix|series)\b|\b(?:SP|CP)\.next\b/i;
const SERIES_TERM_BEFORE = new RegExp(
  `(?:${LEGACY_SERIES_TERM}|這篇|本篇|一篇|一般|寫成)\\s*[:=/#"'\\[({-]*\\s*$`,
  'i'
);
const SERIES_DEMONSTRATIVE_BEFORE = /\b(?:This|That|The|An?|Some)\s*$/i;
const SERIES_TERM_AFTER = new RegExp(`^\\s*${LEGACY_SERIES_TERM}`, 'i');
const NAMED_POST_AFTER = /^\s+[A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2}\s+(?:post|article)\b/i;
const METRIC_VALUE_AFTER = /^\s*(?:value\b|值)/i;
const SERIES_PAIR_OR_MAPPING = /\b(?:SP|CP)\s*(?:[/／]\s*(?:SP|CP)|(?:→|->|=>)\s*(?:GP|MP))\b/;

const KNOWN_RULES = new Set([
  ...TEXT_RULES.map(({ rule }) => rule),
  ...PATH_RULES.map(({ rule }) => rule),
  ...CANONICAL_REFERENCE_RULES.map(({ rule }) => rule),
  'legacy-prefix-value',
]);

function locationFor(text, index) {
  const prefix = text.slice(0, index);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function scanWithRules(file, text, rules, source) {
  const findings = [];
  for (const definition of rules) {
    const pattern = new RegExp(definition.pattern.source, definition.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      let token = definition.capture ? match[definition.capture] : match[0];
      if (definition.tokenPattern) token = token.match(definition.tokenPattern)?.[0] ?? token;
      const tokenOffset = match[0].indexOf(token);
      const index = (match.index ?? 0) + Math.max(tokenOffset, 0);
      findings.push({
        path: file,
        rule: definition.rule,
        token,
        source,
        index,
        ...locationFor(text, index),
      });
    }
  }
  return findings.sort(
    (left, right) =>
      left.index - right.index ||
      left.rule.localeCompare(right.rule) ||
      left.token.localeCompare(right.token)
  );
}

export function scanLegacyText(file, text) {
  const findings = scanWithRules(file, text, TEXT_RULES, 'content');
  let offset = 0;
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/\b(?:SP|CP)\b(?![-\d])/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const before = line.slice(Math.max(0, start - 48), start);
      const after = line.slice(end, Math.min(line.length, end + 48));
      const around = line.slice(Math.max(0, start - 8), Math.min(line.length, end + 16));
      if (
        DEFINITIVE_SERIES_LINE.test(line) ||
        SERIES_TERM_BEFORE.test(before) ||
        (SERIES_DEMONSTRATIVE_BEFORE.test(before) && !METRIC_VALUE_AFTER.test(after)) ||
        SERIES_TERM_AFTER.test(after) ||
        NAMED_POST_AFTER.test(after) ||
        SERIES_PAIR_OR_MAPPING.test(around)
      ) {
        const index = offset + (match.index ?? 0);
        findings.push({
          path: file,
          rule: 'legacy-prefix-value',
          token: match[0],
          source: 'content',
          index,
          ...locationFor(text, index),
        });
      }
    }
    offset += line.length + 1;
  }
  return findings.sort(
    (left, right) =>
      left.index - right.index ||
      left.rule.localeCompare(right.rule) ||
      left.token.localeCompare(right.token)
  );
}

// One-shot corpus rename manifest generated by the retired migration codemod
// (see openspec/changes/rebrand-mogu-gp-mp-taxonomy/design.md D3/D6). It is the
// evidence-derived SSOT for which old post slug/filename maps to which new one;
// bare regexes cannot re-derive the assigned ticket number for a descriptive
// legacy slug like `clawd-picks-20260203-swyx-agent-definition`. Missing on
// branches/checkouts that predate or postdate the migration -> empty map, no-op.
let cachedSlugRenameMap;
function loadSlugRenameMap() {
  if (cachedSlugRenameMap) return cachedSlugRenameMap;
  cachedSlugRenameMap = new Map();
  try {
    const manifest = JSON.parse(fs.readFileSync(RENAME_MANIFEST_PATH, 'utf8'));
    for (const entry of manifest.entries ?? []) {
      if (typeof entry?.oldSlug === 'string' && typeof entry?.newSlug === 'string') {
        cachedSlugRenameMap.set(entry.oldSlug, entry.newSlug);
      }
    }
  } catch {
    // manifest absent (e.g. isolated test fixtures, pre/post-migration checkouts)
  }
  return cachedSlugRenameMap;
}

export function canonicalizeSeriesTaxonomyText(text) {
  let canonical = text;

  // Corpus-wide slug/filename renames (cross-post links, glossary anchors,
  // "Related Reading" lists) must run before the generic sp-/cp- prefix
  // regexes below, or the exact old-slug key would already be mutated.
  for (const [oldSlug, newSlug] of loadSlugRenameMap()) {
    if (canonical.includes(oldSlug)) canonical = canonical.split(oldSlug).join(newSlug);
  }

  canonical = canonical
    // component / schema-key / series-name / pipeline-command contract renames
    // (design.md canonical taxonomy table)
    .replace(/\bClawdNote\b/g, 'MoguNote')
    .replace(/\bclawdNote\b/g, 'moguNote')
    .replace(/\bShroomDog Picks\b/g, 'Gu-log Picks')
    .replace(/\bShroom Picks\b/g, 'Gu-log Picks')
    .replace(/\bClawd Picks\b/g, 'Mogu Picks')
    .replace(/\bsp-pipeline\b/g, 'gp-pipeline')
    // frontmatter `pipelineUrl` is a machine-generated tooling-provenance
    // field, not reader prose; every pre-migration value pointed at one of
    // the retired translation-pipeline entrypoints (ralph-loop.sh,
    // shroom-feed-pipeline.sh, or an earlier tools/gp-pipeline path/blob
    // variant) and the migration always rewrites it to the single canonical
    // gp-pipeline tree URL (design.md D3).
    .replace(
      /"https:\/\/github\.com\/chitienhsiehwork-ai\/(?:gu-log|clawd-workspace)\/[^"]*(?:ralph-loop\.sh|shroom-feed-pipeline\.sh|gp-pipeline(?:\.sh)?(?:\/README\.md)?)"/g,
      '"https://github.com/chitienhsiehwork-ai/gu-log/tree/main/tools/gp-pipeline"'
    )
    // one-off asset folder rename accompanying its post's slug rename
    .split('assets/posts/sp-nvidia-hardware-codesign')
    .join('assets/posts/gp-nvidia-hardware-codesign')
    .replace(/\/(en\/)?glossary#clawd\b/g, '/$1glossary#mogu')
    // compound full persona before bare persona, so "ShroomClawd" doesn't
    // become "ShroomMogu"
    .replace(/\bShroomClawd\b/g, 'Mogu')
    .replace(/\bClawd\b(?!\.rip\b)/g, 'Mogu')
    .replace(/\bSP-(?=\d+|PENDING\b|N+\b)/g, 'GP-')
    .replace(/\bCP-(?=\d+|PENDING\b|N+\b)/g, 'MP-')
    .replace(/\bSP(?=\d+\b)/g, 'GP')
    .replace(/\bCP(?=\d+\b)/g, 'MP')
    .replace(/\bsp-(?=\d+|pending\b|N+\b)/g, 'gp-')
    .replace(/\bcp-(?=\d+|pending\b|N+\b)/g, 'mp-')
    .replace(/\bsp(?=\d+\b)/g, 'gp')
    .replace(/\bcp(?=\d+\b)/g, 'mp')
    // migration codemod's YAML frontmatter rewrite of the `tags:` array
    // (design.md D3): drop the retired series tag entirely (no replacement
    // tag added), re-serialize single-quoted values as double-quoted, flatten
    // any multi-line array onto one compact line, and blank the key entirely
    // if nothing but the retired series tag was ever there.
    .replace(/^tags:\s*\n?\s*\[([\s\S]*?)\]/gm, (match, inner) => {
      const legacySeriesTags = new Set([
        'shroom-picks',
        'shroomdog-picks',
        'clawd-picks',
        'mogu-picks',
        'gu-log-picks',
      ]);
      const items = inner
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.replace(/^'([\s\S]*)'$/, '"$1"'))
        .filter((item) => !legacySeriesTags.has(item.replace(/^"|"$/g, '')));
      return items.length > 0 ? `tags: [${items.join(',')}]` : '';
    })
    // asset/script filenames that carried the retired persona prefix
    // (e.g. mogu-picks-icon.png, scripts/mogu-picks-prompt.md)
    .replace(/\bclawd-picks-(?=[a-z0-9])/g, 'mogu-picks-')
    // some posts already carried a transitional `import MoguNote ...` line
    // alongside the retired `import ClawdNote ...` alias (design.md Context:
    // "repo 已經出現 MoguNote 與 GP/MP 顯示名稱，但 canonical storage 仍是
    // Clawd/SP/CP"); converting ClawdNote -> MoguNote above can leave two
    // identical import lines back to back, which the migration deduplicates.
    .replace(/^(import MoguNote from '\.\.\/\.\.\/components\/MoguNote\.astro';\n)\1+/gm, '$1');

  // Scan the already-canonicalized text (not the original `text`): every
  // transformation above can change string length, so finding.index must be
  // computed against the same string it will be applied to.
  const semanticPrefixes = scanLegacyText('<canonicalization>', canonical)
    .filter(({ rule }) => rule === 'legacy-prefix-value')
    .sort((left, right) => right.index - left.index);
  for (const finding of semanticPrefixes) {
    const replacement = finding.token === 'SP' ? 'GP' : 'MP';
    canonical =
      canonical.slice(0, finding.index) +
      replacement +
      canonical.slice(finding.index + finding.token.length);
  }
  return canonical;
}

export function isCanonicalSeriesTaxonomyOnlyChange(before, after) {
  return before !== after && canonicalizeSeriesTaxonomyText(before) === after;
}

function canonicalTargetIsTracked(target, trackedFiles) {
  if (trackedFiles.has(target)) return true;
  const directoryPrefix = `${target}/`;
  return [...trackedFiles].some((file) => file.startsWith(directoryPrefix));
}

export function scanCanonicalReferences(file, text, trackedPaths) {
  // Ignore files intentionally describe paths that must stay untracked.
  if (path.posix.basename(file) === '.gitignore') return [];
  const trackedFiles = trackedPaths instanceof Set ? trackedPaths : new Set(trackedPaths ?? []);
  return scanWithRules(file, text, CANONICAL_REFERENCE_RULES, 'reference').filter(
    ({ token }) => !canonicalTargetIsTracked(token, trackedFiles)
  );
}

export function scanLegacyPath(file) {
  return scanWithRules(file, file, PATH_RULES, 'path').map((finding) => ({
    ...finding,
    line: 1,
    column: finding.index + 1,
  }));
}

function matchesScopePattern(file, pattern) {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -2);
    return file.startsWith(prefix);
  }
  return file === pattern;
}

export function isResidualScopeExcluded(file, policy) {
  const immutableHistoryExcludes = Array.isArray(policy?.immutableHistoryExcludes)
    ? policy.immutableHistoryExcludes
    : [];
  const generatedArtifactExcludes = Array.isArray(policy?.generatedArtifactExcludes)
    ? policy.generatedArtifactExcludes
    : [];
  return [...immutableHistoryExcludes, ...generatedArtifactExcludes]
    .filter((pattern) => typeof pattern === 'string')
    .some((pattern) => matchesScopePattern(file, pattern));
}

function exceptionKey(value) {
  return `${value.path}\u0000${value.rule}\u0000${value.token}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function policyArray(policy, field, errors) {
  const value = isRecord(policy) ? policy[field] : undefined;
  if (!Array.isArray(value)) {
    errors.push(`policy ${field} must be an array`);
    return [];
  }
  return value;
}

export function validatePolicy(policy, options = {}) {
  const errors = [];
  if (!isRecord(policy)) {
    return ['policy must be an object'];
  }
  if (policy.schemaVersion !== 1) errors.push('policy schemaVersion must be 1');

  const immutableHistoryExcludes = policyArray(policy, 'immutableHistoryExcludes', errors);
  const generatedArtifactExcludes = policyArray(policy, 'generatedArtifactExcludes', errors);
  const exactExceptions = policyArray(policy, 'exactExceptions', errors);

  for (const pattern of immutableHistoryExcludes) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      errors.push('immutable exclusion must be a non-empty string');
      continue;
    }
    if (!ALLOWED_IMMUTABLE_EXCLUDES.has(pattern)) {
      errors.push(`immutable exclusion is not an approved history scope: ${pattern}`);
    }
  }
  for (const pattern of generatedArtifactExcludes) {
    if (typeof pattern !== 'string' || !pattern.trim()) {
      errors.push('generated artifact exclusion must be a non-empty string');
      continue;
    }
    if (pattern.includes('*') || !pattern.startsWith('quality/')) {
      errors.push(`generated artifact exclusion must be an exact quality/ path: ${pattern}`);
    }
  }

  const trackedFiles =
    options.trackedFiles instanceof Set
      ? options.trackedFiles
      : new Set(options.trackedFiles ?? listTrackedFiles());
  const pathExists = options.pathExists ?? ((file) => fs.existsSync(path.join(ROOT, file)));
  const seen = new Set();
  for (const exception of exactExceptions) {
    if (!isRecord(exception)) {
      errors.push('exact exception must be an object');
      continue;
    }
    const key = exceptionKey(exception);
    if (seen.has(key)) errors.push(`duplicate exact exception: ${key.replaceAll('\u0000', ' / ')}`);
    seen.add(key);
    const pathLabel = typeof exception.path === 'string' ? exception.path : String(exception.path);
    if (typeof exception.path !== 'string' || !exception.path.trim()) {
      errors.push('exception path is required');
    } else {
      if (/[*?]/.test(exception.path)) {
        errors.push(`exception path must be exact: ${exception.path}`);
      }
      if (path.isAbsolute(exception.path) || exception.path.split('/').includes('..')) {
        errors.push(`exception path must be repo-relative: ${exception.path}`);
      }
      if (!trackedFiles.has(exception.path)) {
        errors.push(`exception path is not tracked: ${exception.path}`);
      } else if (!pathExists(exception.path)) {
        errors.push(`exception path does not exist: ${exception.path}`);
      }
    }
    if (typeof exception.rule !== 'string' || !KNOWN_RULES.has(exception.rule)) {
      errors.push(`exception rule is unknown: ${String(exception.rule)}`);
    }
    if (typeof exception.token !== 'string' || !exception.token.trim()) {
      errors.push(`exception token is required: ${pathLabel}`);
    } else if (/[*?]/.test(exception.token)) {
      errors.push(`exception token must be exact: ${exception.token}`);
    }
    if (typeof exception.reason !== 'string' || !exception.reason.trim()) {
      errors.push(`exception reason is required: ${pathLabel}`);
    }
    if (!Number.isInteger(exception.expectedCount) || exception.expectedCount < 1) {
      errors.push(`exception expectedCount must be a positive integer: ${pathLabel}`);
    }
  }
  return errors;
}

export function applyResidualPolicy(findings, policy, options = {}) {
  const policyErrors = validatePolicy(policy, options);
  const grouped = new Map();
  for (const finding of findings) {
    const key = exceptionKey(finding);
    const values = grouped.get(key) ?? [];
    values.push(finding);
    grouped.set(key, values);
  }

  const allowedKeys = new Set();
  const staleExceptions = [];
  const exactExceptions = Array.isArray(policy?.exactExceptions) ? policy.exactExceptions : [];
  for (const exception of exactExceptions.filter(isRecord)) {
    const key = exceptionKey(exception);
    const actualCount = grouped.get(key)?.length ?? 0;
    if (actualCount === exception.expectedCount) {
      allowedKeys.add(key);
    } else {
      staleExceptions.push({ ...exception, actualCount });
    }
  }

  return {
    blockers: findings.filter((finding) => !allowedKeys.has(exceptionKey(finding))),
    staleExceptions,
    policyErrors,
    allowedCount: findings.filter((finding) => allowedKeys.has(exceptionKey(finding))).length,
  };
}

function listRepoFiles() {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return [...new Set(output.split('\0').filter(Boolean))].sort();
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean).sort();
}

function readPolicy(policyPath = DEFAULT_POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

function scanRepository(policy) {
  const findings = [];
  const trackedFiles = new Set(listTrackedFiles());
  for (const file of listRepoFiles()) {
    if (isResidualScopeExcluded(file, policy)) continue;
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    findings.push(...scanLegacyPath(file));
    const buffer = fs.readFileSync(absolute);
    if (!buffer.subarray(0, 8192).includes(0)) {
      const text = buffer.toString('utf8');
      findings.push(...scanLegacyText(file, text));
      findings.push(...scanCanonicalReferences(file, text, trackedFiles));
    }
  }
  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule)
  );
}

function printHumanResult(result, findingCount) {
  console.log(
    `brand taxonomy residual gate: ${result.blockers.length} blocker occurrences; ` +
      `${result.allowedCount} exact exceptions; ${result.staleExceptions.length} stale exceptions; ` +
      `${result.policyErrors.length} policy errors (${findingCount} findings scanned)`
  );
  const blockersByRule = Object.entries(
    result.blockers.reduce((counts, finding) => {
      counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
      return counts;
    }, {})
  ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (blockersByRule.length) {
    console.log(
      `blockers by rule: ${blockersByRule.map(([rule, count]) => `${rule}=${count}`).join(', ')}`
    );
  }
  for (const error of result.policyErrors) console.error(`POLICY: ${error}`);
  for (const exception of result.staleExceptions) {
    console.error(
      `STALE: ${exception.path} / ${exception.rule} / ${JSON.stringify(exception.token)} ` +
        `expected ${exception.expectedCount}, found ${exception.actualCount}: ${exception.reason}`
    );
  }
  for (const finding of result.blockers.slice(0, 200)) {
    console.error(
      `BLOCKER: ${finding.path}:${finding.line}:${finding.column} ` +
        `[${finding.rule}] ${JSON.stringify(finding.token)}`
    );
  }
  if (result.blockers.length > 200) {
    console.error(`... ${result.blockers.length - 200} more blocker occurrences`);
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? '--check';
  if (mode === '--check-canonical-staged-file') {
    const file = process.argv[3];
    if (!file || path.isAbsolute(file) || file.split('/').includes('..')) {
      process.exitCode = 2;
    } else {
      try {
        const before = execFileSync('git', ['show', `HEAD:${file}`], {
          cwd: ROOT,
          encoding: 'utf8',
        });
        const after = execFileSync('git', ['show', `:${file}`], {
          cwd: ROOT,
          encoding: 'utf8',
        });
        process.exitCode = isCanonicalSeriesTaxonomyOnlyChange(before, after) ? 0 : 1;
      } catch {
        process.exitCode = 1;
      }
    }
  } else {
    const policyFlagIndex = process.argv.indexOf('--policy');
    const policyPath =
      policyFlagIndex >= 0 ? path.resolve(process.argv[policyFlagIndex + 1]) : DEFAULT_POLICY_PATH;
    const policy = readPolicy(policyPath);
    const findings = scanRepository(policy);
    const result = applyResidualPolicy(findings, policy);
    const report = { schemaVersion: 1, findings, ...result };

    if (mode === '--json' || mode === '--inventory') {
      console.log(JSON.stringify(report, null, 2));
      if (mode === '--inventory') process.exitCode = 0;
    } else if (mode === '--check') {
      printHumanResult(result, findings.length);
    } else {
      console.error(
        'usage: node scripts/check-brand-taxonomy.mjs ' +
          '[--check|--json|--inventory|--check-canonical-staged-file path] [--policy path]'
      );
      process.exitCode = 2;
    }

    if (
      mode !== '--inventory' &&
      (result.blockers.length || result.staleExceptions.length || result.policyErrors.length)
    ) {
      process.exitCode = 1;
    }
  }
}
