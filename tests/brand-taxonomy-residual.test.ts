import { describe, expect, it } from 'vitest';

import {
  applyResidualPolicy,
  isResidualScopeExcluded,
  scanLegacyPath,
  scanLegacyText,
} from '../scripts/check-brand-taxonomy.mjs';

type ResidualPolicy = Parameters<typeof applyResidualPolicy>[1];

const policy = (overrides: Partial<ResidualPolicy> = {}): ResidualPolicy => ({
  schemaVersion: 1,
  immutableHistoryExcludes: ['sources/**', 'openspec/changes/archive/**'],
  generatedArtifactExcludes: ['quality/generated.json'],
  exactExceptions: [],
  ...overrides,
});

describe('brand taxonomy residual gate', () => {
  it('finds semantic legacy contracts including compact tokens away from a prefix', () => {
    const findings = scanLegacyText(
      'src/example.ts',
      [
        'ticketId: "SP-63"',
        'const related = "CP-12";',
        'const brief = "things-SP63-notes";',
        'const asset = "/images/foo-sp57-card.png";',
        'const command = "tools/sp-pipeline/sp-pipeline";',
        'const ticketPrefixes = ["SP", "CP", "SD", "Lv"] as const;',
        'run --prefix SP',
        'const note = data.clawdNote;',
        'import ClawdNote from "../components/ClawdNote.astro";',
        'const route = "/shroomdog-picks/2";',
      ].join('\n')
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual(
      expect.arrayContaining([
        'ticket-id:SP-63',
        'ticket-id:CP-12',
        'compact-ticket:SP63',
        'compact-slug:sp57',
        'pipeline-command:sp-pipeline',
        'legacy-prefix-value:SP',
        'legacy-prefix-value:CP',
        'schema-key:clawdNote',
        'component:ClawdNote',
        'legacy-route:shroomdog-picks',
      ])
    );
  });

  it('does not flag unrelated abbreviations or factual third-party names', () => {
    const findings = scanLegacyText(
      'docs/facts.md',
      [
        'service provider (SP)',
        '這台機器的 CP 值很高',
        'Claude Code is made by Anthropic.',
        'OpenClaw is a third-party runtime name.',
        'See Clawd.rip for the historical timeline.',
      ].join('\n')
    );

    expect(findings).toEqual([]);
  });

  it('requires exact factual exceptions for compound retired persona names', () => {
    const findings = scanLegacyText(
      'src/data/history.json',
      'Git authors included Clawd Bot, ClawdBot and Clawdus.'
    );

    expect(findings.map(({ rule, token }) => `${rule}:${token}`)).toEqual([
      'persona:Clawd',
      'legacy-compound-persona:ClawdBot',
      'legacy-compound-persona:Clawdus',
    ]);
  });

  it('scans legacy filenames without reading binary content', () => {
    expect(scanLegacyPath('src/assets/posts/foo-sp57-card.png')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'path-compact-slug', token: 'sp57' }),
      ])
    );
    expect(scanLegacyPath('public/artifacts/sp-251-unknowns/index.html')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'path-post-slug', token: 'sp-251' })])
    );
  });

  it('only accepts an exact path, rule, token and expected count', () => {
    const findings = scanLegacyText('src/fact.md', 'Old name: Clawd. Old name: Clawd.');
    const accepted = applyResidualPolicy(
      findings,
      policy({
        exactExceptions: [
          {
            path: 'src/fact.md',
            rule: 'persona',
            token: 'Clawd',
            expectedCount: 2,
            reason: 'Verbatim historical rename fact.',
          },
        ],
      })
    );

    expect(accepted.blockers).toEqual([]);
    expect(accepted.staleExceptions).toEqual([]);

    const stale = applyResidualPolicy(
      findings.slice(0, 1),
      policy({
        exactExceptions: [
          {
            path: 'src/fact.md',
            rule: 'persona',
            token: 'Clawd',
            expectedCount: 2,
            reason: 'Verbatim historical rename fact.',
          },
        ],
      })
    );
    expect(stale.staleExceptions).toHaveLength(1);
  });

  it('limits broad exclusions to named immutable or generated trees', () => {
    const currentPolicy = policy();
    expect(isResidualScopeExcluded('sources/original.md', currentPolicy)).toBe(true);
    expect(
      isResidualScopeExcluded('openspec/changes/archive/2026-old/spec.md', currentPolicy)
    ).toBe(true);
    expect(isResidualScopeExcluded('quality/generated.json', currentPolicy)).toBe(true);
    expect(isResidualScopeExcluded('src/content/posts/gp-1.mdx', currentPolicy)).toBe(false);

    const invalid = applyResidualPolicy([], policy({ immutableHistoryExcludes: ['src/**'] }));
    expect(invalid.policyErrors).toEqual([
      'immutable exclusion is not an approved history scope: src/**',
    ]);
  });
});
