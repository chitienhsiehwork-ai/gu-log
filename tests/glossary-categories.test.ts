import { describe, expect, it } from 'vitest';
import glossaryData from '../src/data/glossary.json';
import { glossaryCategoryFilters, glossaryCategoryLabel } from '../src/config/glossary';

// openspec: glossary-browsing〈分類篩選 SHALL 從詞條資料產生並有雙語 label〉
describe('glossary categories', () => {
  // 詞條用到沒有 label 的分類時，glossaryCategoryLabel 會丟錯並寫出分類名，這個測試就失敗。
  it('labels the category of every glossary entry, in both languages', () => {
    for (const entry of glossaryData) {
      expect(glossaryCategoryLabel(entry.category, 'zh-tw')).toMatch(/\S/);
      expect(glossaryCategoryLabel(entry.category, 'en')).toMatch(/\S/);
    }
  });

  it('names the category when it has no label', () => {
    expect(() => glossaryCategoryLabel('datasets', 'zh-tw')).toThrow('"datasets"');
  });

  it('builds filter buttons only for categories that have entries', () => {
    const entries = [{ category: 'people' }, { category: 'concepts' }, { category: 'people' }];

    expect(glossaryCategoryFilters(entries, 'zh-tw')).toEqual([
      { id: 'concepts', label: '概念' },
      { id: 'people', label: '人物' },
    ]);
    expect(glossaryCategoryFilters(entries, 'en')).toEqual([
      { id: 'concepts', label: 'Concepts' },
      { id: 'people', label: 'People' },
    ]);
  });
});
