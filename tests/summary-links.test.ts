import { describe, expect, it } from 'vitest';
import { linkSummary } from '../src/lib/summary-links.mjs';

const glossary = [
  { term: 'arXiv' },
  { term: 'Frontier Model' },
  { term: 'Agent' },
  { term: 'Token', linking: { enabled: false } },
  { term: '量化', linking: { anchor: 'quantification-quantization' } },
];

describe('linkSummary', () => {
  it('links the first occurrence of each glossary term and keeps the rest as text', () => {
    const segments = linkSummary(
      'arXiv 上的研究發現 Frontier Model 很忙，arXiv 也很忙。',
      glossary
    );
    expect(segments).toEqual([
      { text: 'arXiv', href: '/glossary#arxiv' },
      { text: ' 上的研究發現 ' },
      { text: 'Frontier Model', href: '/glossary#frontier-model' },
      { text: ' 很忙，arXiv 也很忙。' },
    ]);
  });

  it('does not link inside a longer ASCII word, and skips disabled entries', () => {
    const segments = linkSummary('Agents 用掉很多 Token。', glossary);
    expect(segments).toEqual([{ text: 'Agents 用掉很多 Token。' }]);
  });

  it('links CJK terms without word boundaries and uses the English glossary for en posts', () => {
    expect(linkSummary('可以量化的寫法', glossary)).toEqual([
      { text: '可以' },
      { text: '量化', href: '/glossary#quantification-quantization' },
      { text: '的寫法' },
    ]);
    expect(linkSummary('An Agent did it.', glossary, { english: true })[1]).toEqual({
      text: 'Agent',
      href: '/en/glossary#agent',
    });
  });

  it('returns nothing for an empty summary', () => {
    expect(linkSummary('  ', glossary)).toEqual([]);
  });
});
