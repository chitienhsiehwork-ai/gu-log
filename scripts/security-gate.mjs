#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parse as parseYaml } from 'yaml';

const __isCli =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_ALLOWLIST_PATH = join(ROOT, 'quality', 'security-allowlist.json');
const NPM_BULK_AUDIT_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const LOCKFILE_PATH = join(ROOT, 'pnpm-lock.yaml');
const BULK_SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const BULK_SUMMARY_SCHEMA_VERSION = 1;

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
    summaryJson: false,
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
    if (arg === '--summary-json') {
      options.summaryJson = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node scripts/security-gate.mjs [options]\n\nOptions:\n  --allowlist <path>       Allowlist path (default: quality/security-allowlist.json)\n  --audit-file <path>      Read full audit JSON from file; use - for stdin\n  --prod-audit-file <path> Read production audit JSON from file\n  --validate-only          Validate --audit-file schema, then exit\n  --summary-json           Print a versioned bulk-advisory summary for history recording\n  -h, --help               Show help\n`
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
  const hasLegacyEntries = hasLegacy && Object.keys(report.advisories || {}).length > 0;
  const hasV2Entries = hasV2 && Object.keys(report.vulnerabilities || {}).length > 0;
  if (hasLegacyEntries && hasV2Entries) {
    throw new Error('Audit report mixes non-empty legacy and v2 vulnerability schemas');
  }
  if (hasLegacyEntries) return 'legacy';
  if (hasV2) return 'v2';
  return 'legacy';
}

function normalizeV2AdvisoryId(source, label) {
  if (typeof source === 'number') {
    if (!Number.isSafeInteger(source) || source <= 0) {
      throw new Error(`${label} must be a positive integer or non-empty string`);
    }
    return String(source);
  }
  if (typeof source === 'string' && source.trim()) {
    return source.trim();
  }
  throw new Error(`${label} must be a positive integer or non-empty string`);
}

function validateLegacyAdvisory(key, advisory, label = `advisories.${key}`) {
  if (!/^[1-9]\d*$/.test(key)) {
    throw new Error(`${label} map key must be a positive integer advisory ID`);
  }
  if (!isPlainObject(advisory)) {
    throw new Error(`${label} must be an object`);
  }

  let entryId;
  if (typeof advisory.id === 'number' && Number.isSafeInteger(advisory.id) && advisory.id > 0) {
    entryId = String(advisory.id);
  } else if (typeof advisory.id === 'string' && /^[1-9]\d*$/.test(advisory.id.trim())) {
    entryId = advisory.id.trim();
  } else {
    throw new Error(`${label}.id must be a positive integer matching its map key`);
  }
  if (entryId !== key) {
    throw new Error(`${label}.id=${entryId} does not match map key ${key}`);
  }
  if (!BULK_SEVERITIES.includes(advisory.severity)) {
    throw new Error(
      `${label}.severity must be one of ${BULK_SEVERITIES.join(', ')}; got ${String(advisory.severity)}`
    );
  }
  if (typeof advisory.module_name !== 'string' || !advisory.module_name.trim()) {
    throw new Error(`${label}.module_name must identify a non-empty package name`);
  }

  return {
    id: key,
    name: advisory.module_name.trim(),
    severity: advisory.severity,
  };
}

function validateV2Vulnerability(name, vulnerability, label = `vulnerabilities.${name}`) {
  if (!isPlainObject(vulnerability)) {
    throw new Error(`${label} must be an object`);
  }

  const severity = vulnerability.severity;
  if (!BULK_SEVERITIES.includes(severity)) {
    throw new Error(
      `${label}.severity must be one of ${BULK_SEVERITIES.join(', ')}; got ${String(severity)}`
    );
  }
  if (!Array.isArray(vulnerability.via)) {
    throw new Error(`${label}.via must be an array`);
  }
  if (vulnerability.via.length === 0) {
    throw new Error(`${label}.via must contain at least one item`);
  }
  if (!Array.isArray(vulnerability.nodes)) {
    throw new Error(`${label}.nodes must be an array`);
  }
  for (const [index, node] of vulnerability.nodes.entries()) {
    if (typeof node !== 'string' || !node.trim()) {
      throw new Error(`${label}.nodes[${index}] must be a non-empty string`);
    }
  }
  if (Object.hasOwn(vulnerability, 'isDirect') && typeof vulnerability.isDirect !== 'boolean') {
    throw new Error(`${label}.isDirect must be a boolean`);
  }

  const seenAdvisoryIds = new Set();
  const via = vulnerability.via.map((item, index) => {
    const itemLabel = `${label}.via[${index}]`;
    if (typeof item === 'string') {
      const dependency = item.trim();
      if (!dependency) {
        throw new Error(`${itemLabel} must be a non-empty meta-vulnerability name`);
      }
      return { kind: 'meta', dependency, severity };
    }
    if (!isPlainObject(item)) {
      throw new Error(`${itemLabel} must be an advisory object or non-empty string`);
    }

    const id = normalizeV2AdvisoryId(item.source, `${itemLabel}.source`);
    if (seenAdvisoryIds.has(id)) {
      throw new Error(`${itemLabel}.source duplicates advisory ${id}`);
    }
    seenAdvisoryIds.add(id);
    if (!BULK_SEVERITIES.includes(item.severity)) {
      throw new Error(
        `${itemLabel}.severity must be one of ${BULK_SEVERITIES.join(', ')}; got ${String(item.severity)}`
      );
    }
    for (const field of ['title', 'url']) {
      if (item[field] !== undefined && typeof item[field] !== 'string') {
        throw new Error(`${itemLabel}.${field} must be a string when present`);
      }
    }
    for (const field of ['name', 'dependency']) {
      if (item[field] === undefined) continue;
      if (typeof item[field] !== 'string' || !item[field].trim()) {
        throw new Error(`${itemLabel}.${field} must be a non-empty string when present`);
      }
      if (item[field].trim() !== name) {
        throw new Error(
          `${itemLabel}.${field}=${item[field].trim()} contradicts outer package ${name}`
        );
      }
    }
    if (item.range !== undefined && (typeof item.range !== 'string' || !item.range.trim())) {
      throw new Error(`${itemLabel}.range must be a non-empty string when present`);
    }

    return {
      kind: 'advisory',
      id,
      severity: item.severity,
      title: item.title || '',
      url: item.url || '',
    };
  });

  const highestViaSeverity = via.reduce((highest, item) => {
    return BULK_SEVERITIES.indexOf(item.severity) > BULK_SEVERITIES.indexOf(highest)
      ? item.severity
      : highest;
  }, 'info');
  if (highestViaSeverity !== severity) {
    throw new Error(
      `${label}.severity=${severity} does not match highest via severity ${highestViaSeverity}`
    );
  }

  return {
    severity,
    via,
    nodes: vulnerability.nodes,
    isDirect: vulnerability.isDirect === true,
  };
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
  const selectedReport = schema === 'legacy' ? report.advisories : report.vulnerabilities;
  const entries = Object.entries(selectedReport);
  const parsedCounts = Object.fromEntries(BULK_SEVERITIES.map((severity) => [severity, 0]));
  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label}.${schema}.${key} must be an object`);
    }
    if (!BULK_SEVERITIES.includes(entry.severity)) {
      throw new Error(
        `${label}.${schema}.${key}.severity must be one of ${BULK_SEVERITIES.join(', ')}; got ${String(entry.severity)}`
      );
    }
    if (schema === 'v2') {
      validateV2Vulnerability(key, entry, `${label}.vulnerabilities.${key}`);
    } else {
      validateLegacyAdvisory(key, entry, `${label}.advisories.${key}`);
    }
    parsedCounts[entry.severity] += 1;
  }

  for (const severity of BULK_SEVERITIES) {
    if (counts[severity] === parsedCounts[severity]) continue;
    if (
      ['high', 'critical'].includes(severity) &&
      counts[severity] > 0 &&
      parsedCounts[severity] === 0
    ) {
      throw new Error(`${label} reports high/critical counts but no matching findings`);
    }
    if (
      ['high', 'critical'].includes(severity) &&
      counts[severity] === 0 &&
      parsedCounts[severity] > 0
    ) {
      throw new Error(`${label} contains high/critical findings but metadata reports none`);
    }
    throw new Error(
      `${label} metadata.vulnerabilities.${severity}=${counts[severity]} does not match ${parsedCounts[severity]} ${severity} finding(s)`
    );
  }

  return report;
}

