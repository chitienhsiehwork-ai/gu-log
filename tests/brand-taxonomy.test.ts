import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  canonicalFilename,
  dedupeMoguNoteImports,
  inventoryPathCounts,
  matchesExactTaxonomyMigration,
  PRE_MIGRATION_INVENTORY_PATH,
  RESIDUAL_INVENTORY_PATH,
  rewriteSeriesTags,
  rewriteText,
} from '../scripts/migrate-brand-taxonomy.mjs';

const manifest = {
  entries: [
    {
      oldTicketId: 'SP-63',
      newTicketId: 'GP-63',
      oldSlug: 'shroom-picks-20260214-SP63-benson-proxy-opus',
      newSlug: 'gp-63-20260214-GP63-benson-proxy-opus',
    },
    {
      oldTicketId: 'CP-12',
      newTicketId: 'MP-12',
      oldSlug: 'clawd-picks-20260203-boris-cherny-workflow',
      newSlug: 'mp-12-20260203-boris-cherny-workflow',
    },
  ],
};

describe('brand taxonomy migration', () => {
  it('keeps pre-migration provenance separate from post-migration residuals', () => {
    expect(PRE_MIGRATION_INVENTORY_PATH).not.toBe(RESIDUAL_INVENTORY_PATH);
    const baseline = JSON.parse(fs.readFileSync(PRE_MIGRATION_INVENTORY_PATH, 'utf8'));
    const residual = JSON.parse(fs.readFileSync(RESIDUAL_INVENTORY_PATH, 'utf8'));
    expect(baseline.provenance.phase).toBe('pre-migration');
    expect(residual.provenance.phase).toBe('post-migration-residual');
    expect(Object.keys(baseline.contract).length).toBeGreaterThan(
      Object.keys(residual.contract).length
    );
  });

  it('inventories legacy binary paths without inspecting binary content', () => {
    expect(inventoryPathCounts('public/clawd-icon.png')).toEqual({
      pathComponentOrPersona: 1,
    });
    expect(inventoryPathCounts('src/assets/posts/sp-63-hero.png')).toEqual({
      pathLegacySeriesPrefix: 1,
    });
  });

  it('rewrites explicit machine contracts without touching unrelated abbreviations', () => {
    const input = [
      'ticketId: "SP-63"',
      'const prefixes = ["SP", "CP", "SD", "Lv"]',
      'service provider (SP)',
      '這台機器的 CP 值很高',
      'Claude / Anthropic / OpenClaw',
      'Clawd.rip',
      'tools/sp-pipeline/gp-pipeline --prefix SP',
    ].join('\n');

    const output = rewriteText(input, manifest, 'scripts/example.mjs');

    expect(output).toContain('ticketId: "GP-63"');
    expect(output).toContain('const prefixes = ["GP", "MP", "SD", "Lv"]');
    expect(output).toContain('service provider (SP)');
    expect(output).toContain('CP 值');
    expect(output).toContain('Claude / Anthropic / OpenClaw');
    expect(output).toContain('Clawd.rip');
    expect(output).toContain('tools/gp-pipeline/gp-pipeline --prefix GP');
  });

  it('rewrites active persona prose while preserving factual Clawd rename history', () => {
    expect(
      rewriteText('Clawd 說 <ClawdNote>hi</ClawdNote>', manifest, 'src/content/posts/gp-1-x.mdx')
    ).toBe('Mogu 說 <MoguNote>hi</MoguNote>');

    const historical = '大家叫我 Clawd，但我跑的平台叫 OpenClaw';
    expect(
      rewriteText(
        historical,
        manifest,
        'src/content/posts/sp-64-20260216-openclaw-creator-joins-openai.mdx'
      )
    ).toBe('舊名字裡有 Clawd，但我跑的平台叫 OpenClaw');

    const historicalEn = 'Everyone calls me [Clawd](/en/glossary#clawd), but I run on OpenClaw';
    expect(
      rewriteText(
        historicalEn,
        manifest,
        'src/content/posts/en-sp-64-20260216-openclaw-creator-joins-openai.mdx'
      )
    ).toBe('My old name had Clawd in it, but I run on OpenClaw');

    expect(
      rewriteText(
        '舊名字裡有 Clawd，但我跑的平台叫 OpenClaw',
        manifest,
        'src/content/posts/gp-64-20260216-openclaw-creator-joins-openai.mdx'
      )
    ).toBe('舊名字裡有 Clawd，但我跑的平台叫 OpenClaw');
  });

  it('keeps the factual Clawd.rip source name during the persona migration', () => {
    expect(
      rewriteText(
        '[Clawd](/en/glossary#clawd).rip does one simple thing.',
        manifest,
        'src/content/posts/en-cp-304-20260529-clawd-rip-claude-timeline.mdx'
      )
    ).toBe('[Clawd.rip](https://clawd.rip/) does one simple thing.');

    expect(
      rewriteText(
        '[Clawd.rip](https://clawd.rip/) does one simple thing.',
        manifest,
        'src/content/posts/en-mp-304-20260529-clawd-rip-claude-timeline.mdx'
      )
    ).toBe('[Clawd.rip](https://clawd.rip/) does one simple thing.');
  });

  it('keeps factual git author identities while migrating active src/data persona prose', () => {
    expect(
      rewriteText(
        'Clawd Bot 初稿；ShroomClawd + Clawd Bot review',
        manifest,
        'src/data/post-authorship-notes.json'
      )
    ).toBe('Clawd Bot 初稿；ShroomClawd + Clawd Bot review');

    expect(
      rewriteText('"title": "Clawd 爸去 OpenAI 上班了"', manifest, 'src/data/glossary.json')
    ).toBe('"title": "Mogu 爸去 OpenAI 上班了"');

    expect(rewriteText('Briefs — Clawd 情報站', manifest, 'e2e-tests/REPORT.md')).toBe(
      'Briefs — Mogu 情報站'
    );
    expect(rewriteText('ShroomClawd 的血肉系統', manifest, 'e2e-tests/REPORT.md')).toBe(
      'Mogu 的血肉系統'
    );
  });

  it('canonicalizes legacy filenames including compact SP63 tails', () => {
    expect(canonicalFilename('en-shroom-picks-20260214-SP63-benson-proxy-opus.mdx', 'SP-63')).toBe(
      'en-gp-63-20260214-GP63-benson-proxy-opus.mdx'
    );
    expect(canonicalFilename('cp-12-20260203-boris.mdx', 'CP-12')).toBe('mp-12-20260203-boris.mdx');
    expect(canonicalFilename('sp-115-claude-architect-guide-20260316.mdx', 'SP-115')).toBe(
      'gp-115-20260316-claude-architect-guide.mdx'
    );
  });

  it('removes series identity tags in either quote style', () => {
    expect(rewriteSeriesTags("tags: ['gu-log-picks', 'agent']")).toBe('tags: ["agent"]');
    expect(rewriteSeriesTags('tags: ["mogu-picks"]')).toBe('');
    expect(rewriteSeriesTags("tags:\n  [\n    'mogu-picks',\n    'agent-harness',\n  ]")).toBe(
      'tags: ["agent-harness"]'
    );
  });

  it('deduplicates MoguNote imports created from mixed legacy imports', () => {
    const imports = [
      "import MoguNote from '../../components/MoguNote.astro';",
      "import Toggle from '../../components/Toggle.astro';",
      "import MoguNote from '../../components/MoguNote.astro';",
    ].join('\n');
    expect(dedupeMoguNoteImports(imports).match(/^import MoguNote /gm)).toHaveLength(1);
  });

  it('only exempts a byte-exact deterministic taxonomy migration', () => {
    const before = 'Clawd 說 <ClawdNote>hi</ClawdNote>';
    const migrated = 'Mogu 說 <MoguNote>hi</MoguNote>';
    expect(
      matchesExactTaxonomyMigration(before, migrated, manifest, 'src/content/posts/sd-1.mdx')
    ).toBe(true);
    expect(
      matchesExactTaxonomyMigration(
        before,
        `${migrated}\n額外改寫`,
        manifest,
        'src/content/posts/sd-1.mdx'
      )
    ).toBe(false);
  });
});
