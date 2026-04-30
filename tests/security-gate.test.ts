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
// @ts-expect-error — JS module
import * as sg from '../scripts/security-gate.mjs';

const {
  parseArgs,
  parseLegacyRoot,
  parseNodeModulesRoot,
  classifyScope,
  normalizeFromAdvisories,
  normalizeFromV2,
  normalizeFindings,
  loadAllowlist,
  entryMatchesVulnerability,
  summarizeScopes,
  formatVulnerability,
  MAX_ALLOWLIST_DAYS,
  MS_PER_DAY,
} = sg;

describe('parseArgs', () => {
  it('returns defaults', () => {
    const o = parseArgs([]);
    expect(o.allowlistPath).toMatch(/security-allowlist\.json$/);
    expect(o.auditFile).toBeNull();
  });

  it('overrides allowlist path (absolute)', () => {
    const o = parseArgs(['--allowlist', '/abs/list.json']);
    expect(o.allowlistPath).toBe('/abs/list.json');
  });

  it('takes audit-file', () => {
    const o = parseArgs(['--audit-file', '/x/audit.json']);
    expect(o.auditFile).toBe('/x/audit.json');
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
});

describe('normalizeFromV2', () => {
  it('parses v2 vulnerabilities and uses isDirect fallback for roots', () => {
    const report = {
      vulnerabilities: {
        '@scoped/pkg': {
          severity: 'critical',
          via: [{ source: 99 }],
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
          via: [{ source: 7 }],
          nodes: ['node_modules/leaf', 'node_modules/wrapper/node_modules/leaf'],
        },
      },
    };
    const out = normalizeFromV2(report, new Set(['leaf', 'wrapper']), new Set());
    expect(out[0].roots.sort()).toEqual(['leaf', 'wrapper']);
    expect(out[0].scope).toBe('runtime');
  });

  it('drops moderate/low entries', () => {
    const report = {
      vulnerabilities: {
        m: { severity: 'moderate', via: [], nodes: [] },
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
      { advisories: {}, vulnerabilities: { foo: { severity: 'high', via: [], nodes: [] } } },
      new Set(),
      new Set()
    );
    expect(out[0].name).toBe('foo');
  });
});

describe('loadAllowlist', () => {
  it('loads array form', () => {
    const f = '/tmp/allowlist-array.json';
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
    const f = '/tmp/allowlist-obj.json';
    fs.writeFileSync(
      f,
      JSON.stringify({ entries: [{ name: 'foo', reason: 'r', expiresAt: '2099-01-01' }] })
    );
    const out = loadAllowlist(f);
    expect(out[0].name).toBe('foo');
  });

  it('returns empty when file does not exist', () => {
    expect(loadAllowlist('/tmp/does-not-exist-xyz.json')).toEqual([]);
  });

  it('throws when entry missing reason', () => {
    const f = '/tmp/allowlist-bad.json';
    fs.writeFileSync(f, JSON.stringify([{ id: '1', expiresAt: '2099-01-01' }]));
    expect(() => loadAllowlist(f)).toThrow(/missing reason/);
  });

  it('throws when entry missing expiresAt', () => {
    const f = '/tmp/allowlist-bad2.json';
    fs.writeFileSync(f, JSON.stringify([{ id: '1', reason: 'r' }]));
    expect(() => loadAllowlist(f)).toThrow(/missing expiresAt/);
  });

  it('throws on unparseable expiresAt', () => {
    const f = '/tmp/allowlist-bad3.json';
    fs.writeFileSync(f, JSON.stringify([{ id: '1', reason: 'r', expiresAt: 'not-a-date' }]));
    expect(() => loadAllowlist(f)).toThrow(/invalid expiresAt/);
  });

  it('throws when entry has neither id nor name', () => {
    const f = '/tmp/allowlist-bad4.json';
    fs.writeFileSync(f, JSON.stringify([{ reason: 'r', expiresAt: '2099-01-01' }]));
    expect(() => loadAllowlist(f)).toThrow(/at least id or name/);
  });
});

describe('entryMatchesVulnerability', () => {
  it('matches by id', () => {
    expect(entryMatchesVulnerability({ id: '99' }, { id: '99', ids: ['99'], name: 'x' })).toBe(true);
    expect(entryMatchesVulnerability({ id: '99' }, { id: '11', ids: ['11'], name: 'x' })).toBe(false);
  });

  it('matches id from ids[]', () => {
    expect(entryMatchesVulnerability({ id: '88' }, { id: null, ids: ['88'], name: 'x' })).toBe(true);
  });

  it('matches by name', () => {
    expect(entryMatchesVulnerability({ name: 'foo' }, { id: '1', ids: [], name: 'foo' })).toBe(true);
    expect(entryMatchesVulnerability({ name: 'foo' }, { id: '1', ids: [], name: 'bar' })).toBe(false);
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