function readAuditReport(auditFile, { productionOnly = false } = {}) {
  const label = productionOnly ? 'Production audit report' : 'Full audit report';
  if (!auditFile) {
    throw new Error(`${label} file is required`);
  }
  if (auditFile !== '-' && !existsSync(auditFile)) {
    throw new Error(`Audit file not found: ${auditFile}`);
  }
  return validateAuditReport(loadJson(auditFile), label);
}

function decodeAuditBody(input, label = 'Audit response') {
  const wire = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let body = wire;
  if (wire[0] === 0x1f && wire[1] === 0x8b) {
    try {
      body = gunzipSync(wire);
    } catch (error) {
      throw new Error(`${label} contained invalid gzip: ${error.message}`);
    }
  }

  try {
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} did not contain valid JSON: ${error.message}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseLockPackageKey(packageKey, label = 'lockfile package key') {
  if (typeof packageKey !== 'string' || !packageKey) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const separator = packageKey.startsWith('@')
    ? packageKey.indexOf('@', packageKey.indexOf('/') + 1)
    : packageKey.indexOf('@');
  if (separator <= 0 || separator === packageKey.length - 1) {
    throw new Error(`${label} is unsupported: ${packageKey}`);
  }

  const name = packageKey.slice(0, separator);
  const resolved = packageKey.slice(separator + 1);
  if (resolved.includes('(patch_hash=')) {
    throw new Error(`${label} uses unsupported patched dependency identity: ${packageKey}`);
  }
  const version = resolved.split('(')[0];
  if (!name || !/^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${label} is not an auditable registry package: ${packageKey}`);
  }
  return { name, version, packageKey: `${name}@${version}` };
}

function validateRootImporterGroup(packageJson, importer, group, rootOverrides = {}) {
  const manifestDependencies = packageJson[group] || {};
  const lockedDependencies = importer[group] || {};
  if (!isPlainObject(manifestDependencies) || !isPlainObject(lockedDependencies)) {
    throw new Error(`package.json/pnpm-lock.yaml ${group} must be objects`);
  }

  const manifestNames = Object.keys(manifestDependencies).sort();
  const lockedNames = Object.keys(lockedDependencies).sort();
  if (JSON.stringify(manifestNames) !== JSON.stringify(lockedNames)) {
    throw new Error(
      `pnpm-lock.yaml importer ${group} does not match package.json (${manifestNames.join(', ') || 'empty'} vs ${lockedNames.join(', ') || 'empty'})`
    );
  }

  return manifestNames.map((name) => {
    const manifestSpecifier = manifestDependencies[name];
    const effectiveSpecifier = rootOverrides[name] ?? manifestSpecifier;
    const locked = lockedDependencies[name];
    if (!isPlainObject(locked)) {
      throw new Error(`pnpm-lock.yaml importer ${group}.${name} must contain specifier/version`);
    }
    if (locked.specifier !== effectiveSpecifier) {
      throw new Error(
        `${name} specifier ${String(locked.specifier)} in pnpm-lock.yaml does not match package.json effective specifier ${String(effectiveSpecifier)}`
      );
    }
    if (typeof locked.version !== 'string' || !locked.version) {
      throw new Error(`pnpm-lock.yaml importer ${group}.${name} is missing resolved version`);
    }
    if (/^(?:file|link|workspace|git|https?):/.test(locked.version)) {
      throw new Error(
        `pnpm-lock.yaml importer ${group}.${name} uses unsupported non-registry resolution ${locked.version}`
      );
    }
    return `${name}@${locked.version}`;
  });
}

function addRequestVersion(versionsByName, packageKey, label) {
  const { name, version } = parseLockPackageKey(packageKey, label);
  if (!versionsByName.has(name)) versionsByName.set(name, new Set());
  versionsByName.get(name).add(version);
}

function requestFromVersions(versionsByName) {
  return Object.fromEntries(
    [...versionsByName.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()])
  );
}

function walkLockfileGraph(rootKeys, lockfile, label) {
  const packages = lockfile.packages;
  const snapshots = lockfile.snapshots;
  const visited = new Set();
  const versionsByName = new Map();
  const queue = [...rootKeys];

  while (queue.length > 0) {
    const snapshotKey = queue.shift();
    if (visited.has(snapshotKey)) continue;
    visited.add(snapshotKey);

    const { name, version, packageKey } = parseLockPackageKey(snapshotKey, `${label} dependency`);
    if (!Object.hasOwn(packages, packageKey)) {
      throw new Error(`${snapshotKey} is missing from pnpm-lock.yaml packages`);
    }
    const lockedPackage = packages[packageKey];
    if (
      !isPlainObject(lockedPackage) ||
      !isPlainObject(lockedPackage.resolution) ||
      typeof lockedPackage.resolution.integrity !== 'string' ||
      !/^sha(?:256|384|512)-\S+$/.test(lockedPackage.resolution.integrity)
    ) {
      throw new Error(`${packageKey} is missing a valid pnpm-lock.yaml resolution.integrity`);
    }
    const unsupportedResolutionFields = Object.keys(lockedPackage.resolution).filter(
      (field) => field !== 'integrity'
    );
    if (unsupportedResolutionFields.length > 0) {
      throw new Error(
        `${packageKey} uses unsupported non-registry resolution field(s): ${unsupportedResolutionFields.join(', ')}`
      );
    }
    if (lockedPackage.name !== undefined && lockedPackage.name !== name) {
      throw new Error(
        `${packageKey} package name ${String(lockedPackage.name)} does not match its lockfile key`
      );
    }
    if (lockedPackage.version !== undefined && lockedPackage.version !== version) {
      throw new Error(
        `${packageKey} package version ${String(lockedPackage.version)} does not match its lockfile key`
      );
    }
    if (lockedPackage.id !== undefined) {
      throw new Error(`${packageKey} uses unsupported package identity field id`);
    }
    if (!Object.hasOwn(snapshots, snapshotKey)) {
      throw new Error(`${snapshotKey} is missing from pnpm-lock.yaml snapshots`);
    }
    const snapshot = snapshots[snapshotKey];
    if (!isPlainObject(snapshot)) {
      throw new Error(`pnpm-lock.yaml snapshot ${snapshotKey} must be an object`);
    }
    addRequestVersion(versionsByName, snapshotKey, `${label} dependency`);

    for (const group of ['dependencies', 'optionalDependencies']) {
      const dependencies = snapshot[group] || {};
      if (!isPlainObject(dependencies)) {
        throw new Error(`pnpm-lock.yaml snapshot ${snapshotKey}.${group} must be an object`);
      }
      for (const [name, reference] of Object.entries(dependencies)) {
        if (typeof reference !== 'string' || !reference) {
          throw new Error(
            `pnpm-lock.yaml snapshot ${snapshotKey}.${group}.${name} must be a resolved version`
          );
        }
        if (/^(?:file|link|workspace|git|https?|npm):/.test(reference)) {
          throw new Error(
            `pnpm-lock.yaml snapshot ${snapshotKey}.${group}.${name} uses unsupported resolution ${reference}`
          );
        }
        queue.push(`${name}@${reference}`);
      }
    }
  }

  return { visited, request: requestFromVersions(versionsByName) };
}

function validateAuditRequest(request, label = 'Audit request') {
  if (!isPlainObject(request)) {
    throw new Error(`${label} must be an object keyed by package name`);
  }
  for (const [name, versions] of Object.entries(request)) {
    if (!name || !Array.isArray(versions) || versions.length === 0) {
      throw new Error(`${label}.${name || '(empty)'} must contain resolved versions`);
    }
    const seen = new Set();
    for (const version of versions) {
      if (
        typeof version !== 'string' ||
        !/^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
      ) {
        throw new Error(`${label}.${name} contains invalid version ${String(version)}`);
      }
      if (seen.has(version)) {
        throw new Error(`${label}.${name} contains duplicate version ${version}`);
      }
      seen.add(version);
    }
  }
  return request;
}

function validateAuditRequestPair(fullRequest, productionRequest) {
  validateAuditRequest(fullRequest, 'Full audit request');
  validateAuditRequest(productionRequest, 'Production audit request');
  for (const [name, versions] of Object.entries(productionRequest)) {
    const fullVersions = new Set(fullRequest[name] || []);
    for (const version of versions) {
      if (!fullVersions.has(version)) {
        throw new Error(
          `Production audit request ${name}@${version} is missing from full audit request`
        );
      }
    }
  }
}

function buildLockfileAuditRequests(packageJson, lockfile) {
  if (!isPlainObject(packageJson)) {
    throw new Error('package.json must be an object');
  }
  if (!isPlainObject(lockfile) || !/^9(?:\.|$)/.test(String(lockfile.lockfileVersion))) {
    throw new Error(`Unsupported pnpm lockfile version: ${String(lockfile?.lockfileVersion)}`);
  }
  if (
    !isPlainObject(lockfile.importers) ||
    !isPlainObject(lockfile.importers['.']) ||
    !isPlainObject(lockfile.packages) ||
    !isPlainObject(lockfile.snapshots)
  ) {
    throw new Error('pnpm-lock.yaml is missing root importer/packages/snapshots');
  }

  const importer = lockfile.importers['.'];
  const packagePatchedDependencies = packageJson.pnpm?.patchedDependencies || {};
  const lockfilePatchedDependencies = lockfile.patchedDependencies || {};
  if (!isPlainObject(packagePatchedDependencies) || !isPlainObject(lockfilePatchedDependencies)) {
    throw new Error(
      'package.json pnpm.patchedDependencies and pnpm-lock.yaml patchedDependencies must be objects'
    );
  }
  if (
    Object.keys(packagePatchedDependencies).length > 0 ||
    Object.keys(lockfilePatchedDependencies).length > 0
  ) {
    throw new Error('Patched dependencies are unsupported by the registry-artifact audit contract');
  }
  const packageOverrides = packageJson.pnpm?.overrides || {};
  const lockfileOverrides = lockfile.overrides || {};
  if (!isPlainObject(packageOverrides) || !isPlainObject(lockfileOverrides)) {
    throw new Error('package.json pnpm.overrides and pnpm-lock.yaml overrides must be objects');
  }
  const normalizeOverrides = (overrides) =>
    Object.fromEntries(
      Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
    );
  if (
    JSON.stringify(normalizeOverrides(packageOverrides)) !==
    JSON.stringify(normalizeOverrides(lockfileOverrides))
  ) {
    throw new Error('pnpm-lock.yaml overrides do not match package.json pnpm.overrides');
  }
  const runtimeRoots = [
    ...validateRootImporterGroup(packageJson, importer, 'dependencies', packageOverrides),
    ...validateRootImporterGroup(packageJson, importer, 'optionalDependencies', packageOverrides),
  ];
  const devRoots = validateRootImporterGroup(
    packageJson,
    importer,
    'devDependencies',
    packageOverrides
  );
  const runtime = walkLockfileGraph(runtimeRoots, lockfile, 'runtime');
  const dev = walkLockfileGraph(devRoots, lockfile, 'development');
  const full = walkLockfileGraph([...runtimeRoots, ...devRoots], lockfile, 'full');
  for (const packageKey of Object.keys(lockfile.packages)) {
    const { name, version } = parseLockPackageKey(packageKey);
    if (!full.request[name]?.includes(version)) {
      throw new Error(
        `pnpm-lock.yaml package ${packageKey} is unreachable from the root importer; refusing an incomplete audit request`
      );
    }
  }

  const scopesByPackageVersion = {};
  const scopeCeilingByName = {};
  for (const [name, versions] of Object.entries(full.request)) {
    const runtimeVersions = new Set(runtime.request[name] || []);
    const devVersions = new Set(dev.request[name] || []);
    scopeCeilingByName[name] =
      runtimeVersions.size > 0 && devVersions.size > 0
        ? 'mixed'
        : runtimeVersions.size > 0
          ? 'runtime'
          : 'dev';
    for (const version of versions) {
      const runtimeReachable = runtimeVersions.has(version);
      const devReachable = devVersions.has(version);
      scopesByPackageVersion[`${name}@${version}`] =
        runtimeReachable && devReachable ? 'mixed' : runtimeReachable ? 'runtime' : 'dev';
    }
  }

  validateAuditRequestPair(full.request, runtime.request);
  validateAuditRequestPair(full.request, dev.request);
  return {
    fullRequest: full.request,
    productionRequest: runtime.request,
    developmentRequest: dev.request,
    scopesByPackageVersion,
    scopeCeilingByName,
  };
}

function readLockfileAuditRequests() {
  if (!existsSync(LOCKFILE_PATH)) {
    throw new Error(`Lockfile not found: ${LOCKFILE_PATH}`);
  }
  let lockfile;
  try {
    lockfile = parseYaml(readFileSync(LOCKFILE_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse pnpm-lock.yaml: ${error.message}`);
  }
  return buildLockfileAuditRequests(loadJson(join(ROOT, 'package.json')), lockfile);
}

