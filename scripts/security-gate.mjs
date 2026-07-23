#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_ALLOWLIST_PATH = join(ROOT, 'quality', 'security-allowlist.json');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_ALLOWLIST_DAYS = {
  runtime: 14,
  mixed: 14,
  unknown: 14,
  dev: 45,
};

function toAbsolutePath(inputPath) {
  return isAbsolute(inputPath) ? inputPath : join(ROOT, inputPath);
}

function parseArgs(argv) {
  const options = {
    allowlistPath: DEFAULT_ALLOWLIST_PATH,
    auditFile: null,
    prodAuditFile: null,
    validateOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allowlist' && argv[i + 1]) {
      options.allowlistPath = toAbsolutePath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--audit-file' && argv[i + 1]) {
      options.auditFile = argv[i + 1] === '-' ? '-' : toAbsolutePath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--prod-audit-file' && argv[i + 1]) {
      options.prodAuditFile = toAbsolutePath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--validate-only') {
      options.validateOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/security-gate.mjs [options]\n\nOptions:\n  --allowlist <path>       Allowlist path (default: quality/security-allowlist.json)\n  --audit-file <path>      Read full audit JSON from file; use - for stdin\n  --prod-audit-file <path> Read production audit JSON from file\n  --validate-only          Validate --audit-file schema, then exit\n  -h, --help               Show help\n`
      );
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }

  return options;
}

function loadJson(path) {
  if (path === '-') {
    return JSON.parse(readFileSync(0, 'utf-8'));
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function selectAuditSchema(report) {
  const hasLegacy = Object.hasOwn(report, 'advisories');
  const hasV2 = Object.hasOwn(report, 'vulnerabilities');
  if (hasLegacy && Object.keys(report.advisories || {}).length > 0) return 'legacy';
  if (hasV2) return 'v2';
  return 'legacy';
}

function validateAuditReport(report, label = 'Audit report') {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error(`${label} must be a JSON object`);
  }
  if (report.error) {
    const message = report.error.message || report.error.code || JSON.stringify(report.error);
    throw new Error(`${label} contains an audit error: ${message}`);
  }

  const hasLegacy = Object.hasOwn(report, 'advisories');
  const hasV2 = Object.hasOwn(report, 'vulnerabilities');
  if (!hasLegacy && !hasV2) {
    throw new Error(`${label} is missing advisories/vulnerabilities`);
  }
  if (
    hasLegacy &&
    (!report.advisories ||
      typeof report.advisories !== 'object' ||
      Array.isArray(report.advisories))
  ) {
    throw new Error(`${label}.advisories must be an object`);
  }
  if (
    hasV2 &&
    (!report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' ||
      Array.isArray(report.vulnerabilities))
  ) {
    throw new Error(`${label}.vulnerabilities must be an object`);
  }

  const counts = report.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new Error(`${label} is missing metadata.vulnerabilities`);
  }
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    if (!Number.isInteger(counts[severity]) || counts[severity] < 0) {
      throw new Error(`${label} has invalid metadata.vulnerabilities.${severity}`);
    }
  }

  const schema = selectAuditSchema(report);
  const entries = Object.values(schema === 'legacy' ? report.advisories : report.vulnerabilities);
  const parsedHighCritical = entries.filter((entry) =>
    ['high', 'critical'].includes((entry?.severity || '').toLowerCase())
  ).length;
  if (counts.high + counts.critical > 0 && parsedHighCritical === 0) {
    throw new Error(`${label} reports high/critical counts but no matching findings`);
  }
  if (counts.high + counts.critical === 0 && parsedHighCritical > 0) {
    throw new Error(`${label} contains high/critical findings but metadata reports none`);
  }

  return report;
}

function readAuditReport(auditFile, { productionOnly = false } = {}) {
  const label = productionOnly ? 'Production audit report' : 'Full audit report';
  if (auditFile) {
    if (auditFile !== '-' && !existsSync(auditFile)) {
      throw new Error(`Audit file not found: ${auditFile}`);
    }
    return validateAuditReport(loadJson(auditFile), label);
  }

  const auditCommand = existsSync(join(ROOT, 'package-lock.json'))
    ? `npm audit${productionOnly ? ' --omit=dev' : ''} --json`
    : `pnpm audit${productionOnly ? ' --prod' : ''} --json`;

  let raw = '';
  try {
    raw = execSync(auditCommand, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // audit commands exit non-zero when vulnerabilities exist; stdout still contains JSON
    raw = error?.stdout?.toString?.() || '';
  }

  if (!raw.trim()) {
    throw new Error(`${auditCommand} returned empty output`);
  }

  return validateAuditReport(JSON.parse(raw), label);
}

function parseLegacyRoot(path) {
  if (!path || typeof path !== 'string') return null;

  const pieces = path
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.');

  if (pieces.length > 0) return pieces[0];
  return null;
}

function parseNodeModulesRoot(nodePath) {
  if (!nodePath || typeof nodePath !== 'string') return null;
  const match = nodePath.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  return match ? match[1] : null;
}

function classifyScope(roots, deps, devDeps) {
  const tags = new Set();

  for (const root of roots) {
    if (deps.has(root)) {
      tags.add('runtime');
    } else if (devDeps.has(root)) {
      tags.add('dev');
    } else {
      tags.add('unknown');
    }
  }

  if (tags.has('runtime') && tags.has('dev')) return 'mixed';
  if (tags.has('runtime')) return 'runtime';
  if (tags.has('dev')) return 'dev';
  return 'unknown';
}

function normalizeFromAdvisories(report, deps, devDeps) {
  const advisories = Object.values(report.advisories || {});

  return advisories
    .filter((advisory) => ['high', 'critical'].includes((advisory.severity || '').toLowerCase()))
    .map((advisory) => {
      const paths = [
        ...new Set(
          (advisory.findings || []).flatMap((finding) => finding.paths || []).filter(Boolean)
        ),
      ];
      const roots = [...new Set(paths.map(parseLegacyRoot).filter(Boolean))];
      const scope = classifyScope(roots, deps, devDeps);

      return {
        id: advisory.id != null ? String(advisory.id) : null,
        ids: advisory.id != null ? [String(advisory.id)] : [],
        name: advisory.module_name || 'unknown-module',
        severity: (advisory.severity || '').toLowerCase(),
        title: advisory.title || '',
        url: advisory.url || '',
        scope,
        roots,
        paths,
      };
    });
}

function normalizeFromV2(report, deps, devDeps) {
  return Object.entries(report.vulnerabilities || {})
    .filter(([, vuln]) => ['high', 'critical'].includes((vuln.severity || '').toLowerCase()))
    .map(([name, vuln]) => {
      const ids = [
        ...new Set(
          (vuln.via || [])
            .filter((item) => item && typeof item === 'object' && item.source != null)
            .map((item) => String(item.source))
        ),
      ];

      const rootsFromNodes = [
        ...new Set((vuln.nodes || []).map(parseNodeModulesRoot).filter(Boolean)),
      ];
      const roots = [...rootsFromNodes];

      if (roots.length === 0 && vuln.isDirect) {
        roots.push(name);
      }

      const scope = classifyScope(roots, deps, devDeps);

      return {
        id: ids[0] || null,
        ids,
        name,
        severity: (vuln.severity || '').toLowerCase(),
        title: '',
        url: '',
        scope,
        roots,
        paths: vuln.nodes || [],
      };
    });
}

function normalizeFindings(report, deps, devDeps) {
  if (selectAuditSchema(report) === 'legacy') {
    return normalizeFromAdvisories(report, deps, devDeps);
  }
  return normalizeFromV2(report, deps, devDeps);
}

function findingsMatch(left, right) {
  const leftIds = new Set([left.id, ...(left.ids || [])].filter(Boolean));
  const rightIds = new Set([right.id, ...(right.ids || [])].filter(Boolean));
  if (leftIds.size > 0 && rightIds.size > 0) {
    return [...leftIds].some((id) => rightIds.has(id));
  }
  return left.name !== 'unknown-module' && left.name === right.name;
}

function mergeProductionScope(fullFindings, productionFindings) {
  const merged = fullFindings.map((finding) => {
    if (!productionFindings.some((production) => findingsMatch(finding, production))) {
      return { ...finding };
    }
    return {
      ...finding,
      scope: finding.scope === 'dev' || finding.scope === 'mixed' ? 'mixed' : 'runtime',
    };
  });

  for (const production of productionFindings) {
    if (!merged.some((finding) => findingsMatch(finding, production))) {
      merged.push({ ...production, scope: 'runtime' });
    }
  }
  return merged;
}

function loadAllowlist(path) {
  if (!existsSync(path)) {
    return [];
  }

  const parsed = loadJson(path);
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;

  if (!Array.isArray(entries)) {
    throw new Error(`Allowlist format error: ${path} must contain an array or { entries: [] }`);
  }

  return entries.map((entry, idx) => {
    const id = entry?.id != null ? String(entry.id) : null;
    const name = entry?.name != null ? String(entry.name) : null;
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    const expiresAt = typeof entry?.expiresAt === 'string' ? entry.expiresAt.trim() : '';

    if (!id && !name) {
      throw new Error(`Allowlist entry #${idx + 1} must include at least id or name`);
    }
    if (!reason) {
      throw new Error(`Allowlist entry #${idx + 1} is missing reason`);
    }
    if (!expiresAt) {
      throw new Error(`Allowlist entry #${idx + 1} is missing expiresAt`);
    }

    const expiresMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresMs)) {
      throw new Error(`Allowlist entry #${idx + 1} has invalid expiresAt: ${expiresAt}`);
    }

    return {
      ...entry,
      id,
      name,
      reason,
      expiresAt,
      expiresMs,
      _index: idx + 1,
    };
  });
}

