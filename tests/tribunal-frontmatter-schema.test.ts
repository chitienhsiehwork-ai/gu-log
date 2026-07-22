/**
 * Zod schema contract tests for src/content.config.ts (posts collection).
 *
 * Pins the rebrand-mogu-gp-mp-taxonomy core contracts at the schema layer:
 *   - ticketId taxonomy is GP | MP | SD | Lv with actionable SP/CP rejection
 *   - retired `clawdNote` score key is explicitly rejected (never silently
 *     stripped by Zod's default unknown-key behavior)
 *   - score dimensions are integers 0..10; tribunalVersion is a positive int
 *   - cross-field invariants (deprecated↔deprecatedBy, humanOverride reason,
 *     acknowledged overlap justification, proxy author distinction)
 *   - stage4Scores shape is version-aware (v9 must not carry Vibe clarity)
 *
 * `astro:content` is a virtual module only Astro can resolve — mock it with
 * astro/zod (the same Zod instance Astro injects) so the real schema file is
 * imported and exercised directly.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('astro:content', async () => {
  const { z } = await import('astro/zod');
  return { z, defineCollection: (config: unknown) => config };
});
vi.mock('astro/loaders', () => ({ glob: () => ({}) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPostsSchema(): Promise<any> {
  const mod = await import('../src/content.config');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.collections.posts as any).schema;
}

const BASE = {
  title: 'Test post',
  originalDate: '2026-01-01',
  translatedDate: '2026-01-02',
  source: '@someone on X',
  sourceUrl: 'https://example.com/post',
  summary: 'A summary',
  translatedBy: { model: 'GPT-5.5', harness: 'Codex CLI' },
};

const VIBE_V9 = {
  persona: 9,
  moguNote: 8,
  vibe: 8,
  narrative: 8,
  score: 8,
  date: '2026-07-01',
};

function issueMessages(result: {
  success: boolean;
  error?: { issues: Array<{ message: string; path: Array<string | number> }> };
}): string {
  if (result.success || !result.error) return '';
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
}

describe('posts schema — ticketId taxonomy', () => {
  it.each(['GP-258', 'MP-314', 'SD-1', 'Lv-7', 'GP-PENDING', 'MP-PENDING'])(
    'accepts canonical ticketId %s',
    async (ticketId) => {
      const schema = await loadPostsSchema();
      const r = schema.safeParse({ ...BASE, ticketId });
      expect(r.success, issueMessages(r)).toBe(true);
    }
  );

  it.each([
    ['SP-258', 'GP-258'],
    ['CP-314', 'MP-314'],
    ['SP-PENDING', 'GP-PENDING'],
  ])(
    'rejects retired ticketId %s with an actionable "use %s" diagnostic',
    async (retired, canonical) => {
      const schema = await loadPostsSchema();
      const r = schema.safeParse({ ...BASE, ticketId: retired });
      expect(r.success).toBe(false);
      expect(issueMessages(r)).toContain(`use ${canonical}`);
    }
  );

  it.each(['XX-1', 'gp-1', 'GP1', 'GP-', 'GP-1a'])(
    'rejects malformed ticketId %s',
    async (ticketId) => {
      const schema = await loadPostsSchema();
      const r = schema.safeParse({ ...BASE, ticketId });
      expect(r.success).toBe(false);
    }
  );

  it('rejects retired SP/CP references in deprecatedBy and dedup.acknowledgedOverlapWith', async () => {
    const schema = await loadPostsSchema();

    const viaDeprecatedBy = schema.safeParse({
      ...BASE,
      ticketId: 'MP-298',
      status: 'deprecated',
      deprecatedBy: 'SP-165',
    });
    expect(viaDeprecatedBy.success).toBe(false);
    expect(issueMessages(viaDeprecatedBy)).toContain('use GP-165');

    const viaOverlap = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: {
        acknowledgedOverlapWith: ['SP-165'],
        overlapJustification: '需要中文化入口',
      },
    });
    expect(viaOverlap.success).toBe(false);
    expect(issueMessages(viaOverlap)).toContain('use GP-165');
  });
});

describe('posts schema — retired clawdNote key is rejected, not stripped', () => {
  it('rejects scores.vibe.clawdNote with a moguNote diagnostic', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { tribunalVersion: 9, vibe: { ...VIBE_V9, clawdNote: 8 } },
    });
    expect(r.success).toBe(false);
    expect(issueMessages(r)).toContain('moguNote');
  });

  it('rejects stage4Scores.clawdNote with a moguNote diagnostic', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      stage4Scores: {
        persona: 8,
        clawdNote: 8,
        vibe: 8,
        narrative: 8,
        isDegraded: false,
      },
    });
    expect(r.success).toBe(false);
    expect(issueMessages(r)).toContain('moguNote');
  });
});

describe('posts schema — score value constraints', () => {
  it('rejects out-of-range dimension scores (11)', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { vibe: { ...VIBE_V9, persona: 11 } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer dimension scores (8.5)', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { vibe: { ...VIBE_V9, persona: 8.5 } },
    });
    expect(r.success).toBe(false);
  });

  it('rejects non-positive tribunalVersion', async () => {
    const schema = await loadPostsSchema();
    for (const bad of [0, -1, 8.5]) {
      const r = schema.safeParse({
        ...BASE,
        ticketId: 'GP-1',
        scores: { tribunalVersion: bad, vibe: VIBE_V9 },
      });
      expect(r.success, `tribunalVersion ${bad} should fail`).toBe(false);
    }
  });

  it('accepts partial judge scores and a missing scores block (progressive writes)', async () => {
    const schema = await loadPostsSchema();
    const partial = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { tribunalVersion: 9, vibe: VIBE_V9 },
    });
    expect(partial.success, issueMessages(partial)).toBe(true);

    const none = schema.safeParse({ ...BASE, ticketId: 'GP-1' });
    expect(none.success, issueMessages(none)).toBe(true);
  });
});

describe('posts schema — cross-field invariants', () => {
  it('rejects status=deprecated without deprecatedBy', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({ ...BASE, ticketId: 'MP-298', status: 'deprecated' });
    expect(r.success).toBe(false);
    expect(issueMessages(r)).toContain('deprecatedBy is required when status is deprecated');
  });

  it('accepts status=deprecated with a canonical deprecatedBy', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'MP-298',
      status: 'deprecated',
      deprecatedBy: 'GP-165',
    });
    expect(r.success, issueMessages(r)).toBe(true);
  });

  it('rejects dedup.humanOverride=true without a non-empty humanOverrideReason', async () => {
    const schema = await loadPostsSchema();
    const missing = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: { humanOverride: true },
    });
    expect(missing.success).toBe(false);

    const empty = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: { humanOverride: true, humanOverrideReason: '   ' },
    });
    expect(empty.success).toBe(false);

    const ok = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: { humanOverride: true, humanOverrideReason: '作者本人最終豁免' },
    });
    expect(ok.success, issueMessages(ok)).toBe(true);
  });

  it('rejects non-empty acknowledgedOverlapWith without overlapJustification', async () => {
    const schema = await loadPostsSchema();
    const missing = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: { acknowledgedOverlapWith: ['GP-165'] },
    });
    expect(missing.success).toBe(false);

    const ok = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: {
        acknowledgedOverlapWith: ['GP-165'],
        overlapJustification: '需要中文化入口讓非英文讀者進入議題',
      },
    });
    expect(ok.success, issueMessages(ok)).toBe(true);

    const emptyList = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      dedup: { acknowledgedOverlapWith: [] },
    });
    expect(emptyList.success, issueMessages(emptyList)).toBe(true);
  });

  it('rejects authorType=proxy when author equals authorCanonical', async () => {
    const schema = await loadPostsSchema();
    const same = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      authorType: 'proxy',
      author: 'andrej-karpathy',
      authorCanonical: 'andrej-karpathy',
    });
    expect(same.success).toBe(false);
    expect(issueMessages(same)).toMatch(/proxy/i);

    const distinct = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      authorType: 'proxy',
      author: 'lenny-interviewing-karpathy',
      authorCanonical: 'andrej-karpathy',
    });
    expect(distinct.success, issueMessages(distinct)).toBe(true);
  });
});

describe('posts schema — stage4Scores version-aware shape', () => {
  it('accepts a v9 stage4Scores without clarity (degraded rescore)', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { tribunalVersion: 9, vibe: VIBE_V9 },
      stage4Scores: {
        persona: 8,
        moguNote: 7,
        vibe: 8,
        narrative: 8,
        degradedDimensions: ['moguNote'],
        isDegraded: true,
      },
    });
    expect(r.success, issueMessages(r)).toBe(true);
  });

  it('rejects a v9 stage4Scores that fabricates Vibe-owned clarity', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: { tribunalVersion: 9, vibe: VIBE_V9 },
      stage4Scores: {
        persona: 8,
        moguNote: 8,
        vibe: 8,
        clarity: 8,
        narrative: 8,
        isDegraded: false,
      },
    });
    expect(r.success).toBe(false);
    expect(issueMessages(r)).toMatch(/clarity/);
  });

  it('accepts a legacy v8 stage4Scores with Vibe-owned clarity', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'GP-1',
      scores: {
        tribunalVersion: 8,
        vibe: { ...VIBE_V9, clarity: 8 },
      },
      stage4Scores: {
        persona: 8,
        moguNote: 8,
        vibe: 8,
        clarity: 8,
        narrative: 8,
        isDegraded: false,
      },
    });
    expect(r.success, issueMessages(r)).toBe(true);
  });
});

describe('posts schema — extended optional fields', () => {
  it('accepts seriesId, clusterIds, metadata.gateWarnings and a full dedup block', async () => {
    const schema = await loadPostsSchema();
    const r = schema.safeParse({
      ...BASE,
      ticketId: 'MP-36',
      seriesId: 'karpathy-thinking-evolution',
      clusterIds: ['agentic-engineering', 'karpathy-2026-02-04-tweet'],
      metadata: { gateWarnings: ['dedup-gate: soft-dup WARN'] },
      dedup: {
        independentDiff: 'TechCrunch 補充了未公開的內部時間線',
        tribunalVerdict: {
          class: 'clean-diff',
          action: 'allow',
          matchedSlugs: [],
          score: 10,
          reason: 'independent contribution',
        },
      },
    });
    expect(r.success, issueMessages(r)).toBe(true);
  });
});
