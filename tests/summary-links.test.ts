import { describe, expect, it } from 'vitest';
import { linkSummary, splitSummarySentences } from '../src/lib/summary-links.mjs';

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

describe('splitSummarySentences', () => {
  const sentenceTexts = (summary: string, options = {}) =>
    splitSummarySentences(linkSummary(summary, glossary, options)).map((sentence) =>
      sentence.map((segment) => segment.text).join('')
    );

  it('splits a Chinese summary after 。！？ and keeps each link whole in its sentence', () => {
    const sentences = splitSummarySentences(
      linkSummary('看不懂是英文不好嗎？arXiv 上的研究說不是。問題其實出在訓練！', glossary)
    );
    expect(sentences).toEqual([
      [{ text: '看不懂是英文不好嗎？' }],
      [{ text: 'arXiv', href: '/glossary#arxiv' }, { text: ' 上的研究說不是。' }],
      [{ text: '問題其實出在訓練！' }],
    ]);
  });

  it('does not split where a quote closes in the middle of a sentence', () => {
    expect(sentenceTexts('他說「講人話。」然後就走了。後來沒有再回來。')).toEqual([
      '他說「講人話。」然後就走了。',
      '後來沒有再回來。',
    ]);
    expect(sentenceTexts('備忘錄問「AI 是不是泡沫？」。這次他讓模型自己回答。')).toEqual([
      '備忘錄問「AI 是不是泡沫？」。',
      '這次他讓模型自己回答。',
    ]);
  });

  it('merges a very short sentence into its neighbour instead of giving it its own line', () => {
    expect(sentenceTexts('他拿三項日常工作讓模型做。結果？模型在各種奇怪的地方翻車。')).toEqual([
      '他拿三項日常工作讓模型做。',
      '結果？模型在各種奇怪的地方翻車。',
    ]);
    expect(
      sentenceTexts('It is 2026 and the tools changed. Build. For. Agents.', { english: true })
    ).toEqual(['It is 2026 and the tools changed.', 'Build. For. Agents.']);
  });

  it('splits an English summary on sentence ends, not inside numbers or abbreviations', () => {
    expect(
      sentenceTexts(
        'Version 4.0.7 shipped today. An Agent, e.g. a coding one, used it. Is it better?',
        { english: true }
      )
    ).toEqual([
      'Version 4.0.7 shipped today.',
      'An Agent, e.g. a coding one, used it.',
      'Is it better?',
    ]);
  });

  it('links each term once across the whole summary, not once per sentence', () => {
    const sentences = splitSummarySentences(linkSummary('arXiv 很大。arXiv 很忙。', glossary));
    expect(sentences).toEqual([
      [{ text: 'arXiv', href: '/glossary#arxiv' }, { text: ' 很大。' }],
      [{ text: 'arXiv 很忙。' }],
    ]);
  });

  it('returns one sentence for a summary with no sentence end, and none for an empty one', () => {
    expect(sentenceTexts('一句話講完，沒有句號')).toEqual(['一句話講完，沒有句號']);
    expect(splitSummarySentences([])).toEqual([]);
  });
});