function entryMatchesVulnerability(entry, vulnerability) {
  if (entry.id) {
    const ids = new Set(vulnerability.ids || []);
    if (vulnerability.id) ids.add(vulnerability.id);
    if (!ids.has(entry.id)) return false;
  }

  if (entry.name && entry.name !== vulnerability.name) {
    return false;
  }

  return true;
}

function summarizeScopes(vulnerabilities) {
  const summary = { runtime: 0, dev: 0, mixed: 0, unknown: 0 };
  for (const vuln of vulnerabilities) {
    summary[vuln.scope] = (summary[vuln.scope] || 0) + 1;
  }
  return summary;
}

function formatVulnerability(vuln) {
  const idPart = vuln.id ? `id=${vuln.id}` : 'id=n/a';
  const rootsPart = vuln.roots.length > 0 ? vuln.roots.join(', ') : 'unknown-root';
  return `- [${vuln.severity.toUpperCase()}][${vuln.scope}] ${vuln.name} (${idPart}) roots: ${rootsPart}`;
}

function evaluateFindings(findings, allowlist, now = Date.now()) {
  const allowed = [];
  const blockedNew = [];
  const blockedExpired = [];
  const blockedPolicy = [];
  const usedAllowlistIndexes = new Set();

  for (const vulnerability of findings) {
    const matches = allowlist.filter((entry) => entryMatchesVulnerability(entry, vulnerability));

    if (matches.length === 0) {
      blockedNew.push(vulnerability);
      continue;
    }

    const valid = matches.find((entry) => entry.expiresMs >= now);

    if (!valid) {
      blockedExpired.push({ vulnerability, entries: matches });
      matches.forEach((entry) => usedAllowlistIndexes.add(entry._index));
      continue;
    }

    const maxDays = MAX_ALLOWLIST_DAYS[vulnerability.scope] ?? 14;
    const daysLeft = Math.ceil((valid.expiresMs - now) / MS_PER_DAY);
    if (daysLeft > maxDays) {
      blockedPolicy.push({ vulnerability, entry: valid, daysLeft, maxDays });
      usedAllowlistIndexes.add(valid._index);
      continue;
    }

    usedAllowlistIndexes.add(valid._index);
    allowed.push({ vulnerability, entry: valid, daysLeft });
  }

  const staleExpiredEntries = allowlist.filter(
    (entry) => entry.expiresMs < now && !usedAllowlistIndexes.has(entry._index)
  );

  return {
    allowed,
    blockedNew,
    blockedExpired,
    blockedPolicy,
    staleExpiredEntries,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = loadJson(join(ROOT, 'package.json'));
  const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
  const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

  const report = readAuditReport(options.auditFile);

  if (options.validateOnly) {
    console.log('Audit report schema valid.');
    return;
  }

  if (Boolean(options.auditFile) !== Boolean(options.prodAuditFile)) {
    throw new Error('--audit-file and --prod-audit-file must be provided together');
  }

  const prodReport = readAuditReport(options.prodAuditFile, { productionOnly: true });
  const allowlist = loadAllowlist(options.allowlistPath);
  const fullFindings = normalizeFindings(report, runtimeDeps, devDeps);
  const productionFindings = normalizeFindings(prodReport, runtimeDeps, devDeps);
  const findings = mergeProductionScope(fullFindings, productionFindings);
  const { allowed, blockedNew, blockedExpired, blockedPolicy, staleExpiredEntries } =
    evaluateFindings(findings, allowlist);

  const scopeSummary = summarizeScopes(findings);

  const totalMeta = report?.metadata?.vulnerabilities || {};
  const high = totalMeta.high ?? findings.filter((v) => v.severity === 'high').length;
  const critical = totalMeta.critical ?? findings.filter((v) => v.severity === 'critical').length;

  console.log('=== Security Gate (Level 4 / Plan C) ===');
  console.log(`Allowlist: ${options.allowlistPath}`);
  console.log(
    `Audit counts: info=${totalMeta.info ?? 0}, low=${totalMeta.low ?? 0}, moderate=${totalMeta.moderate ?? 0}, high=${high}, critical=${critical}`
  );
  console.log(
    `High/Critical scope split: runtime=${scopeSummary.runtime}, dev=${scopeSummary.dev}, mixed=${scopeSummary.mixed}, unknown=${scopeSummary.unknown}`
  );

  if (allowed.length > 0) {
    console.log('\n✅ Temporarily allowlisted high/critical findings');
    for (const item of allowed) {
      console.log(`${formatVulnerability(item.vulnerability)}`);
      console.log(
        `  ↳ allowlist#${item.entry._index} expires=${item.entry.expiresAt} (in ~${item.daysLeft}d) reason=${item.entry.reason}`
      );
    }
  }

  if (blockedPolicy.length > 0) {
    console.log('\n❌ Allowlist policy violations (expiry too far)');
    for (const item of blockedPolicy) {
      console.log(`${formatVulnerability(item.vulnerability)}`);
      console.log(
        `  ↳ allowlist#${item.entry._index} expires=${item.entry.expiresAt} (~${item.daysLeft}d), max=${item.maxDays}d for scope=${item.vulnerability.scope}`
      );
    }
  }

  if (blockedExpired.length > 0) {
    console.log('\n❌ Expired allowlist entries (no longer valid)');
    for (const item of blockedExpired) {
      console.log(`${formatVulnerability(item.vulnerability)}`);
      for (const entry of item.entries) {
        console.log(
          `  ↳ allowlist#${entry._index} expired=${entry.expiresAt} reason=${entry.reason}`
        );
      }
    }
  }

  if (blockedNew.length > 0) {
    console.log('\n❌ New high/critical findings (not allowlisted)');
    for (const vuln of blockedNew) {
      console.log(formatVulnerability(vuln));
    }
  }

  if (staleExpiredEntries.length > 0) {
    console.log('\n⚠️  Expired allowlist entries to clean up (currently not matched):');
    for (const entry of staleExpiredEntries) {
      console.log(
        `- allowlist#${entry._index}: ${entry.name || 'n/a'} id=${entry.id || 'n/a'} expired=${entry.expiresAt}`
      );
    }
  }

  const blockingCount = blockedNew.length + blockedExpired.length + blockedPolicy.length;

  if (blockingCount > 0) {
    console.log(`\nSECURITY GATE: FAIL (${blockingCount} blocking finding(s))`);
    process.exit(1);
  }

  console.log('\nSECURITY GATE: PASS (no new high/critical findings outside valid allowlist)');
}

export {
  parseArgs,
  selectAuditSchema,
  validateAuditReport,
  readAuditReport,
  parseLegacyRoot,
  parseNodeModulesRoot,
  classifyScope,
  normalizeFromAdvisories,
  normalizeFromV2,
  normalizeFindings,
  findingsMatch,
  mergeProductionScope,
  loadAllowlist,
  entryMatchesVulnerability,
  summarizeScopes,
  formatVulnerability,
  evaluateFindings,
  MAX_ALLOWLIST_DAYS,
  MS_PER_DAY,
};

if (__isCli) {
  try {
    main();
  } catch (error) {
    console.error(`Security gate error: ${error.message}`);
    process.exit(2);
  }
}
