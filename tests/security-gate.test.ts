/**
 * Unit tests for scripts/security-gate.mjs
 *
 * Pin the parsing of npm/pnpm audit reports (legacy advisories AND v2
 * vulnerabilities), allowlist validation, expiry-policy enforcement,
 * and scope classification. False classification = ship known vulns or
 * stuck CI.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as sgModule from '../scripts/security-gate.mjs';

// Per-suite tmpdir; CodeQL js/path-injection-clean (mkdtempSync is a safe origin).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gusg-'));
const tmpPath = (name: string) => path.join(TMP, path.basename(name));

// security-gate.mjs is plain JS without .d.ts; widen to any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sg = sgModule as any;

const {
  parseArgs,
  selectAuditSchema,
  validateAuditReport,
  parseLegacyRoot,
  parseNodeModulesRoot,
  classifyScope,
  normalizeFromAdvisories,
  normalizeFromV2,
  normalizeFindings,
  mergeProductionScope,
  loadAllowlist,
  entryMatchesVulnerability,
  summarizeScopes,
  formatVulnerability,
  evaluateFindings,
  MAX_ALLOWLIST_DAYS,
  MS_PER_DAY,
  decodeAuditBody,
  fetchBulkAudit,
  normalizeBulkAuditFindings,
  buildLockfileAuditRequests,
  readLockfileAuditRequests,
  validateAuditRequestPair,
  buildBulkAuditSummary,
  readLiveAuditFindings,
} = sg;

const bulkAdvisory = (
  id: number,
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical' = 'high'
) => ({
  id,
  url: `https://github.com/advisories/GHSA-test-${id}`,
  title: `Test advisory ${id}`,
  severity,
  vulnerable_versions: '<=1.0.0',
  cwe: ['CWE-79'],
  cvss: {
    score: severity === 'critical' ? 9.8 : 7.5,
    vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  },
});

const v2Advisory = (
  source: number,
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical' = 'high',
  overrides: Record<string, unknown> = {}
) => ({
  source,
  title: `Test advisory ${source}`,
  url: `https://github.com/advisories/GHSA-v2-${source}`,
  severity,
  range: '<=1.0.0',
  ...overrides,
});

describe('parseArgs', () => {
  it('returns defaults', () => {
    const o = parseArgs([]);
    expect(o.allowlistPath).toMatch(/security-allowlist\.json$/);
    expect(o.auditFile).toBeNull();
    expect(o.prodAuditFile).toBeNull();
    expect(o.validateOnly).toBe(false);
    expect(o.summaryJson).toBe(false);
  });

  it('overrides allowlist path (absolute)', () => {
    const o = parseArgs(['--allowlist', '/abs/list.json']);
    expect(o.allowlistPath).toBe('/abs/list.json');
  });

  it('takes audit-file', () => {
    const o = parseArgs([
      '--audit-file',
      '/x/audit.json',
      '--prod-audit-file',
      '/x/prod-audit.json',
      '--validate-only',
    ]);
    expect(o.auditFile).toBe('/x/audit.json');
    expect(o.prodAuditFile).toBe('/x/prod-audit.json');
    expect(o.validateOnly).toBe(true);
  });

  it('preserves stdin marker for validation', () => {
    expect(parseArgs(['--audit-file', '-']).auditFile).toBe('-');
  });

  it('enables live summary JSON mode', () => {
    expect(parseArgs(['--summary-json']).summaryJson).toBe(true);
  });
});

describe('validateAuditReport', () => {
  const metadata = {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  };

  it('accepts clean legacy and v2 schemas', () => {
    expect(validateAuditReport({ advisories: {}, metadata })).toBeTruthy();
    expect(validateAuditReport({ vulnerabilities: {}, metadata })).toBeTruthy();
  });

  it('uses v2 when a hybrid report has empty legacy advisories', () => {
    const report = {
      advisories: {},
      vulnerabilities: {
        foo: { severity: 'high', via: [v2Advisory(1)], nodes: ['node_modules/foo'] },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
      },
    };
    expect(selectAuditSchema(report)).toBe('v2');
    expect(validateAuditReport(report)).toBe(report);
  });

  it('accepts a string meta-vulnerability with a valid nodes array', () => {
    const report = {
      vulnerabilities: {
        foo: {
          severity: 'high',
          via: ['upstream-package'],
          nodes: ['node_modules/foo'],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
      },
    };

    expect(validateAuditReport(report)).toBe(report);
  });

  it('rejects v2 via and nodes containers that are not arrays', () => {
    const metadataWithHigh = {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    };
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: { severity: 'high', via: v2Advisory(1), nodes: ['node_modules/foo'] },
        },
        metadata: metadataWithHigh,
      })
    ).toThrow(/vulnerabilities\.foo\.via must be an array/i);
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: { severity: 'high', via: [v2Advisory(1)], nodes: 'node_modules/foo' },
        },
        metadata: metadataWithHigh,
      })
    ).toThrow(/vulnerabilities\.foo\.nodes must be an array/i);
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: { severity: 'high', via: [], nodes: ['node_modules/foo'] },
        },
        metadata: metadataWithHigh,
      })
    ).toThrow(/vulnerabilities\.foo\.via must contain at least one item/i);
  });

  it.each([
    ['null', null],
    ['number', 42],
    ['empty string', ''],
    ['object missing source', { severity: 'high' }],
    ['object with malformed source', { ...v2Advisory(1), source: { nested: 1 } }],
    ['object missing severity', { ...v2Advisory(1), severity: undefined }],
    ['object with unknown severity', { ...v2Advisory(1), severity: 'urgent' }],
  ])('rejects malformed v2 via item: %s', (_label, item) => {
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: { severity: 'high', via: [item], nodes: ['node_modules/foo'] },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(/vulnerabilities\.foo\.via\[0\]/i);
  });

  it('rejects malformed v2 node entries', () => {
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: { severity: 'high', via: [v2Advisory(1)], nodes: ['node_modules/foo', 42] },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(/vulnerabilities\.foo\.nodes\[1\]/i);
  });

  it.each([
    ['name', { name: 'other-package' }],
    ['dependency', { dependency: 'other-package' }],
  ])('rejects v2 advisory %s that contradicts the outer package key', (field, override) => {
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: {
            severity: 'high',
            via: [v2Advisory(1, 'high', override)],
            nodes: ['node_modules/foo'],
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(new RegExp(`vulnerabilities\\.foo\\.via\\[0\\]\\.${field}.*outer package`, 'i'));
  });

  it.each([42, ''])('rejects malformed v2 advisory range %j', (range) => {
    expect(() =>
      validateAuditReport({
        vulnerabilities: {
          foo: {
            severity: 'high',
            via: [v2Advisory(1, 'high', { range })],
            nodes: ['node_modules/foo'],
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(/vulnerabilities\.foo\.via\[0\]\.range/i);
  });

  it('rejects audit transport errors', () => {
    expect(() => validateAuditReport({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE' } })).toThrow(
      /audit error/
    );
  });

  it('rejects missing schema or metadata', () => {
    expect(() => validateAuditReport({ metadata })).toThrow(/advisories\/vulnerabilities/);
    expect(() => validateAuditReport({ advisories: {} })).toThrow(/metadata\.vulnerabilities/);
  });

  it('rejects metadata that claims high findings without matching entries', () => {
    expect(() =>
      validateAuditReport({
        advisories: {},
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(/no matching findings/);
  });

  it('rejects high findings when metadata claims the report is clean', () => {
    expect(() =>
      validateAuditReport({
        advisories: { '1': { id: 1, severity: 'high', module_name: 'foo' } },
        metadata,
      })
    ).toThrow(/metadata reports none/);
  });

  it('rejects non-zero severity count drift between metadata and actual findings', () => {
    expect(() =>
      validateAuditReport({
        advisories: { '1': { id: 1, severity: 'high', module_name: 'foo' } },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 },
        },
      })
    ).toThrow(/metadata\.vulnerabilities\.high=2.*1 high finding/i);
  });

  it('rejects unknown severities instead of treating them as clean', () => {
    expect(() =>
      validateAuditReport({
        advisories: { '1': { id: 1, severity: 'urgent' } },
        metadata,
      })
    ).toThrow(/severity must be one of/i);
  });

  it('rejects reports that mix non-empty legacy and v2 findings', () => {
    expect(() =>
      validateAuditReport({
        advisories: { '1': { id: 1, severity: 'low' } },
        vulnerabilities: {
          criticalPkg: {
            severity: 'critical',
            via: [v2Advisory(2, 'critical')],
            nodes: ['node_modules/criticalPkg'],
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 1 },
        },
      })
    ).toThrow(/mixes non-empty legacy and v2/i);
  });

  it.each([
    ['missing entry id', '42', { severity: 'high', module_name: 'foo' }],
    ['mismatched entry id', '42', { id: 43, severity: 'high', module_name: 'foo' }],
    ['invalid map key', 'not-an-id', { id: 'not-an-id', severity: 'high', module_name: 'foo' }],
  ])('rejects legacy advisory identity drift: %s', (_label, key, advisory) => {
    expect(() =>
      validateAuditReport({
        advisories: { [key]: advisory },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        },
      })
    ).toThrow(/advisories\..*(?:id|key)/i);
  });
});

describe('bulk audit transport', () => {
  const clean = {
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    },
    advisories: {},
  };

  it('decodes both plain JSON and gzip bytes without relying on Content-Encoding', () => {
    const plain = Buffer.from(JSON.stringify(clean));
    expect(decodeAuditBody(plain, 'plain response')).toEqual(clean);
    expect(decodeAuditBody(gzipSync(plain), 'gzip response')).toEqual(clean);
  });

  it('fails closed when the decoded payload is not JSON', () => {
    expect(() => decodeAuditBody(gzipSync(Buffer.from('not json')), 'broken response')).toThrow(
      /broken response.*valid JSON/
    );
  });

  it('decodes a gzip bulk endpoint response before validating its shape', async () => {
    const body = gzipSync(Buffer.from(JSON.stringify({ pkg: [] })));
    const fakeFetch = async () => new Response(body, { status: 200 });
    await expect(fetchBulkAudit({ pkg: ['1.0.0'] }, 'bulk response', fakeFetch)).resolves.toEqual({
      pkg: [],
    });
  });

  it('classifies advisories with the validated lockfile scope ceiling', () => {
    const full = {
      runtimeLeaf: [bulkAdvisory(1, 'critical')],
      devLeaf: [bulkAdvisory(2)],
      lowLeaf: [bulkAdvisory(3, 'low')],
    };

    expect(
      normalizeBulkAuditFindings(full, {
        runtimeLeaf: 'runtime',
        devLeaf: 'dev',
        lowLeaf: 'dev',
      })
    ).toMatchObject([
      { id: '2', name: 'devLeaf', severity: 'high', scope: 'dev' },
      { id: '1', name: 'runtimeLeaf', severity: 'critical', scope: 'runtime' },
    ]);
  });

  it('fails closed when a reported package has no validated lockfile scope ceiling', () => {
    expect(() =>
      normalizeBulkAuditFindings({ runtimeLeaf: [bulkAdvisory(1, 'critical')] }, {})
    ).toThrow(/runtimeLeaf.*missing.*scope ceiling/i);
  });

  it('conservatively marks every advisory mixed when its package name spans both graphs', () => {
    const runtimeAdvisory = {
      ...bulkAdvisory(1, 'critical'),
      vulnerable_versions: '<2.0.0',
    };
    const devAdvisory = {
      ...bulkAdvisory(2),
      vulnerable_versions: '>=2.0.0',
    };
    expect(
      normalizeBulkAuditFindings(
        { splitLeaf: [runtimeAdvisory, devAdvisory] },
        { splitLeaf: 'mixed' }
      )
    ).toMatchObject([
      { id: '1', name: 'splitLeaf', scope: 'mixed' },
      { id: '2', name: 'splitLeaf', scope: 'mixed' },
    ]);
  });

  it('validates every advisory object and rejects unknown severities', async () => {
    const malformed = async () =>
      new Response(JSON.stringify({ pkg: [{ id: 1, severity: 'high' }] }), { status: 200 });
    const unknownSeverity = async () =>
      new Response(JSON.stringify({ pkg: [{ ...bulkAdvisory(1), severity: 'urgent' }] }), {
        status: 200,
      });

    await expect(fetchBulkAudit({ pkg: ['1.0.0'] }, 'bulk response', malformed)).rejects.toThrow(
      /bulk response\.pkg\[0\]\.(?:url|title)/
    );
    await expect(
      fetchBulkAudit({ pkg: ['1.0.0'] }, 'bulk response', unknownSeverity)
    ).rejects.toThrow(/bulk response\.pkg\[0\].*severity/);
  });
});

describe('lockfile-derived bulk audit requests', () => {
  const packageJson = {
    dependencies: { runtimeRoot: '^1.0.0' },
    devDependencies: { devRoot: '^1.0.0' },
  };
  const lockedPackage = () => ({ resolution: { integrity: 'sha512-dGVzdA==' } });
  const lockfile = {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          runtimeRoot: { specifier: '^1.0.0', version: '1.0.0' },
        },
        devDependencies: {
          devRoot: { specifier: '^1.0.0', version: '1.0.0' },
        },
      },
    },
    packages: {
      'runtimeRoot@1.0.0': lockedPackage(),
      'runtimeLeaf@2.0.0': lockedPackage(),
      'sharedLeaf@3.0.0': lockedPackage(),
      'splitLeaf@1.0.0': lockedPackage(),
      'splitLeaf@2.0.0': lockedPackage(),
      'devRoot@1.0.0': lockedPackage(),
      'devLeaf@4.0.0': lockedPackage(),
    },
    snapshots: {
      'runtimeRoot@1.0.0': {
        dependencies: {
          runtimeLeaf: '2.0.0',
          sharedLeaf: '3.0.0',
          splitLeaf: '1.0.0',
        },
      },
      'runtimeLeaf@2.0.0': {},
      'sharedLeaf@3.0.0': {},
      'splitLeaf@1.0.0': {},
      'splitLeaf@2.0.0': {},
      'devRoot@1.0.0': {
        dependencies: {
          devLeaf: '4.0.0',
          sharedLeaf: '3.0.0',
          splitLeaf: '2.0.0',
        },
      },
      'devLeaf@4.0.0': {},
    },
  };

  it('builds complete full/prod requests from the lockfile and tracks mixed reachability', () => {
    expect(buildLockfileAuditRequests(packageJson, lockfile)).toEqual({
      fullRequest: {
        devLeaf: ['4.0.0'],
        devRoot: ['1.0.0'],
        runtimeLeaf: ['2.0.0'],
        runtimeRoot: ['1.0.0'],
        sharedLeaf: ['3.0.0'],
        splitLeaf: ['1.0.0', '2.0.0'],
      },
      productionRequest: {
        runtimeLeaf: ['2.0.0'],
        runtimeRoot: ['1.0.0'],
        sharedLeaf: ['3.0.0'],
        splitLeaf: ['1.0.0'],
      },
      developmentRequest: {
        devLeaf: ['4.0.0'],
        devRoot: ['1.0.0'],
        sharedLeaf: ['3.0.0'],
        splitLeaf: ['2.0.0'],
      },
      scopesByPackageVersion: {
        'devLeaf@4.0.0': 'dev',
        'devRoot@1.0.0': 'dev',
        'runtimeLeaf@2.0.0': 'runtime',
        'runtimeRoot@1.0.0': 'runtime',
        'sharedLeaf@3.0.0': 'mixed',
        'splitLeaf@1.0.0': 'runtime',
        'splitLeaf@2.0.0': 'dev',
      },
      scopeCeilingByName: {
        devLeaf: 'dev',
        devRoot: 'dev',
        runtimeLeaf: 'runtime',
        runtimeRoot: 'runtime',
        sharedLeaf: 'mixed',
        splitLeaf: 'mixed',
      },
    });
  });

  it('fails closed when package.json and the root importer drift', () => {
    const drifted = structuredClone(lockfile);
    drifted.importers['.'].dependencies.runtimeRoot.specifier = '^2.0.0';
    expect(() => buildLockfileAuditRequests(packageJson, drifted)).toThrow(
      /runtimeRoot.*specifier.*package\.json/i
    );
  });

  it('fails closed when a resolved dependency is absent from packages/snapshots', () => {
    const incomplete = structuredClone(lockfile);
    Reflect.deleteProperty(incomplete.packages, 'runtimeLeaf@2.0.0');
    expect(() => buildLockfileAuditRequests(packageJson, incomplete)).toThrow(
      /runtimeLeaf@2\.0\.0.*packages/i
    );
  });

  it('fails closed when a resolved package has no integrity hash', () => {
    const incomplete = structuredClone(lockfile);
    Reflect.deleteProperty(incomplete.packages['runtimeLeaf@2.0.0'], 'resolution');
    expect(() => buildLockfileAuditRequests(packageJson, incomplete)).toThrow(
      /runtimeLeaf@2\.0\.0.*resolution\.integrity/i
    );
  });

  it('fails closed when package metadata disagrees with the lockfile key identity', () => {
    const mismatched = structuredClone(lockfile);
    const runtimeLeaf = mismatched.packages['runtimeLeaf@2.0.0'] as ReturnType<
      typeof lockedPackage
    > & { version?: string };
    runtimeLeaf.version = '0.0.1';
    expect(() => buildLockfileAuditRequests(packageJson, mismatched)).toThrow(
      /runtimeLeaf@2\.0\.0.*version 0\.0\.1.*lockfile key/i
    );
  });

  it.each(['tarball', 'type'])('fails closed on unsupported %s resolution metadata', (field) => {
    const nonRegistry = structuredClone(lockfile);
    const resolution = nonRegistry.packages['runtimeLeaf@2.0.0'].resolution as Record<
      string,
      string
    >;
    resolution[field] = field === 'tarball' ? 'https://attacker.invalid/pkg.tgz' : 'git';
    expect(() => buildLockfileAuditRequests(packageJson, nonRegistry)).toThrow(
      new RegExp(`runtimeLeaf@2\\.0\\.0.*non-registry.*${field}`, 'i')
    );
  });

  it('fails closed when package.json or the lockfile declares patched dependencies', () => {
    const patchedLockfile = structuredClone(lockfile) as typeof lockfile & {
      patchedDependencies: Record<string, string>;
    };
    patchedLockfile.patchedDependencies = {
      'runtimeLeaf@2.0.0': 'patches/runtimeLeaf@2.0.0.patch',
    };
    expect(() => buildLockfileAuditRequests(packageJson, patchedLockfile)).toThrow(
      /patched dependencies are unsupported/i
    );

    const patchedPackage = structuredClone(packageJson) as typeof packageJson & {
      pnpm: { patchedDependencies: Record<string, string> };
    };
    patchedPackage.pnpm = {
      patchedDependencies: {
        'runtimeLeaf@2.0.0': 'patches/runtimeLeaf@2.0.0.patch',
      },
    };
    expect(() => buildLockfileAuditRequests(patchedPackage, lockfile)).toThrow(
      /patched dependencies are unsupported/i
    );
  });

  it('fails closed when a lockfile package is unreachable from the root importer', () => {
    const stale = structuredClone(lockfile);
    const stalePackages = stale.packages as Record<string, ReturnType<typeof lockedPackage>>;
    const staleSnapshots = stale.snapshots as Record<string, unknown>;
    stalePackages['staleLeaf@9.0.0'] = lockedPackage();
    staleSnapshots['staleLeaf@9.0.0'] = {};
    expect(() => buildLockfileAuditRequests(packageJson, stale)).toThrow(
      /staleLeaf@9\.0\.0.*unreachable/i
    );
  });

  it('accepts a root override only when package.json and lockfile agree', () => {
    const overriddenPackage = structuredClone(packageJson) as typeof packageJson & {
      pnpm: { overrides: Record<string, string> };
    };
    overriddenPackage.pnpm = { overrides: { runtimeRoot: '>=1.0.0' } };
    const overriddenLock = structuredClone(lockfile) as typeof lockfile & {
      overrides: Record<string, string>;
    };
    overriddenLock.overrides = { runtimeRoot: '>=1.0.0' };
    overriddenLock.importers['.'].dependencies.runtimeRoot.specifier = '>=1.0.0';
    expect(
      buildLockfileAuditRequests(overriddenPackage, overriddenLock).fullRequest
    ).toHaveProperty('runtimeRoot');

    overriddenLock.overrides.runtimeRoot = '>=2.0.0';
    expect(() => buildLockfileAuditRequests(overriddenPackage, overriddenLock)).toThrow(
      /overrides do not match/i
    );
  });

  it('rejects a production request that is not a subset of the full request', () => {
    expect(() => validateAuditRequestPair({ pkg: ['1.0.0'] }, { pkg: ['1.0.0', '2.0.0'] })).toThrow(
      /production.*pkg@2\.0\.0.*full/i
    );
  });
});

describe('bulk advisory summary provenance', () => {
  it('names the producer, dependency source, schema and counting unit', () => {
    expect(
      buildBulkAuditSummary({
        lowPkg: [bulkAdvisory(1, 'low')],
        highPkg: [bulkAdvisory(2, 'high')],
      })
    ).toEqual({
      schemaVersion: 1,
      producer: 'npm-bulk-advisory',
      dependencySource: 'pnpm-lock.yaml',
      unit: 'advisory-record',
      severities: {
        info: 0,
        low: 1,
        moderate: 0,
        high: 1,
        critical: 0,
      },
      total: 2,
    });
  });

  it('cannot summarize malformed or unknown-severity advisory records', () => {
    expect(() =>
      buildBulkAuditSummary({ bad: [{ ...bulkAdvisory(1), severity: 'urgent' }] })
    ).toThrow(/severity/);
  });

  it('keeps the recording wrapper exit-code and history schema claims honest', () => {
    const wrapper = fs.readFileSync(path.join(process.cwd(), 'scripts/security-audit.sh'), 'utf8');
    expect(wrapper).toMatch(/0 = advisory history recorded/);
    expect(wrapper).not.toMatch(/1 = high or critical vulnerabilities found/);
    expect(wrapper).toMatch(/schemaVersion:\s*2/);
    expect(wrapper).toMatch(/unit:\s*counts\.unit/);
    expect(wrapper).toMatch(/mkdir "\$\{HISTORY_LOCK_DIR\}"/);
    expect(wrapper).toMatch(/mktemp "\$\{HISTORY_FILE\}\.tmp\.XXXXXX"/);
    expect(wrapper).toMatch(/mv "\$\{HISTORY_TMP\}" "\$\{HISTORY_FILE\}"/);
    expect(wrapper).toMatch(/existing history must not be empty/);
    expect(wrapper).not.toMatch(/echo "\[\]" > "\$\{HISTORY_FILE\}"/);
  });

  it('sends the complete real lockfile closure in one full audit request', async () => {
    const requests: Array<Record<string, string[]>> = [];
    const expectedFullRequest = readLockfileAuditRequests().fullRequest;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    };

    try {
      await expect(readLiveAuditFindings()).resolves.toMatchObject({
        findings: [],
        summary: {
          producer: 'npm-bulk-advisory',
          dependencySource: 'pnpm-lock.yaml',
          total: 0,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([expectedFullRequest]);
    expect(Object.keys(expectedFullRequest).length).toBeGreaterThan(0);
  });
});

describe('parseLegacyRoot', () => {
  it('returns first segment from > separated path', () => {
    expect(parseLegacyRoot('rootpkg>child>grand')).toBe('rootpkg');
  });
  it('skips leading "."', () => {
    expect(parseLegacyRoot('. > rootpkg > child')).toBe('rootpkg');
  });
  it('returns null for empty', () => {
    expect(parseLegacyRoot('')).toBeNull();
    expect(parseLegacyRoot(null)).toBeNull();
  });
});

describe('parseNodeModulesRoot', () => {
  it('extracts plain package', () => {
    expect(parseNodeModulesRoot('node_modules/lodash/lib')).toBe('lodash');
  });
  it('extracts scoped package', () => {
    expect(parseNodeModulesRoot('node_modules/@anthropic-ai/sdk/x')).toBe('@anthropic-ai/sdk');
  });
  it('returns null when no node_modules segment', () => {
    expect(parseNodeModulesRoot('foo/bar')).toBeNull();
    expect(parseNodeModulesRoot(null)).toBeNull();
  });
});

describe('classifyScope', () => {
  const deps = new Set(['runtime-pkg']);
  const devDeps = new Set(['dev-pkg', 'eslint']);

  it('runtime when only runtime root', () => {
    expect(classifyScope(['runtime-pkg'], deps, devDeps)).toBe('runtime');
  });
  it('dev when only dev root', () => {
    expect(classifyScope(['dev-pkg'], deps, devDeps)).toBe('dev');
  });
  it('mixed when both', () => {
    expect(classifyScope(['runtime-pkg', 'dev-pkg'], deps, devDeps)).toBe('mixed');
  });
  it('unknown when neither', () => {
    expect(classifyScope(['mystery'], deps, devDeps)).toBe('unknown');
  });
});

describe('normalizeFromAdvisories', () => {
  it('keeps high/critical, derives roots from paths', () => {
    const report = {
      advisories: {
        '1': {
          id: 1,
          severity: 'high',
          module_name: 'foo',
          findings: [{ paths: ['rootpkg>foo', 'rootpkg>foo>bar'] }],
        },
        '2': {
          id: 2,
          severity: 'low',
          module_name: 'bar',
          findings: [{ paths: ['rootpkg>bar'] }],
        },
      },
    };
    const out = normalizeFromAdvisories(report, new Set(['rootpkg']), new Set());
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('1');
    expect(out[0].name).toBe('foo');
    expect(out[0].roots).toContain('rootpkg');
    expect(out[0].scope).toBe('runtime');
  });

  it('uses the legacy advisories map key as the non-optional identity', () => {
    const report = {
      advisories: {
        '42': {
          id: 42,
          severity: 'high',
          module_name: 'foo',
          findings: [],
        },
      },
    };

    expect(normalizeFromAdvisories(report, new Set(), new Set())).toMatchObject([
      { id: '42', ids: ['42'], name: 'foo' },
    ]);
    expect(() =>
      normalizeFromAdvisories(
        {
          advisories: {
            '42': { severity: 'high', module_name: 'foo', findings: [] },
          },
        },
        new Set(),
        new Set()
      )
    ).toThrow(/advisories\.42\.id/i);
  });
});

describe('normalizeFromV2', () => {
  it('parses v2 vulnerabilities and uses isDirect fallback for roots', () => {
    const report = {
      vulnerabilities: {
        '@scoped/pkg': {
          severity: 'critical',
          via: [v2Advisory(99, 'critical')],
          isDirect: true,
          nodes: [],
        },
      },
    };
    const out = normalizeFromV2(report, new Set(), new Set(['@scoped/pkg']));
    expect(out[0].id).toBe('99');
    expect(out[0].roots).toEqual(['@scoped/pkg']);
    expect(out[0].scope).toBe('dev');
  });

  it('parses roots from node_modules nodes', () => {
    const report = {
      vulnerabilities: {
        leaf: {
          severity: 'high',
          via: [v2Advisory(7)],
          nodes: ['node_modules/leaf', 'node_modules/wrapper/node_modules/leaf'],
        },
      },
    };
    const out = normalizeFromV2(report, new Set(['leaf', 'wrapper']), new Set());
    expect(out[0].roots.sort()).toEqual(['leaf', 'wrapper']);
    expect(out[0].scope).toBe('runtime');
  });

  it('preserves every advisory ID as an independent finding', () => {
    const report = {
      vulnerabilities: {
        leaf: {
          severity: 'high',
          via: [
            v2Advisory(7, 'high', {
              title: 'first advisory',
              url: 'https://example.test/7',
            }),
            v2Advisory(8, 'high', {
              title: 'second advisory',
              url: 'https://example.test/8',
            }),
          ],
          nodes: ['node_modules/leaf'],
        },
      },
    };

    expect(normalizeFromV2(report, new Set(['leaf']), new Set())).toMatchObject([
      {
        id: '7',
        ids: ['7'],
        name: 'leaf',
        title: 'first advisory',
        url: 'https://example.test/7',
        scope: 'runtime',
      },
      {
        id: '8',
        ids: ['8'],
        name: 'leaf',
        title: 'second advisory',
        url: 'https://example.test/8',
        scope: 'runtime',
      },
    ]);
  });

  it('uses each object advisory severity and the parent severity only for string meta-via', () => {
    const report = {
      vulnerabilities: {
        leaf: {
          severity: 'critical',
          via: [v2Advisory(7, 'high'), v2Advisory(8, 'critical'), 'transitive-critical-package'],
          nodes: ['node_modules/leaf'],
        },
      },
    };

    expect(normalizeFromV2(report, new Set(['leaf']), new Set())).toMatchObject([
      { id: '7', ids: ['7'], severity: 'high', name: 'leaf' },
      { id: '8', ids: ['8'], severity: 'critical', name: 'leaf' },
      { id: null, ids: [], severity: 'critical', name: 'leaf' },
    ]);
  });

  it('never downgrades a malformed identifier-bearing advisory to an ID-less finding', () => {
    const malformed = {
      vulnerabilities: {
        leaf: {
          severity: 'high',
          via: [{ ...v2Advisory(7), severity: undefined }],
          nodes: ['node_modules/leaf'],
        },
      },
    };

    expect(() => normalizeFromV2(malformed, new Set(['leaf']), new Set())).toThrow(
      /vulnerabilities\.leaf\.via\[0\]\.severity/i
    );
  });

  it('drops moderate/low entries', () => {
    const report = {
      vulnerabilities: {
        m: { severity: 'moderate', via: ['moderate-upstream'], nodes: [] },
      },
    };
    expect(normalizeFromV2(report, new Set(), new Set())).toEqual([]);
  });
});

describe('normalizeFindings — dispatcher', () => {
  it('routes to advisories shape when present', () => {
    const out = normalizeFindings(
      { advisories: { '1': { id: 1, severity: 'high', module_name: 'x', findings: [] } } },
      new Set(),
      new Set()
    );
    expect(out[0].id).toBe('1');
  });

  it('routes to v2 when advisories empty', () => {
    const out = normalizeFindings(
      {
        advisories: {},
        vulnerabilities: {
          foo: { severity: 'high', via: ['high-upstream'], nodes: ['node_modules/foo'] },
        },
      },
      new Set(),
      new Set()
    );
    expect(out[0].name).toBe('foo');
  });

  it('can preserve non-blocking severities for full/prod identity reconciliation', () => {
    const out = normalizeFindings(
      {
        vulnerabilities: {
          foo: {
            severity: 'moderate',
            via: [v2Advisory(7, 'moderate')],
            nodes: ['node_modules/foo'],
          },
        },
      },
      new Set(),
      new Set(),
      { includeAllSeverities: true }
    );

    expect(out).toMatchObject([{ id: '7', name: 'foo', severity: 'moderate' }]);
  });
});

describe('mergeProductionScope', () => {
  it('treats an advisory present in the production report as runtime or mixed', () => {
    const full = [
      { id: '42', ids: ['42'], name: 'leaf', severity: 'high', scope: 'dev' },
      { id: '99', ids: ['99'], name: 'dev-only', severity: 'high', scope: 'dev' },
    ];
    const production = [
      { id: '42', ids: ['42'], name: 'leaf', severity: 'high', scope: 'unknown' },
    ];

    expect(
      mergeProductionScope(full, production).map((finding: { scope: string }) => finding.scope)
    ).toEqual(['mixed', 'dev']);
  });

  it('keeps production-only findings and marks them runtime', () => {
    const output = mergeProductionScope(
      [],
      [{ id: '7', ids: ['7'], name: 'runtime-leaf', severity: 'high', scope: 'unknown' }]
    );
    expect(output).toEqual([
      { id: '7', ids: ['7'], name: 'runtime-leaf', severity: 'high', scope: 'runtime' },
    ]);
  });

  it('does not merge the same advisory ID across different outer packages', () => {
    const output = mergeProductionScope(
      [{ id: '7', ids: ['7'], name: 'full-package', severity: 'high', scope: 'dev' }],
      [{ id: '7', ids: ['7'], name: 'prod-package', severity: 'high', scope: 'unknown' }]
    );

    expect(output).toEqual([
      { id: '7', ids: ['7'], name: 'full-package', severity: 'high', scope: 'dev' },
      { id: '7', ids: ['7'], name: 'prod-package', severity: 'high', scope: 'runtime' },
    ]);
  });

  it('fails closed when full/prod severities disagree for the same package and advisory ID', () => {
    const full = normalizeFindings(
      {
        vulnerabilities: {
          foo: {
            severity: 'high',
            via: [v2Advisory(7, 'high')],
            nodes: ['node_modules/foo'],
          },
        },
      },
      new Set(),
      new Set(),
      { includeAllSeverities: true }
    );
    const production = normalizeFindings(
      {
        vulnerabilities: {
          foo: {
            severity: 'moderate',
            via: [v2Advisory(7, 'moderate')],
            nodes: ['node_modules/foo'],
          },
        },
      },
      new Set(),
      new Set(),
      { includeAllSeverities: true }
    );

    expect(() => mergeProductionScope(full, production)).toThrow(
      /foo.*advisory.*7.*severity.*high.*moderate/i
    );
  });

  it('does not merge different advisory IDs for the same package', () => {
    const full = [{ id: '1', ids: ['1'], name: 'foo', severity: 'high', scope: 'dev' }];
    const production = [{ id: '2', ids: ['2'], name: 'foo', severity: 'high', scope: 'unknown' }];
    const merged = mergeProductionScope(full, production);

    expect(merged).toEqual([
      { id: '1', ids: ['1'], name: 'foo', severity: 'high', scope: 'dev' },
      { id: '2', ids: ['2'], name: 'foo', severity: 'high', scope: 'runtime' },
    ]);

    const allowlist = [
      {
        id: '1',
        name: 'foo',
        expiresAt: '2026-08-01',
        expiresMs: Date.parse('2026-08-01T00:00:00Z'),
        reason: 'dev-only finding',
        _index: 1,
      },
    ];
    const evaluated = evaluateFindings(merged, allowlist, Date.parse('2026-07-23T00:00:00Z'));
    expect(
      evaluated.allowed.map((item: { vulnerability: { id: string } }) => item.vulnerability.id)
    ).toEqual(['1']);
    expect(evaluated.blockedNew.map((finding: { id: string }) => finding.id)).toEqual(['2']);
  });

  it('does not merge findings whose advisory ID sets only partially overlap', () => {
    const full = [{ id: '1', ids: ['1', '2'], name: 'foo', severity: 'high', scope: 'dev' }];
    const production = [
      { id: '2', ids: ['2', '3'], name: 'foo', severity: 'high', scope: 'unknown' },
    ];

    expect(mergeProductionScope(full, production)).toEqual([
      { id: '1', ids: ['1', '2'], name: 'foo', severity: 'high', scope: 'dev' },
      { id: '2', ids: ['2', '3'], name: 'foo', severity: 'high', scope: 'runtime' },
    ]);
  });
});

describe('loadAllowlist', () => {
  it('loads array form', () => {
    const f = tmpPath('allowlist-array.json');
    fs.writeFileSync(
      f,
      JSON.stringify([{ id: '1234', reason: 'pinned', expiresAt: '2099-01-01' }])
    );
    const out = loadAllowlist(f);
    expect(out[0].id).toBe('1234');
    expect(out[0]._index).toBe(1);
    expect(out[0].expiresMs).toBeGreaterThan(Date.now());
  });

  it('loads { entries: [] } form', () => {
    const f = tmpPath('allowlist-obj.json');
    fs.writeFileSync(
      f,
      JSON.stringify({ entries: [{ name: 'foo', reason: 'r', expiresAt: '2099-01-01' }] })
    );
    const out = loadAllowlist(f);
    expect(out[0].name).toBe('foo');
  });

  it('returns empty when file does not exist', () => {
    expect(loadAllowlist(tmpPath('does-not-exist-xyz.json'))).toEqual([]);
  });

  it('throws when entry missing reason', () => {
    const f = tmpPath('allowlist-bad.json');
    fs.writeFileSync(f, JSON.stringify([{ id: '1', expiresAt: '2099-01-01' }]));
    expect(() => loadAllowlist(f)).toThrow(/missing reason/);
  });

  it('throws when entry missing expiresAt', () => {
    const f = tmpPath('allowlist-bad2.json');
    fs.writeFileSync(f, JSON.stringify([{ id: '1', reason: 'r' }]));
    expect(() => loadAllowlist(f)).toThrow(/missing expiresAt/);
  });

  it('throws on unparseable expiresAt', () => {
    const f = tmpPath('allowlist-bad3.json');
    fs.writeFileSync(f, JSON.stringify([{ id: '1', reason: 'r', expiresAt: 'not-a-date' }]));
    expect(() => loadAllowlist(f)).toThrow(/invalid expiresAt/);
  });

  it('throws when entry has neither id nor name', () => {
    const f = tmpPath('allowlist-bad4.json');
    fs.writeFileSync(f, JSON.stringify([{ reason: 'r', expiresAt: '2099-01-01' }]));
    expect(() => loadAllowlist(f)).toThrow(/at least id or name/);
  });
});

describe('evaluateFindings', () => {
  const now = Date.parse('2026-07-23T00:00:00Z');
  const finding = {
    id: '42',
    ids: ['42'],
    name: 'dev-tool',
    scope: 'dev',
    severity: 'high',
    roots: ['dev-tool'],
  };

  it('blocks dev high findings that are not allowlisted', () => {
    const result = evaluateFindings([finding], [], now);
    expect(result.blockedNew).toEqual([finding]);
    expect(result.allowed).toEqual([]);
  });

  it('accepts a dev finding with a valid allowlist entry within 45 days', () => {
    const entry = {
      id: '42',
      name: null,
      expiresAt: '2026-09-05',
      expiresMs: Date.parse('2026-09-05T00:00:00Z'),
      reason: 'upstream transitive dependency',
      _index: 1,
    };
    const result = evaluateFindings([finding], [entry], now);
    expect(result.allowed).toHaveLength(1);
    expect(result.blockedNew).toEqual([]);
  });

  it('does not let a name-only entry authorize a new identifier-bearing advisory', () => {
    const nameOnlyEntry = {
      id: null,
      name: 'dev-tool',
      expiresAt: '2026-08-01',
      expiresMs: Date.parse('2026-08-01T00:00:00Z'),
      reason: 'legacy identifier-less finding',
      _index: 1,
    };
    const result = evaluateFindings(
      [{ ...finding, id: 'NEW-ADVISORY', ids: ['NEW-ADVISORY'], severity: 'critical' }],
      [nameOnlyEntry],
      now
    );
    expect(result.allowed).toEqual([]);
    expect(result.blockedNew).toHaveLength(1);
  });

  it('requires every v2 advisory ID to have its own allowlist entry', () => {
    const report = {
      vulnerabilities: {
        'multi-id-tool': {
          severity: 'high',
          via: [v2Advisory(101), v2Advisory(202)],
          isDirect: true,
          nodes: [],
        },
      },
    };
    const findings = normalizeFromV2(report, new Set(), new Set(['multi-id-tool']));
    const allowlistEntry = (id: string, index: number) => ({
      id,
      name: 'multi-id-tool',
      expiresAt: '2026-08-01',
      expiresMs: Date.parse('2026-08-01T00:00:00Z'),
      reason: `temporary exception for ${id}`,
      _index: index,
    });

    const partial = evaluateFindings(findings, [allowlistEntry('101', 1)], now);
    expect(
      partial.allowed.map(
        ({ vulnerability }: { vulnerability: { id: string } }) => vulnerability.id
      )
    ).toEqual(['101']);
    expect(partial.blockedNew.map(({ id }: { id: string }) => id)).toEqual(['202']);

    const complete = evaluateFindings(
      findings,
      [allowlistEntry('101', 1), allowlistEntry('202', 2)],
      now
    );
    expect(
      complete.allowed.map(
        ({ vulnerability }: { vulnerability: { id: string } }) => vulnerability.id
      )
    ).toEqual(['101', '202']);
    expect(complete.blockedNew).toEqual([]);
  });

  it('rejects expired and overlong dev allowlist entries', () => {
    const expired = {
      id: '42',
      expiresAt: '2026-07-22',
      expiresMs: Date.parse('2026-07-22T00:00:00Z'),
      reason: 'expired',
      _index: 1,
    };
    expect(evaluateFindings([finding], [expired], now).blockedExpired).toHaveLength(1);

    const overlong = {
      ...expired,
      expiresAt: '2026-09-07',
      expiresMs: Date.parse('2026-09-07T00:00:00Z'),
      reason: 'too long',
    };
    expect(evaluateFindings([finding], [overlong], now).blockedPolicy).toHaveLength(1);
  });
});

describe('entryMatchesVulnerability', () => {
  it('matches by id', () => {
    expect(entryMatchesVulnerability({ id: '99' }, { id: '99', ids: ['99'], name: 'x' })).toBe(
      true
    );
    expect(entryMatchesVulnerability({ id: '99' }, { id: '11', ids: ['11'], name: 'x' })).toBe(
      false
    );
  });

  it('matches id from ids[]', () => {
    expect(entryMatchesVulnerability({ id: '88' }, { id: null, ids: ['88'], name: 'x' })).toBe(
      true
    );
  });

  it('allows name-only matching only for identifier-less legacy findings', () => {
    expect(entryMatchesVulnerability({ name: 'foo' }, { id: null, ids: [], name: 'foo' })).toBe(
      true
    );
    expect(entryMatchesVulnerability({ name: 'foo' }, { id: '1', ids: [], name: 'foo' })).toBe(
      false
    );
    expect(entryMatchesVulnerability({ name: 'foo' }, { id: '1', ids: [], name: 'bar' })).toBe(
      false
    );
  });

  it('id and name combined: both must match', () => {
    expect(
      entryMatchesVulnerability({ id: '1', name: 'foo' }, { id: '1', ids: ['1'], name: 'foo' })
    ).toBe(true);
    expect(
      entryMatchesVulnerability({ id: '1', name: 'foo' }, { id: '1', ids: ['1'], name: 'bar' })
    ).toBe(false);
  });
});

describe('summarizeScopes', () => {
  it('counts by scope', () => {
    const s = summarizeScopes([
      { scope: 'runtime' },
      { scope: 'runtime' },
      { scope: 'dev' },
      { scope: 'unknown' },
    ]);
    expect(s).toEqual({ runtime: 2, dev: 1, mixed: 0, unknown: 1 });
  });
});

describe('formatVulnerability', () => {
  it('formats single line with severity, scope, name, id and roots', () => {
    const line = formatVulnerability({
      severity: 'high',
      scope: 'runtime',
      name: 'leaf',
      id: '42',
      roots: ['root1', 'root2'],
    });
    expect(line).toContain('[HIGH]');
    expect(line).toContain('[runtime]');
    expect(line).toContain('leaf');
    expect(line).toContain('id=42');
    expect(line).toContain('root1, root2');
  });
});

describe('policy constants', () => {
  it('runtime/mixed/unknown allow at most 14 days', () => {
    expect(MAX_ALLOWLIST_DAYS.runtime).toBe(14);
    expect(MAX_ALLOWLIST_DAYS.mixed).toBe(14);
    expect(MAX_ALLOWLIST_DAYS.unknown).toBe(14);
  });
  it('dev allows 45 days', () => {
    expect(MAX_ALLOWLIST_DAYS.dev).toBe(45);
  });
  it('MS_PER_DAY is 86400000', () => {
    expect(MS_PER_DAY).toBe(24 * 60 * 60 * 1000);
  });
});