function validateBulkAdvisory(advisory, label) {
  if (!isPlainObject(advisory)) {
    throw new Error(`${label} must be an object`);
  }
  if (!(
    (Number.isInteger(advisory.id) && advisory.id > 0) ||
    (typeof advisory.id === 'string' && advisory.id.trim())
  )) {
    throw new Error(`${label}.id must be a positive integer or non-empty string`);
  }
  for (const field of ['url', 'title', 'vulnerable_versions']) {
    if (typeof advisory[field] !== 'string' || !advisory[field].trim()) {
      throw new Error(`${label}.${field} must be a non-empty string`);
    }
  }
  if (!BULK_SEVERITIES.includes(advisory.severity)) {
    throw new Error(
      `${label}.severity must be one of ${BULK_SEVERITIES.join(', ')}; got ${String(advisory.severity)}`
    );
  }
  if (
    !Array.isArray(advisory.cwe) ||
    advisory.cwe.some((value) => typeof value !== 'string' || !value)
  ) {
    throw new Error(`${label}.cwe must be an array of non-empty strings`);
  }
  if (
    !isPlainObject(advisory.cvss) ||
    typeof advisory.cvss.score !== 'number' ||
    !Number.isFinite(advisory.cvss.score) ||
    advisory.cvss.score < 0 ||
    advisory.cvss.score > 10 ||
    !(advisory.cvss.vectorString === null || typeof advisory.cvss.vectorString === 'string')
  ) {
    throw new Error(`${label}.cvss must contain score 0..10 and string/null vectorString`);
  }
  return advisory;
}

