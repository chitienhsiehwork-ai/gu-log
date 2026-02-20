#!/usr/bin/env node
/* global console, process */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allowlist' && argv[i + 1]) {
      options.allowlistPath = toAbsolutePath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--audit-file' && argv[i + 1]) {
      options.auditFile = toAbsolutePath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/security-gate.mjs [options]\n\nOptions:\n  --allowlist <path>  Allowlist path (default: quality/security-allowlist.json)\n  --audit-file <path> Read audit JSON from file (default: run "pnpm audit --json")\n  -h, --help          Show help\n`);
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }

  return options;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readAuditReport(auditFile) {
  if (auditFile) {
    if (!existsSync(auditFile)) {
      throw new Error(`Audit file not found: ${auditFile}`);
    }
    return loadJson(auditFile);
  }

  const auditCommand = existsSync(join(ROOT, 'package-lock.json'))
    ? 'npm audit --json'
    : 'pnpm audit --json';

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

  return JSON.parse(raw);
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
        ...new Set((advisory.findings || []).flatMap((finding) => finding.paths || []).filter(Boolean)),
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

      const rootsFromNodes = [...new Set((vuln.nodes || []).map(parseNodeModulesRoot).filter(Boolean))];
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
  if (report?.advisories && Object.keys(report.advisories).length > 0) {
    return normalizeFromAdvisories(report, deps, devDeps);
  }
  return normalizeFromV2(report, deps, devDeps);
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = loadJson(join(ROOT, 'package.json'));
  const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
  const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

  const report = readAuditReport(options.auditFile);
  const allowlist = loadAllowlist(options.allowlistPath);
  const findings = normalizeFindings(report, runtimeDeps, devDeps);

  const now = Date.now();

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

  const scopeSummary = summarizeScopes(findings);

  const totalMeta = report?.metadata?.vulnerabilities || {};
  const high = totalMeta.high ?? findings.filter((v) => v.severity === 'high').length;
  const critical =
    totalMeta.critical ?? findings.filter((v) => v.severity === 'critical').length;

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

  const staleExpiredEntries = allowlist.filter(
    (entry) => entry.expiresMs < now && !usedAllowlistIndexes.has(entry._index)
  );

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

try {
  main();
} catch (error) {
  console.error(`Security gate error: ${error.message}`);
  process.exit(2);
}
