import { describe, expect, it } from 'vitest';

import { projectGPBody, projectionEnvelope } from '../scripts/gp-body-projection.mjs';

const base = `---
ticketId: GP-PENDING
---

## 標題

這是模型與 Agent 的原始句子。
`;

describe('GP canonical body projection', () => {
  it('unwraps allowlisted navigation and removes MoguNote without changing source text', () => {
    const enriched = `---
ticketId: GP-PENDING
---

import MoguNote from '../../components/MoguNote.astro';

## 標題

這是[模型](/glossary#model)與 [Agent](/posts/agent) 的原始句子。

<MoguNote>
這段是 gu-log 的獨立評論。
</MoguNote>
`;
    expect(projectGPBody(enriched)).toBe(projectGPBody(base));
    expect(projectionEnvelope(enriched).sha256).toBe(projectionEnvelope(base).sha256);
  });

  it('keeps non-allowlisted links, so editorial prose cannot hide as enrichment', () => {
    const externalLink = base.replace('模型', '[模型](https://example.com)');
    expect(projectGPBody(externalLink)).not.toBe(projectGPBody(base));
  });

  it('rejects unknown components', () => {
    expect(() => projectGPBody(`${base}\n<Callout>新增正文</Callout>\n`)).toThrow(
      'unknown MDX component'
    );
  });

  it('detects any prose, heading, or order change outside enrichment', () => {
    expect(projectGPBody(base.replace('原始句子', '改寫句子'))).not.toBe(projectGPBody(base));
    expect(projectGPBody(base.replace('## 標題', '## 新標題'))).not.toBe(projectGPBody(base));
  });
});