function validateBulkAuditReport(report, request, label = 'Bulk audit response') {
  if (!isPlainObject(report)) {
    throw new Error(`${label} must be an object keyed by package name`);
  }
  validateAuditRequest(request, `${label} request`);

  for (const [name, advisories] of Object.entries(report)) {
    if (!Object.hasOwn(request, name)) {
      throw new Error(`${label}.${name} was not present in its audit request`);
    }
    if (!Array.isArray(advisories)) {
      throw new Error(`${label}.${name} must be an advisory array`);
    }
    const advisoryIds = new Set();
    advisories.forEach((advisory, index) => {
      validateBulkAdvisory(advisory, `${label}.${name}[${index}]`);
      const id = String(advisory.id);
      if (advisoryIds.has(id)) {
        throw new Error(`${label}.${name} contains duplicate advisory id ${id}`);
      }
      advisoryIds.add(id);
    });
  }
  return report;
}

async function fetchBulkAudit(request, label, fetchImpl = globalThis.fetch) {
  validateAuditRequest(request, `${label} request`);
  const response = await fetchImpl(NPM_BULK_AUDIT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const wire = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const errorBody = wire.toString('utf8').slice(0, 500);
    throw new Error(`${label} returned HTTP ${response.status}: ${errorBody}`);
  }

  return validateBulkAuditReport(decodeAuditBody(wire, label), request, label);
}

