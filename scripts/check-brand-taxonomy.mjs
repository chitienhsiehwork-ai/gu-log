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
  { rule: 'ticket-id', pattern: /\b(?:SP|CP)-(?:\d+|PENDING)\b/g },
  {
    rule: 'compact-ticket',
    pattern: /(^|[^A-Za-z0-9])((?:SP|CP)\d+)(?=$|[^A-Za-z0-9])/gm,
    capture: 2,
  },
  {
    rule: 'compact-slug',
    pattern: /(^|[/_.-])((?:sp|cp)\d+)(?=$|[/_.-])/gm,
    capture: 2,
  },
  {
    rule: 'post-slug',
    pattern: /(^|[/_.-])((?:sp|cp)-(?:\d+|pending))(?=$|[/_.-])/gm,
    capture: 2,
  },
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
    pattern: /\bclawd-vm\b|\/home\/clawd\b|~\/clawd\b|\$HOME\/clawd\b/g,
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
    pattern: /(^|\/)((?:sp|cp)-(?:\d+|pending)[^/]*)(?=\/|$)/g,
    capture: 2,
    tokenPattern: /^(?:sp|cp)-(?:\d+|pending)/,
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
];

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
    if (/\b(?:prefix(?:es)?|ticketPrefixes|series)\b|--(?:prefix|series)\b/i.test(line)) {
      for (const match of line.matchAll(/\b(?:SP|CP)\b(?![-\d])/g)) {
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
  return [...policy.immutableHistoryExcludes, ...policy.generatedArtifactExcludes].some((pattern) =>
    matchesScopePattern(file, pattern)
  );
}

function exceptionKey(value) {
  return `${value.path}\u0000${value.rule}\u0000${value.token}`;
}

function validatePolicy(policy) {
  const errors = [];
  if (policy.schemaVersion !== 1) errors.push('policy schemaVersion must be 1');
  for (const pattern of policy.immutableHistoryExcludes ?? []) {
    if (!ALLOWED_IMMUTABLE_EXCLUDES.has(pattern)) {
      errors.push(`immutable exclusion is not an approved history scope: ${pattern}`);
    }
  }
  for (const pattern of policy.generatedArtifactExcludes ?? []) {
    if (pattern.includes('*') || !pattern.startsWith('quality/')) {
      errors.push(`generated artifact exclusion must be an exact quality/ path: ${pattern}`);
    }
  }

  const seen = new Set();
  for (const exception of policy.exactExceptions ?? []) {
    const key = exceptionKey(exception);
    if (seen.has(key)) errors.push(`duplicate exact exception: ${key.replaceAll('\u0000', ' / ')}`);
    seen.add(key);
    if (/[*?]/.test(exception.path)) errors.push(`exception path must be exact: ${exception.path}`);
    if (!exception.reason?.trim()) errors.push(`exception reason is required: ${exception.path}`);
    if (!Number.isInteger(exception.expectedCount) || exception.expectedCount < 1) {
      errors.push(`exception expectedCount must be a positive integer: ${exception.path}`);
    }
  }
  return errors;
}

export function applyResidualPolicy(findings, policy) {
  const policyErrors = validatePolicy(policy);
  const grouped = new Map();
  for (const finding of findings) {
    const key = exceptionKey(finding);
    const values = grouped.get(key) ?? [];
    values.push(finding);
    grouped.set(key, values);
  }

  const allowedKeys = new Set();
  const staleExceptions = [];
  for (const exception of policy.exactExceptions ?? []) {
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

function readPolicy(policyPath = DEFAULT_POLICY_PATH) {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

function scanRepository(policy) {
  const findings = [];
  for (const file of listRepoFiles()) {
    if (isResidualScopeExcluded(file, policy)) continue;
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    findings.push(...scanLegacyPath(file));
    const buffer = fs.readFileSync(absolute);
    if (!buffer.subarray(0, 8192).includes(0)) {
      findings.push(...scanLegacyText(file, buffer.toString('utf8')));
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
      'usage: node scripts/check-brand-taxonomy.mjs [--check|--json|--inventory] [--policy path]'
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