/*
 * The bulk endpoint reports advisory IDs per package, not dependency paths.
 * Exact per-advisory scope would require parsing the endpoint's semver range.
 * Use the package name's highest lockfile reachability instead: any package name
 * reachable from both graphs is conservatively mixed, even if the advisory only
 * affects a development-only version. This may shorten an allowlist window, but
 * it cannot downgrade a runtime finding to development-only.
 */
function normalizeBulkAuditFindings(fullReport, scopeCeilingByName) {
  if (!isPlainObject(scopeCeilingByName)) {
    throw new Error('Bulk audit scope ceiling must be an object keyed by package name');
  }

  return Object.entries(fullReport)
    .flatMap(([name, advisories]) => {
      const scope = scopeCeilingByName[name];
      if (!['runtime', 'dev', 'mixed'].includes(scope)) {
        throw new Error(`Bulk audit package ${name} is missing a validated lockfile scope ceiling`);
      }
      return advisories
        .filter((advisory) =>
          ['high', 'critical'].includes((advisory?.severity || '').toLowerCase())
        )
        .map((advisory) => {
          const id = advisory?.id != null ? String(advisory.id) : null;
          return {
            id,
            ids: id ? [id] : [],
            name,
            severity: advisory.severity.toLowerCase(),
            title: advisory.title || '',
            url: advisory.url || '',
            scope,
            roots: [name],
            paths: [],
          };
        });
    })
    .sort((left, right) => `${left.name}:${left.id}`.localeCompare(`${right.name}:${right.id}`));
}

function summarizeBulkAdvisories(report) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  if (!isPlainObject(report)) {
    throw new Error('Bulk advisory summary input must be an object');
  }
  for (const [name, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) {
      throw new Error(`Bulk advisory summary input.${name} must be an advisory array`);
    }
    for (const [index, advisory] of advisories.entries()) {
      validateBulkAdvisory(advisory, `Bulk advisory summary input.${name}[${index}]`);
      counts[advisory.severity] += 1;
    }
  }
  return counts;
}

function buildBulkAuditSummary(report) {
  const severities = summarizeBulkAdvisories(report);
  return {
    schemaVersion: BULK_SUMMARY_SCHEMA_VERSION,
    producer: 'npm-bulk-advisory',
    dependencySource: 'pnpm-lock.yaml',
    unit: 'advisory-record',
    severities,
    total: Object.values(severities).reduce((sum, value) => sum + value, 0),
  };
}

async function readLiveAuditFindings() {
  const { fullRequest, scopeCeilingByName } = readLockfileAuditRequests();
  const fullReport = await fetchBulkAudit(fullRequest, 'Full bulk audit response');
  const summary = buildBulkAuditSummary(fullReport);
  return {
    findings: normalizeBulkAuditFindings(fullReport, scopeCeilingByName),
    totalMeta: summary.severities,
    summary,
  };
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

function isBlockingSeverity(severity) {
  return ['high', 'critical'].includes(severity);
}

function normalizeFromAdvisories(report, deps, devDeps, { includeAllSeverities = false } = {}) {
  if (!isPlainObject(report?.advisories)) {
    throw new Error('advisories must be an object');
  }

  return Object.entries(report.advisories).flatMap(([key, advisory]) => {
    const validated = validateLegacyAdvisory(key, advisory);
    if (!includeAllSeverities && !isBlockingSeverity(validated.severity)) return [];

    const paths = [
      ...new Set(
        (advisory.findings || []).flatMap((finding) => finding.paths || []).filter(Boolean)
      ),
    ];
    const roots = [...new Set(paths.map(parseLegacyRoot).filter(Boolean))];
    const scope = classifyScope(roots, deps, devDeps);

    return [
      {
        id: validated.id,
        ids: [validated.id],
        name: validated.name,
        severity: validated.severity,
        title: advisory.title || '',
        url: advisory.url || '',
        scope,
        roots,
        paths,
      },
    ];
  });
}

function normalizeFromV2(report, deps, devDeps, { includeAllSeverities = false } = {}) {
  if (!isPlainObject(report?.vulnerabilities)) {
    throw new Error('vulnerabilities must be an object');
  }

  return Object.entries(report.vulnerabilities).flatMap(([name, vuln]) => {
    const validated = validateV2Vulnerability(name, vuln);

    const rootsFromNodes = [...new Set(validated.nodes.map(parseNodeModulesRoot).filter(Boolean))];
    const roots = [...rootsFromNodes];

    if (roots.length === 0 && validated.isDirect) {
      roots.push(name);
    }

    const scope = classifyScope(roots, deps, devDeps);
    const baseFinding = {
      name,
      scope,
      roots,
      paths: validated.nodes,
    };

    return validated.via.flatMap((item) => {
      if (!includeAllSeverities && !isBlockingSeverity(item.severity)) return [];
      if (item.kind === 'meta') {
        return [
          {
            ...baseFinding,
            id: null,
            ids: [],
            severity: item.severity,
            title: '',
            url: '',
            via: item.dependency,
          },
        ];
      }
      return [
        {
          ...baseFinding,
          id: item.id,
          ids: [item.id],
          severity: item.severity,
          title: item.title,
          url: item.url,
        },
      ];
    });
  });
}

function normalizeFindings(report, deps, devDeps, options = {}) {
  if (selectAuditSchema(report) === 'legacy') {
    return normalizeFromAdvisories(report, deps, devDeps, options);
  }
  return normalizeFromV2(report, deps, devDeps, options);
}

function findingsMatch(left, right) {
  if (left.name !== right.name) return false;

  const leftIds = new Set([left.id, ...(left.ids || [])].filter(Boolean));
  const rightIds = new Set([right.id, ...(right.ids || [])].filter(Boolean));
  if (leftIds.size > 0 || rightIds.size > 0) {
    if (leftIds.size !== rightIds.size) return false;
    return [...leftIds].every((id) => rightIds.has(id));
  }
  if (left.name === 'unknown-module') return false;
  if (left.via !== undefined || right.via !== undefined) {
    return typeof left.via === 'string' && typeof right.via === 'string' && left.via === right.via;
  }
  return true;
}

function assertMatchingSeverity(fullFinding, productionFinding) {
  if (
    !BULK_SEVERITIES.includes(fullFinding.severity) ||
    !BULK_SEVERITIES.includes(productionFinding.severity)
  ) {
    throw new Error(
      `Audit identity ${fullFinding.name} has invalid full/production severity metadata`
    );
  }
  if (fullFinding.severity !== productionFinding.severity) {
    const ids = [...new Set([fullFinding.id, ...(fullFinding.ids || [])].filter(Boolean))];
    throw new Error(
      `${fullFinding.name} advisory ${ids.join(', ') || 'ID-less'} severity mismatch: full=${fullFinding.severity}, production=${productionFinding.severity}`
    );
  }
}

function mergeProductionScope(fullFindings, productionFindings) {
  const merged = fullFindings.map((finding) => {
    const matches = productionFindings.filter((production) => findingsMatch(finding, production));
    if (matches.length === 0) {
      return { ...finding };
    }
    for (const production of matches) {
      assertMatchingSeverity(finding, production);
    }
    return {
      ...finding,
      scope: finding.scope === 'dev' || finding.scope === 'mixed' ? 'mixed' : 'runtime',
    };
  });

  for (const production of productionFindings) {
    const existing = merged.find((finding) => findingsMatch(finding, production));
    if (existing) {
      assertMatchingSeverity(existing, production);
    } else {
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
  const ids = new Set(vulnerability.ids || []);
  if (vulnerability.id) ids.add(vulnerability.id);

  if (ids.size > 0) {
    if (!entry.id) return false;
    if (!ids.has(entry.id)) return false;
  } else if (entry.id) {
    return false;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = loadJson(join(ROOT, 'package.json'));
  const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
  const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

  if (options.summaryJson) {
    if (options.auditFile || options.prodAuditFile || options.validateOnly) {
      throw new Error('--summary-json cannot be combined with audit-file or validate-only options');
    }
    const { summary } = await readLiveAuditFindings();
    console.log(JSON.stringify(summary));
    return;
  }

  if (options.validateOnly) {
    if (!options.auditFile) {
      throw new Error('--validate-only requires --audit-file');
    }
    readAuditReport(options.auditFile);
    console.log('Audit report schema valid.');
    return;
  }

  if (Boolean(options.auditFile) !== Boolean(options.prodAuditFile)) {
    throw new Error('--audit-file and --prod-audit-file must be provided together');
  }

  const allowlist = loadAllowlist(options.allowlistPath);
  let findings;
  let totalMeta;
  if (options.auditFile) {
    const report = readAuditReport(options.auditFile);
    const prodReport = readAuditReport(options.prodAuditFile, { productionOnly: true });
    const fullFindings = normalizeFindings(report, runtimeDeps, devDeps, {
      includeAllSeverities: true,
    });
    const productionFindings = normalizeFindings(prodReport, runtimeDeps, devDeps, {
      includeAllSeverities: true,
    });
    findings = mergeProductionScope(fullFindings, productionFindings).filter((finding) =>
      isBlockingSeverity(finding.severity)
    );
    totalMeta = report?.metadata?.vulnerabilities || {};
  } else {
    ({ findings, totalMeta } = await readLiveAuditFindings());
  }
  const { allowed, blockedNew, blockedExpired, blockedPolicy, staleExpiredEntries } =
    evaluateFindings(findings, allowlist);

  const scopeSummary = summarizeScopes(findings);

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
  decodeAuditBody,
  parseLockPackageKey,
  validateRootImporterGroup,
  validateAuditRequest,
  validateAuditRequestPair,
  buildLockfileAuditRequests,
  readLockfileAuditRequests,
  validateBulkAdvisory,
  validateBulkAuditReport,
  fetchBulkAudit,
  normalizeBulkAuditFindings,
  summarizeBulkAdvisories,
  buildBulkAuditSummary,
  readLiveAuditFindings,
  NPM_BULK_AUDIT_URL,
  BULK_SUMMARY_SCHEMA_VERSION,
};

if (__isCli) {
  main().catch((error) => {
    console.error(`Security gate error: ${error.message}`);
    process.exit(2);
  });
}
